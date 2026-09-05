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
  adminInline,
  column,
  createApp,
  createTestDatabase,
  groupInlineSubmission,
  makeAdminRouter,
  runServer,
} from "@/index";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

class UserModel extends BaseUserModel {
  static override tablename = "user";
  name = column.varchar(120).notNull();
}

class OrderModel extends BaseModel {
  static override tablename = "sales_order";
  reference = column.varchar(60).notNull();
}

class OrderItemModel extends BaseModel {
  static override tablename = "order_item";
  orderId = column.uuid().references("sales_order.id").notNull();
  sku = column.varchar(40).notNull();
  quantity = column.integer().notNull().default(1);
}

class OrderNoteModel extends BaseModel {
  static override tablename = "order_note";
  orderId = column.uuid().references("sales_order.id").notNull();
  body = column.text().notNull();
}

const SECRET = "a-test-secret-that-is-long-enough-32";

let db: TestDatabase;
let server: Server;
let base: string;
let cookie = "";
let orderId = "";
let otherOrderId = "";

function call(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cookie !== "") headers.set("cookie", cookie);
  return fetch(`${base}${path}`, { ...init, headers, redirect: "manual" });
}

function post(path: string, pairs: [string, string][]): Promise<Response> {
  const body = new URLSearchParams();
  for (const [key, value] of pairs) body.append(key, value);
  return call(path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
}

function csrfFrom(html: string): string {
  return /name="csrf_token" value="([^"]+)"/.exec(html)?.[1] ?? "";
}

async function items(): Promise<Record<string, unknown>[]> {
  const repo = new BaseRepository(OrderItemModel, db.session());
  return (await repo.list({ orderId } as never)) as Record<string, unknown>[];
}

async function itemBySku(sku: string): Promise<Record<string, unknown> | null> {
  const repo = new BaseRepository(OrderItemModel, db.session());
  return (await repo.first({ sku } as never)) as Record<string, unknown> | null;
}

beforeAll(async () => {
  db = createTestDatabase([UserModel, OrderModel, OrderItemModel, OrderNoteModel]);
  const passwords = new PasswordUtils(4);
  await new BaseRepository(UserModel, db.session()).create({
    email: "root@example.com",
    hashedPassword: await passwords.hash("hunter2hunter2"),
    isAdmin: true,
    name: "Root",
    lastLoginAt: null,
  });

  const orders = new BaseRepository(OrderModel, db.session());
  const order = await orders.create({ reference: "ORD-1" });
  orderId = String((order as unknown as { id: string }).id);
  const other = await orders.create({ reference: "ORD-2" });
  otherOrderId = String((other as unknown as { id: string }).id);

  const itemRepo = new BaseRepository(OrderItemModel, db.session());
  await itemRepo.create({ orderId, sku: "SKU-1", quantity: 2 });
  await itemRepo.create({ orderId, sku: "SKU-2", quantity: 5 });
  await itemRepo.create({ orderId: otherOrderId, sku: "OTHER-1", quantity: 9 });

  await new BaseRepository(OrderNoteModel, db.session()).create({
    orderId,
    body: "Handle with care",
  });

  const site = new AdminSite({ title: "Inlines Admin" });
  site.register(
    new AdminModel({
      model: OrderModel,
      listDisplay: ["reference"],
      searchFields: ["reference"],
      inlines: [
        adminInline({
          model: OrderItemModel,
          fkField: "orderId",
          editable: true,
          canDelete: true,
        }),
        adminInline({
          model: OrderNoteModel,
          fkField: "orderId",
          label: "Notes",
          listDisplay: ["body"],
        }),
      ],
    }),
  );
  site.register(
    new AdminModel({ model: OrderItemModel, listDisplay: ["sku", "quantity"] }),
  );
  site.register(new AdminModel({ model: OrderNoteModel }));
  site.register(new AdminModel({ model: UserModel, searchFields: ["email"] }));

  const app = await createApp({
    health: false,
    configure: (a) => {
      a.use(
        makeAdminRouter(site, {
          engine: db.engine,
          authBackend: new UserModelAuthBackend(UserModel, { passwords }),
          secretKey: SECRET,
          cookieSecure: false,
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

describe("inline rendering", () => {
  it("renders an editable formset and a read-only table", async () => {
    const html = await (await call(`/admin/m/sales_order/${orderId}`)).text();
    expect(html).toContain("tempest-admin-inline");
    expect(html).toContain("Order Items");
    expect(html).toContain("Notes");
    expect(html).toContain('name="row.');
    expect(html).toContain("Handle with care");
    expect(html).toContain("Save Order Items");
  });

  it("shows only the children of this parent", async () => {
    const html = await (await call(`/admin/m/sales_order/${orderId}`)).text();
    expect(html).toContain("SKU-1");
    expect(html).toContain("SKU-2");
    expect(html).not.toContain("OTHER-1");
  });

  it("keeps the parent foreign key out of the formset", async () => {
    const html = await (await call(`/admin/m/sales_order/${orderId}`)).text();
    expect(html).not.toContain("row.new1.orderId");
    expect(html).toContain("row.new1.sku");
  });

  it("offers a blank add row and a delete checkbox", async () => {
    const html = await (await call(`/admin/m/sales_order/${orderId}`)).text();
    expect(html).toContain('class="tempest-admin-inline__new"');
    expect(html).toContain("__delete");
  });
});

describe("inline formset submission", () => {
  it("edits an existing child in place", async () => {
    const page = await (await call(`/admin/m/sales_order/${orderId}`)).text();
    const first = await itemBySku("SKU-1");
    const key = String(first?.id);

    const res = await post(`/admin/m/sales_order/${orderId}/inlines/order_item`, [
      ["csrf_token", csrfFrom(page)],
      [`row.${key}.sku`, "SKU-1-EDITED"],
      [`row.${key}.quantity`, "7"],
      [`row.${key}.isActive`, "true"],
    ]);
    expect(res.status).toBe(302);

    const updated = await itemBySku("SKU-1-EDITED");
    expect(updated?.quantity).toBe(7);
    expect(updated?.orderId).toBe(orderId);
  });

  it("creates a child from the blank row", async () => {
    const page = await (await call(`/admin/m/sales_order/${orderId}`)).text();
    const res = await post(`/admin/m/sales_order/${orderId}/inlines/order_item`, [
      ["csrf_token", csrfFrom(page)],
      ["row.new1.sku", "SKU-NEW"],
      ["row.new1.quantity", "3"],
      ["row.new1.isActive", "true"],
    ]);
    expect(res.status).toBe(302);

    const created = await itemBySku("SKU-NEW");
    expect(created?.orderId).toBe(orderId);
    expect(created?.quantity).toBe(3);
  });

  it("ignores a blank add row", async () => {
    const before = (await items()).length;
    const page = await (await call(`/admin/m/sales_order/${orderId}`)).text();
    await post(`/admin/m/sales_order/${orderId}/inlines/order_item`, [
      ["csrf_token", csrfFrom(page)],
      ["row.new1.sku", ""],
      ["row.new1.quantity", ""],
    ]);
    expect((await items()).length).toBe(before);
  });

  it("deletes a checked row", async () => {
    const target = await itemBySku("SKU-NEW");
    const page = await (await call(`/admin/m/sales_order/${orderId}`)).text();
    const res = await post(`/admin/m/sales_order/${orderId}/inlines/order_item`, [
      ["csrf_token", csrfFrom(page)],
      [`row.${String(target?.id)}.sku`, "SKU-NEW"],
      [`row.${String(target?.id)}.quantity`, "3"],
      [`row.${String(target?.id)}.__delete`, "true"],
    ]);
    expect(res.status).toBe(302);
    expect(await itemBySku("SKU-NEW")).toBeNull();
  });

  it("re-renders with the submitted values and a per-field error", async () => {
    const page = await (await call(`/admin/m/sales_order/${orderId}`)).text();
    const target = await itemBySku("SKU-2");
    const key = String(target?.id);

    const res = await post(`/admin/m/sales_order/${orderId}/inlines/order_item`, [
      ["csrf_token", csrfFrom(page)],
      [`row.${key}.sku`, ""],
      [`row.${key}.quantity`, "not-a-number"],
    ]);
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain("This field is required.");
    expect(html).toContain("Enter a valid number.");
    expect(html).toContain("Some inline rows could not be saved.");
    expect((await itemBySku("SKU-2"))?.quantity).toBe(5);
  });

  it("refuses to touch a child belonging to another parent", async () => {
    const foreign = await itemBySku("OTHER-1");
    const key = String(foreign?.id);
    const page = await (await call(`/admin/m/sales_order/${orderId}`)).text();

    const res = await post(`/admin/m/sales_order/${orderId}/inlines/order_item`, [
      ["csrf_token", csrfFrom(page)],
      [`row.${key}.sku`, "HIJACKED"],
      [`row.${key}.quantity`, "1"],
    ]);
    expect(res.status).toBe(302);

    const untouched = await itemBySku("OTHER-1");
    expect(untouched).not.toBeNull();
    expect(untouched?.orderId).toBe(otherOrderId);
    expect(await itemBySku("HIJACKED")).toBeNull();
  });

  it("refuses to delete a child belonging to another parent", async () => {
    const foreign = await itemBySku("OTHER-1");
    const key = String(foreign?.id);
    const page = await (await call(`/admin/m/sales_order/${orderId}`)).text();

    await post(`/admin/m/sales_order/${orderId}/inlines/order_item`, [
      ["csrf_token", csrfFrom(page)],
      [`row.${key}.sku`, "OTHER-1"],
      [`row.${key}.__delete`, "true"],
    ]);
    expect(await itemBySku("OTHER-1")).not.toBeNull();
  });

  it("enforces CSRF and 404s a non-editable inline", async () => {
    const forged = await post(`/admin/m/sales_order/${orderId}/inlines/order_item`, [
      ["csrf_token", "nope"],
      ["row.new1.sku", "X"],
    ]);
    expect(forged.status).toBe(403);

    const page = await (await call(`/admin/m/sales_order/${orderId}`)).text();
    const readOnly = await post(`/admin/m/sales_order/${orderId}/inlines/order_note`, [
      ["csrf_token", csrfFrom(page)],
      ["row.new1.body", "X"],
    ]);
    expect(readOnly.status).toBe(404);
  });
});

describe("groupInlineSubmission", () => {
  it("groups by row key and collects deletions", () => {
    const { rows, deletions } = groupInlineSubmission({
      csrf_token: "t",
      "row.abc.sku": "S",
      "row.abc.quantity": "2",
      "row.abc.__delete": "true",
      "row.new1.sku": "N",
      "row.def.__delete": "false",
      "not.a.row": "ignored",
    });
    expect(rows).toEqual({
      abc: { sku: "S", quantity: "2" },
      new1: { sku: "N" },
    });
    expect([...deletions]).toEqual(["abc"]);
  });

  it("treats every falsy checkbox token as not-deleted", () => {
    const { deletions } = groupInlineSubmission({
      "row.a.__delete": "",
      "row.b.__delete": "off",
      "row.c.__delete": "0",
      "row.d.__delete": "no",
      "row.e.__delete": "on",
    });
    expect([...deletions]).toEqual(["e"]);
  });
});
