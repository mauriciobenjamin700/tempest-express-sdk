import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  AdminModel,
  AdminSite,
  BaseModel,
  BaseRepository,
  BaseUserModel,
  PasswordUtils,
  type TestDatabase,
  UserModelAuthBackend,
  adminAction,
  buildFormFields,
  column,
  createApp,
  createTestDatabase,
  foreignKeyFields,
  foreignKeyLabel,
  makeAdminRouter,
  runServer,
} from "@/index";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

class UserModel extends BaseUserModel {
  static override tablename = "user";
  name = column.varchar(120).notNull();
}

class LegacyThingModel extends BaseModel {
  static override tablename = "legacy_thing";
  code = column.varchar(20).notNull();
}

class OrderModel extends BaseModel {
  static override tablename = "sales_order";
  reference = column.varchar(60).notNull();
  status = column.enum("draft", "paid").notNull().default("draft");
  userId = column.uuid().references("user.id");
  externalId = column.uuid().references("legacy_thing.id");
  notes = column.text();
}

const SECRET = "a-test-secret-that-is-long-enough-32";

let db: TestDatabase;
let server: Server;
let base: string;
let cookie = "";
let ownerId = "";
let seen: { ids: string[]; principalKnown: boolean } = { ids: [], principalKnown: false };

const markPaid = adminAction({ label: "Marcar como pago" }, async (ctx) => {
  seen = {
    ids: [...ctx.ids],
    principalKnown:
      (ctx.principal as { email?: string } | null)?.email === "root@example.com",
  };
  const changed = await ctx.repository.update(
    { id: { in: ctx.ids } } as never,
    {
      status: "paid",
    } as never,
  );
  return { message: `${changed} pedidos marcados como pagos.` };
});

const explode = adminAction({ label: "Explode", name: "explode" }, async () => {
  throw new Error("handler blew up");
});

const quiet = adminAction({ label: "Quiet", name: "quiet" }, async () => null);

/** Fetch without following redirects, carrying the session cookie. */
function call(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cookie !== "") headers.set("cookie", cookie);
  return fetch(`${base}${path}`, { ...init, headers, redirect: "manual" });
}

/** POST a form-encoded body, with repeated fields supported. */
function post(path: string, fields: [string, string][]): Promise<Response> {
  const body = new URLSearchParams();
  for (const [key, value] of fields) body.append(key, value);
  return call(path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
}

/** Pull the CSRF token out of a rendered page. */
function csrfFrom(html: string): string {
  return /name="csrf_token" value="([^"]+)"/.exec(html)?.[1] ?? "";
}

/** Read the flash message a redirect carries back. */
function flashOf(res: Response): { text: string; level: string } {
  const url = new URL(res.headers.get("location") ?? "", base);
  return {
    text: url.searchParams.get("flash") ?? "",
    level: url.searchParams.get("level") ?? "",
  };
}

/** Re-read one order by reference. */
async function orderBy(reference: string): Promise<Record<string, unknown> | null> {
  const repo = new BaseRepository(OrderModel, db.session());
  return (await repo.first({ reference } as never)) as Record<string, unknown> | null;
}

beforeAll(async () => {
  db = createTestDatabase([UserModel, LegacyThingModel, OrderModel]);
  const passwords = new PasswordUtils(4);
  const users = new BaseRepository(UserModel, db.session());
  const owner = await users.create({
    email: "root@example.com",
    hashedPassword: await passwords.hash("hunter2hunter2"),
    isAdmin: true,
    name: "Root",
    lastLoginAt: null,
  });
  ownerId = String((owner as unknown as { id: string }).id);

  const orders = new BaseRepository(OrderModel, db.session());
  for (let index = 1; index <= 6; index += 1) {
    await orders.create({
      reference: `ORD-${index}`,
      status: "draft",
      userId: ownerId,
      externalId: null,
      notes: index === 1 ? 'Contains "quotes", a comma and\na newline' : null,
    });
  }

  const site = new AdminSite({ title: "Bulk Admin" });
  site.register(
    new AdminModel({
      model: OrderModel,
      listDisplay: ["reference", "status", "isActive", "notes"],
      listFilter: ["status", "userId"],
      searchFields: ["reference"],
      ordering: "reference",
      actions: [markPaid, explode, quiet],
    }),
  );
  site.register(new AdminModel({ model: UserModel, searchFields: ["name"] }));

  const app = await createApp({
    health: false,
    configure: (a) => {
      a.use(
        makeAdminRouter(site, {
          engine: db.engine,
          authBackend: new UserModelAuthBackend(UserModel, { passwords }),
          secretKey: SECRET,
          cookieSecure: false,
          exportMaxRows: 4,
        }),
      );
    },
  });
  server = await runServer(app, { port: 0 });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const login = await post("/admin/login", [
    ["identifier", "root@example.com"],
    ["password", "hunter2hunter2"],
  ]);
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
});

afterAll(async () => {
  server.close();
  await db.close();
});

describe("bulk actions", () => {
  it("renders the bulk bar, checkboxes and export links", async () => {
    const html = await (await call("/admin/m/sales_order")).text();
    expect(html).toContain('name="action"');
    expect(html).toContain("data-select-all");
    expect(html).toContain("data-row-check");
    expect(html).toContain(">Activate<");
    expect(html).toContain(">Delete ⚠<");
    expect(html).toContain('value="custom:marcar-como-pago"');
    expect(html).toContain("Export CSV");
    expect(html).toContain("Export JSON");
  });

  it("deactivates and reactivates the checked rows", async () => {
    const page = await (await call("/admin/m/sales_order")).text();
    const csrf = csrfFrom(page);
    const first = await orderBy("ORD-1");
    const second = await orderBy("ORD-2");

    const off = await post("/admin/m/sales_order/bulk", [
      ["csrf_token", csrf],
      ["action", "deactivate"],
      ["ids", String(first?.id)],
      ["ids", String(second?.id)],
    ]);
    expect(off.status).toBe(302);
    expect(flashOf(off).text).toBe("Deactivated 2 records.");
    expect((await orderBy("ORD-1"))?.isActive).toBe(false);

    const on = await post("/admin/m/sales_order/bulk", [
      ["csrf_token", csrf],
      ["action", "activate"],
      ["ids", String(first?.id)],
      ["ids", String(second?.id)],
    ]);
    expect(flashOf(on).text).toBe("Activated 2 records.");
    expect((await orderBy("ORD-1"))?.isActive).toBe(true);
  });

  it("warns instead of acting when nothing is checked", async () => {
    const page = await (await call("/admin/m/sales_order")).text();
    const res = await post("/admin/m/sales_order/bulk", [
      ["csrf_token", csrfFrom(page)],
      ["action", "delete"],
    ]);
    expect(flashOf(res)).toEqual({ text: "No rows were selected.", level: "warning" });
    const repo = new BaseRepository(OrderModel, db.session());
    expect(await repo.count()).toBe(6);
  });

  it("rejects an unknown action and a forged CSRF token", async () => {
    const page = await (await call("/admin/m/sales_order")).text();
    const target = String((await orderBy("ORD-3"))?.id);

    const unknown = await post("/admin/m/sales_order/bulk", [
      ["csrf_token", csrfFrom(page)],
      ["action", "nuke"],
      ["ids", target],
    ]);
    expect(unknown.status).toBe(400);

    const forged = await post("/admin/m/sales_order/bulk", [
      ["csrf_token", "nope"],
      ["action", "delete"],
      ["ids", target],
    ]);
    expect(forged.status).toBe(403);
    expect(await orderBy("ORD-3")).not.toBeNull();
  });

  it("runs a custom action with the checked ids and the acting principal", async () => {
    const page = await (await call("/admin/m/sales_order")).text();
    const target = String((await orderBy("ORD-4"))?.id);

    const res = await post("/admin/m/sales_order/bulk", [
      ["csrf_token", csrfFrom(page)],
      ["action", "custom:marcar-como-pago"],
      ["ids", target],
    ]);
    expect(flashOf(res)).toEqual({
      text: "1 pedidos marcados como pagos.",
      level: "success",
    });
    expect(seen.ids).toEqual([target]);
    expect(seen.principalKnown).toBe(true);
    expect((await orderBy("ORD-4"))?.status).toBe("paid");
  });

  it("turns a throwing action into an error banner, not a 500", async () => {
    const page = await (await call("/admin/m/sales_order")).text();
    const res = await post("/admin/m/sales_order/bulk", [
      ["csrf_token", csrfFrom(page)],
      ["action", "custom:explode"],
      ["ids", String((await orderBy("ORD-5"))?.id)],
    ]);
    expect(res.status).toBe(302);
    const flash = flashOf(res);
    expect(flash.level).toBe("error");
    expect(flash.text).toContain("handler blew up");
  });

  it("flashes nothing when an action returns null", async () => {
    const page = await (await call("/admin/m/sales_order")).text();
    const res = await post("/admin/m/sales_order/bulk", [
      ["csrf_token", csrfFrom(page)],
      ["action", "custom:quiet"],
      ["ids", String((await orderBy("ORD-5"))?.id)],
    ]);
    expect(res.headers.get("location")).toBe("/admin/m/sales_order");
  });

  it("deletes the checked rows", async () => {
    const page = await (await call("/admin/m/sales_order")).text();
    const res = await post("/admin/m/sales_order/bulk", [
      ["csrf_token", csrfFrom(page)],
      ["action", "delete"],
      ["ids", String((await orderBy("ORD-6"))?.id)],
    ]);
    expect(flashOf(res).text).toBe("Deleted 1 record.");
    expect(await orderBy("ORD-6")).toBeNull();
  });

  it("offers no mutating action when the configuration forbids them", () => {
    const readOnly = new AdminModel({
      model: OrderModel,
      canEdit: false,
      canDelete: false,
    });
    const site = new AdminSite();
    site.register(readOnly);
    expect(readOnly.customActions()).toEqual([]);
  });

  it("slugifies an action name and refuses a duplicate", () => {
    expect(adminAction({ label: "Enviar boas-vindas" }, async () => null).name).toBe(
      "enviar-boas-vindas",
    );
    expect(adminAction({ label: "Ação especial" }, async () => null).name).toBe(
      "acao-especial",
    );
    const twice = adminAction({ label: "Twice", name: "twice" }, async () => null);
    expect(() => new AdminModel({ model: OrderModel, actions: [twice, twice] })).toThrow(
      /Duplicate admin action/,
    );
  });
});

describe("export", () => {
  it("exports CSV honouring search, filters and sorting", async () => {
    const res = await call("/admin/m/sales_order/export.csv?q=ORD-2");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="sales_order.csv"',
    );
    const body = await res.text();
    const lines = body.trimEnd().split("\r\n");
    expect(lines[0]).toBe("reference,status,isActive,notes");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("ORD-2");
  });

  it("quotes a value carrying commas, quotes and newlines", async () => {
    const body = await (await call("/admin/m/sales_order/export.csv?q=ORD-1")).text();
    expect(body).toContain('"Contains ""quotes"", a comma and\na newline"');
  });

  it("exports JSON as an array of column objects", async () => {
    const res = await call("/admin/m/sales_order/export.json?q=ORD-3");
    expect(res.headers.get("content-type")).toContain("application/json");
    const rows = (await res.json()) as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reference).toBe("ORD-3");
    expect(Object.keys(rows[0] ?? {})).toEqual([
      "reference",
      "status",
      "isActive",
      "notes",
    ]);
  });

  it("caps the export at exportMaxRows", async () => {
    const body = await (await call("/admin/m/sales_order/export.csv")).text();
    expect(body.trimEnd().split("\r\n")).toHaveLength(5);
  });

  it("404s an unsupported format", async () => {
    expect((await call("/admin/m/sales_order/export.xml")).status).toBe(404);
  });

  it("requires a session", async () => {
    const res = await fetch(`${base}/admin/m/sales_order/export.csv`, {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
  });
});

describe("foreign-key select", () => {
  it("lists the editable foreign keys of a model", () => {
    const admin = new AdminModel({ model: OrderModel });
    expect(foreignKeyFields(admin)).toEqual({
      userId: "user",
      externalId: "legacy_thing",
    });
  });

  it("labels a related row by the referenced admin's search field", () => {
    const users = new AdminModel({ model: UserModel, searchFields: ["name"] });
    expect(foreignKeyLabel(users, { id: "u1", name: "Root", email: "r@x.com" })).toBe(
      "Root",
    );
    expect(foreignKeyLabel(users, { id: "u1", name: "", email: "r@x.com" })).toBe(
      "r@x.com",
    );
    expect(foreignKeyLabel(users, { id: "u1" })).toBe("u1");
  });

  it("renders a managed FK as a dropdown and an unmanaged one as text", async () => {
    const html = await (await call("/admin/m/sales_order/new")).text();
    expect(html).toContain('<select name="userId"');
    expect(html).toContain(`<option value="${ownerId}">Root</option>`);
    expect(html).toContain('<input type="text" name="externalId"');
  });

  it("offers the related rows as a list filter", async () => {
    const html = await (await call("/admin/m/sales_order")).text();
    expect(html).toContain('name="filter_userId"');
    expect(html).toMatch(new RegExp(`<option value="${ownerId}"[^>]*>Root</option>`));
  });

  it("filters the list by the selected related row", async () => {
    const match = await (
      await call(`/admin/m/sales_order?filter_userId=${ownerId}`)
    ).text();
    expect(match).toContain("5 records.");
    const miss = await (
      await call("/admin/m/sales_order?filter_userId=00000000000000000000000000000000")
    ).text();
    expect(miss).toContain("0 records.");
  });

  it("keeps FK options out of enum validation", () => {
    const admin = new AdminModel({ model: OrderModel });
    const fields = buildFormFields(admin, {
      foreignKeyOptions: { userId: [{ value: ownerId, label: "Root" }] },
    });
    const userField = fields.find((field) => field.name === "userId");
    expect(userField?.widget).toBe("select");
    expect(userField?.options).toEqual([{ value: ownerId, label: "Root" }]);
  });
});
