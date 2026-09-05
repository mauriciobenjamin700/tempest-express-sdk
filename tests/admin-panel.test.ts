import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  type AdminMfaVerifier,
  AdminModel,
  AdminSessionStore,
  AdminSite,
  BaseModel,
  BaseRepository,
  BaseUserModel,
  PasswordUtils,
  type TestDatabase,
  UserModelAuthBackend,
  buildFormFields,
  column,
  createApp,
  createTestDatabase,
  makeAdminRouter,
  parseFormBody,
  resolveAdminTheme,
  runServer,
} from "@/index";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

class UserModel extends BaseUserModel {
  static override tablename = "user";
  name = column.varchar(120).notNull();
}

class WidgetModel extends BaseModel {
  static override tablename = "widget";
  label = column.varchar(80).notNull();
  status = column.enum("draft", "live").notNull().default("draft");
  quantity = column.integer().notNull().default(0);
  notes = column.text();
}

const SECRET = "a-test-secret-that-is-long-enough-32";

let db: TestDatabase;
let server: Server;
let base: string;
let cookie = "";
let mfaRequired = false;
let mfaCode = "424242";

/** Verifier that flips with the `mfaRequired` flag, so both paths are covered. */
const mfa: AdminMfaVerifier = {
  isEnabled: () => Promise.resolve(mfaRequired),
  verify: (_userId, code) => Promise.resolve(code === mfaCode),
};

/** Fetch without following redirects, carrying the current session cookie. */
function call(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cookie !== "") headers.set("cookie", cookie);
  return fetch(`${base}${path}`, { ...init, headers, redirect: "manual" });
}

/** POST a form-encoded body. */
function post(path: string, fields: Record<string, string>): Promise<Response> {
  return call(path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

/** Remember the session cookie a response sets. */
function captureCookie(res: Response): void {
  const header = res.headers.get("set-cookie");
  if (header === null) return;
  const value = header.split(";")[0] ?? "";
  cookie = value.endsWith("=") ? "" : value;
}

/** Pull the CSRF token out of a rendered page. */
function csrfFrom(html: string): string {
  return /name="csrf_token" value="([^"]+)"/.exec(html)?.[1] ?? "";
}

/** Sign in as the seeded admin and keep the resulting cookie. */
async function login(
  email = "root@example.com",
  password = "hunter2hunter2",
): Promise<Response> {
  const res = await post("/admin/login", { identifier: email, password });
  captureCookie(res);
  return res;
}

beforeAll(async () => {
  db = createTestDatabase([UserModel, WidgetModel]);
  const passwords = new PasswordUtils(4);
  const userRepo = new BaseRepository(UserModel, db.session());
  await userRepo.create({
    email: "root@example.com",
    hashedPassword: await passwords.hash("hunter2hunter2"),
    isAdmin: true,
    name: "Root",
    lastLoginAt: null,
  });
  await userRepo.create({
    email: "plain@example.com",
    hashedPassword: await passwords.hash("hunter2hunter2"),
    isAdmin: false,
    name: "Plain",
    lastLoginAt: null,
  });

  const widgetRepo = new BaseRepository(WidgetModel, db.session());
  for (let index = 1; index <= 7; index += 1) {
    await widgetRepo.create({
      label: index % 2 === 0 ? `Even ${index}` : `Odd ${index}`,
      status: index > 5 ? "live" : "draft",
      quantity: index,
      notes: null,
    });
  }

  const site = new AdminSite({ title: "Test Admin", brand: "test-admin" });
  site.register(
    new AdminModel({
      model: WidgetModel,
      listDisplay: ["label", "status", "quantity", "isActive"],
      listFilter: ["status", "isActive", "createdAt"],
      searchFields: ["label"],
      pageSize: 5,
      ordering: "label",
    }),
  );
  site.automap([UserModel], { listDisplay: ["email", "name", "isAdmin"] });

  const app = await createApp({
    health: false,
    configure: (a) => {
      a.use(
        makeAdminRouter(site, {
          engine: db.engine,
          authBackend: new UserModelAuthBackend(UserModel, { passwords, mfa }),
          secretKey: SECRET,
          cookieSecure: false,
        }),
      );
    },
  });
  server = await runServer(app, { port: 0 });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.close();
  await db.close();
});

describe("admin panel · chrome and auth", () => {
  it("serves the bundled stylesheet", async () => {
    const res = await call("/admin/static/admin.css");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/css");
    expect(await res.text()).toContain("--tempest-accent");
  });

  it("redirects an anonymous visitor to the login page", async () => {
    const res = await call("/admin/");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/login");
  });

  it("renders the login form with the site brand", async () => {
    const html = await (await call("/admin/login")).text();
    expect(html).toContain("test-admin");
    expect(html).toContain('name="identifier"');
  });

  it("rejects bad credentials", async () => {
    const res = await post("/admin/login", {
      identifier: "root@example.com",
      password: "wrong",
    });
    expect(res.status).toBe(401);
    expect(await res.text()).toContain("Invalid credentials");
  });

  it("rejects a non-admin row", async () => {
    const res = await post("/admin/login", {
      identifier: "plain@example.com",
      password: "hunter2hunter2",
    });
    expect(res.status).toBe(401);
  });

  it("signs an admin in and shows the dashboard", async () => {
    const res = await login();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/");
    expect(cookie).toContain("tempest_admin_session=");

    const html = await (await call("/admin/")).text();
    expect(html).toContain("Widgets");
    expect(html).toContain("Users");
    expect(html).toContain(">7<");
    expect(html).toContain("CPU");
  });

  it("drops the session on logout", async () => {
    const page = await (await call("/admin/")).text();
    const res = await post("/admin/logout", { csrf_token: csrfFrom(page) });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/login");
    captureCookie(res);
    expect((await call("/admin/")).status).toBe(302);
    await login();
  });
});

describe("admin panel · list view", () => {
  it("paginates and sorts", async () => {
    const first = await (await call("/admin/m/widget")).text();
    expect(first).toContain("7 records.");
    expect(first).toContain("Page 1 of 2");
    expect(first.indexOf("Even 2")).toBeLessThan(first.indexOf("Odd 1"));

    const descending = await (await call("/admin/m/widget?sort=label&dir=desc")).text();
    expect(descending.indexOf("Odd 7")).toBeLessThan(descending.indexOf("Even 6"));

    const second = await (await call("/admin/m/widget?page=2")).text();
    expect(second).toContain("Page 2 of 2");
  });

  it("searches the configured text columns", async () => {
    const html = await (await call("/admin/m/widget?q=Even")).text();
    expect(html).toContain("3 records.");
    expect(html).not.toContain("Odd 1");
  });

  it("filters by enum, boolean and date range", async () => {
    const live = await (await call("/admin/m/widget?filter_status=live")).text();
    expect(live).toContain("2 records.");

    const inactive = await (await call("/admin/m/widget?filter_isActive=false")).text();
    expect(inactive).toContain("0 records.");

    const future = await (
      await call("/admin/m/widget?filter_createdAt_from=2999-01-01")
    ).text();
    expect(future).toContain("0 records.");
  });

  it("renders a filter control per configured column", async () => {
    const html = await (await call("/admin/m/widget")).text();
    expect(html).toContain('name="filter_status"');
    expect(html).toContain('name="filter_createdAt_from"');
    expect(html).toContain('type="search"');
  });

  it("404s an unknown slug", async () => {
    expect((await call("/admin/m/nope")).status).toBe(404);
  });
});

describe("admin panel · CRUD", () => {
  it("creates a record through the generated form", async () => {
    const form = await (await call("/admin/m/widget/new")).text();
    expect(form).toContain('name="label"');
    expect(form).toContain('name="status"');
    expect(form).toContain('type="number"');

    const res = await post("/admin/m/widget/new", {
      csrf_token: csrfFrom(form),
      label: "Created",
      status: "live",
      quantity: "42",
      notes: "",
      isActive: "true",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/m/widget?ok=created");

    const list = await (await call("/admin/m/widget?q=Created")).text();
    expect(list).toContain("Created");
  });

  it("re-renders the form with a field error on invalid input", async () => {
    const form = await (await call("/admin/m/widget/new")).text();
    const res = await post("/admin/m/widget/new", {
      csrf_token: csrfFrom(form),
      label: "",
      status: "live",
      quantity: "not-a-number",
    });
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain("This field is required.");
    expect(html).toContain("Enter a valid number.");
  });

  it("rejects a write without a matching CSRF token", async () => {
    const res = await post("/admin/m/widget/new", {
      csrf_token: "forged",
      label: "Nope",
      status: "draft",
      quantity: "1",
    });
    expect(res.status).toBe(403);
  });

  it("edits and then deletes a record", async () => {
    const list = await (await call("/admin/m/widget?q=Created")).text();
    const identity = /\/admin\/m\/widget\/([0-9a-f-]{32,36})/.exec(list)?.[1] ?? "";
    expect(identity).not.toBe("");

    const detail = await (await call(`/admin/m/widget/${identity}`)).text();
    expect(detail).toContain("Created");
    expect(detail).toContain("Edit");

    const editForm = await (await call(`/admin/m/widget/${identity}/edit`)).text();
    expect(editForm).toContain('value="Created"');

    const updated = await post(`/admin/m/widget/${identity}/edit`, {
      csrf_token: csrfFrom(editForm),
      label: "Renamed",
      status: "draft",
      quantity: "7",
      notes: "hello",
      isActive: "true",
    });
    expect(updated.status).toBe(302);
    expect(await (await call(`/admin/m/widget/${identity}`)).text()).toContain("Renamed");

    const removed = await post(`/admin/m/widget/${identity}/delete`, {
      csrf_token: csrfFrom(detail),
    });
    expect(removed.status).toBe(302);
    expect((await call(`/admin/m/widget/${identity}`)).status).toBe(404);
  });

  it("404s the write routes a configuration disables", async () => {
    const readOnly = new AdminSite({ title: "Read only" });
    readOnly.register(
      new AdminModel({
        model: WidgetModel,
        canCreate: false,
        canEdit: false,
        canDelete: false,
      }),
    );
    const app = await createApp({
      health: false,
      configure: (a) => {
        a.use(
          makeAdminRouter(readOnly, {
            engine: db.engine,
            authBackend: new UserModelAuthBackend(UserModel, {
              passwords: new PasswordUtils(4),
            }),
            secretKey: SECRET,
            cookieSecure: false,
          }),
        );
      },
    });
    const other = await runServer(app, { port: 0 });
    const otherBase = `http://127.0.0.1:${(other.address() as AddressInfo).port}`;
    try {
      const signIn = await fetch(`${otherBase}/admin/login`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          identifier: "root@example.com",
          password: "hunter2hunter2",
        }).toString(),
        redirect: "manual",
      });
      const otherCookie = (signIn.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
      const headers = { cookie: otherCookie };

      const list = await fetch(`${otherBase}/admin/m/widget`, { headers });
      expect(await list.text()).not.toContain("+ New");

      const create = await fetch(`${otherBase}/admin/m/widget/new`, {
        headers,
        redirect: "manual",
      });
      expect(create.status).toBe(404);
    } finally {
      other.close();
    }
  });
});

describe("admin panel · MFA", () => {
  it("challenges a principal with a second factor", async () => {
    mfaRequired = true;
    cookie = "";
    const res = await login();
    expect(res.headers.get("location")).toBe("/admin/mfa");

    const blocked = await call("/admin/");
    expect(blocked.status).toBe(302);
    expect(blocked.headers.get("location")).toBe("/admin/mfa");

    const bad = await post("/admin/mfa", { code: "000000" });
    expect(bad.status).toBe(401);

    const good = await post("/admin/mfa", { code: mfaCode });
    captureCookie(good);
    expect(good.headers.get("location")).toBe("/admin/");
    expect((await call("/admin/")).status).toBe(200);

    mfaRequired = false;
    mfaCode = "424242";
    cookie = "";
    await login();
  });
});

describe("admin configuration", () => {
  it("derives slug, labels and editable fields from the model", () => {
    const admin = new AdminModel({ model: WidgetModel });
    expect(admin.slug()).toBe("widget");
    expect(admin.verboseName()).toBe("Widget");
    expect(admin.verboseNamePlural()).toBe("Widgets");
    expect(admin.editableFieldNames()).toEqual([
      "isActive",
      "label",
      "status",
      "quantity",
      "notes",
    ]);
    expect(admin.listDisplayNames()).toContain("createdAt");
  });

  it("shows every column on the detail view, even ones the list hides", () => {
    const admin = new AdminModel({ model: WidgetModel, listDisplay: ["label"] });
    expect(admin.listDisplayNames()).toEqual(["label"]);
    expect(admin.detailFieldNames()).toContain("notes");
    expect(admin.detailFieldNames()).not.toContain("createdAt");
    expect(admin.auditFieldNames()).toEqual(["createdAt", "updatedAt"]);
  });

  it("rejects a reference to an unknown column", () => {
    expect(() => new AdminModel({ model: WidgetModel, searchFields: ["nope"] })).toThrow(
      /unknown column/,
    );
  });

  it("refuses to register two configurations under one slug", () => {
    const site = new AdminSite();
    site.register({ model: WidgetModel });
    expect(() => site.register({ model: WidgetModel })).toThrow(/already registered/);
  });

  it("automaps a models namespace and skips abstract bases", () => {
    const site = new AdminSite();
    const registered = site.automap({ WidgetModel, UserModel, BaseModel, BaseUserModel });
    expect(registered.map((admin) => admin.slug())).toEqual(["user", "widget"]);
  });

  it("honours exclude and skipRegistered", () => {
    const site = new AdminSite();
    site.register({ model: WidgetModel, pageSize: 5 });
    const registered = site.automap([WidgetModel, UserModel], { exclude: ["user"] });
    expect(registered).toEqual([]);
    expect(site.get("widget")?.pageSize).toBe(5);
  });
});

describe("admin forms", () => {
  it("derives a widget per column type", () => {
    const fields = buildFormFields(new AdminModel({ model: WidgetModel }));
    const byName = Object.fromEntries(fields.map((field) => [field.name, field]));
    expect(byName.label?.widget).toBe("text");
    expect(byName.status?.widget).toBe("select");
    expect(byName.status?.options.map((option) => option.value)).toEqual([
      "draft",
      "live",
    ]);
    expect(byName.quantity?.widget).toBe("number");
    expect(byName.quantity?.step).toBe("1");
    expect(byName.notes?.widget).toBe("textarea");
    expect(byName.isActive?.widget).toBe("checkbox");
    expect(byName.label?.required).toBe(true);
    expect(byName.notes?.required).toBe(false);
  });

  it("coerces a submitted body and reports per-field errors", () => {
    const admin = new AdminModel({ model: WidgetModel });
    const ok = parseFormBody(admin, {
      label: "Hi",
      status: "live",
      quantity: "3",
      notes: "",
      isActive: "true",
    });
    expect(ok.errors).toEqual({});
    expect(ok.data.quantity).toBe(3);
    expect(ok.data.isActive).toBe(true);
    expect(ok.data.notes).toBeNull();

    const bad = parseFormBody(admin, { label: "", status: "nope", quantity: "1.5" });
    expect(bad.errors.label).toBe("This field is required.");
    expect(bad.errors.status).toContain("Choose one of");
    expect(bad.errors.quantity).toBe("Enter a whole number.");
  });

  it("pre-fills a blank create form with the column defaults", () => {
    const fields = buildFormFields(new AdminModel({ model: WidgetModel }));
    const byName = Object.fromEntries(fields.map((field) => [field.name, field]));
    expect(byName.isActive?.checked).toBe(true);
    expect(byName.status?.value).toBe("draft");
    expect(byName.quantity?.value).toBe("0");
    expect(byName.notes?.value).toBe("");
  });

  it("keeps an explicit value over the column default", () => {
    const fields = buildFormFields(new AdminModel({ model: WidgetModel }), {
      values: { isActive: false, status: "live", quantity: 9 },
    });
    const byName = Object.fromEntries(fields.map((field) => [field.name, field]));
    expect(byName.isActive?.checked).toBe(false);
    expect(byName.status?.value).toBe("live");
    expect(byName.quantity?.value).toBe("9");
  });

  it("treats an absent checkbox as false", () => {
    const parsed = parseFormBody(new AdminModel({ model: WidgetModel }), {
      label: "Hi",
      status: "draft",
      quantity: "1",
    });
    expect(parsed.data.isActive).toBe(false);
  });
});

describe("admin theme", () => {
  it("emits the custom properties it overrides", () => {
    const theme = resolveAdminTheme({ accent: "#7c3aed", darkMode: true });
    expect(theme.sidebarBg).toBe(theme.headerBg);
    expect(theme.accent).toBe("#7c3aed");
  });

  it("refuses a value that would break the injected style block", () => {
    expect(() => resolveAdminTheme({ accent: "red}</style><script>" })).toThrow(
      /forbidden character/,
    );
  });
});

describe("admin session store", () => {
  it("rejects a tampered cookie", () => {
    const store = new AdminSessionStore({ secret: SECRET, cookieSecure: false });
    const session = store.issue("user-1", "Root");
    expect(session.mfaPassed).toBe(true);
    expect(() => new AdminSessionStore({ secret: "too-short" })).toThrow(/at least 32/);
  });
});
