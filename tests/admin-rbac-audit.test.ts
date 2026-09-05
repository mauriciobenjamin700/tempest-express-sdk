import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  type AdminAccessPolicy,
  AdminModel,
  AdminPermission,
  AdminSite,
  AuditAction,
  BaseAuditLogModel,
  BaseModel,
  BaseRepository,
  BaseUserModel,
  PasswordUtils,
  type TestDatabase,
  UserModelAuthBackend,
  adminLens,
  column,
  createApp,
  createTestDatabase,
  createdByColumn,
  makeAdminRouter,
  metricCard,
  partitionTotal,
  runServer,
  trendDirection,
  trendPercent,
  updatedByColumn,
} from "@/index";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

class UserModel extends BaseUserModel {
  static override tablename = "user";
  name = column.varchar(120).notNull();
  role = column.enum("superadmin", "support").notNull().default("support");
}

class TicketModel extends BaseModel {
  static override tablename = "ticket";
  subject = column.varchar(120).notNull();
  status = column.enum("open", "closed").notNull().default("open");
  priority = column.integer().notNull().default(1);
  createdBy = createdByColumn();
  updatedBy = updatedByColumn();
}

class SecretModel extends BaseModel {
  static override tablename = "secret";
  value = column.varchar(60).notNull();
}

class AuditLogModel extends BaseAuditLogModel {
  static override tablename = "audit_log";
}

const SECRET = "a-test-secret-that-is-long-enough-32";

let db: TestDatabase;
let server: Server;
let base: string;
let cookie = "";
let rootId = "";
let policy: AdminAccessPolicy = () => true;
let seenActions: AdminPermission[] = [];

function call(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cookie !== "") headers.set("cookie", cookie);
  return fetch(`${base}${path}`, { ...init, headers, redirect: "manual" });
}

function post(path: string, fields: Record<string, string>): Promise<Response> {
  return call(path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

function csrfFrom(html: string): string {
  return /name="csrf_token" value="([^"]+)"/.exec(html)?.[1] ?? "";
}

async function ticketBy(subject: string): Promise<Record<string, unknown> | null> {
  const repo = new BaseRepository(TicketModel, db.session());
  return (await repo.first({ subject } as never)) as Record<string, unknown> | null;
}

beforeAll(async () => {
  db = createTestDatabase([UserModel, TicketModel, SecretModel, AuditLogModel]);
  const passwords = new PasswordUtils(4);
  const users = new BaseRepository(UserModel, db.session());
  const root = await users.create({
    email: "root@example.com",
    hashedPassword: await passwords.hash("hunter2hunter2"),
    isAdmin: true,
    name: "Root",
    role: "superadmin",
    lastLoginAt: null,
  });
  rootId = String((root as unknown as { id: string }).id);

  const tickets = new BaseRepository(TicketModel, db.session());
  for (const [subject, status, priority] of [
    ["Urgent crash", "open", 5],
    ["Cold ticket", "open", 1],
    ["Old business", "closed", 3],
  ] as const) {
    await tickets.create({
      subject,
      status,
      priority,
      createdBy: null,
      updatedBy: null,
    });
  }
  await new BaseRepository(SecretModel, db.session()).create({ value: "hidden" });

  const site = new AdminSite({
    title: "RBAC Admin",
    dashboardCards: [
      metricCard(
        "Open tickets",
        async (session) => ({
          kind: "value",
          value: await new BaseRepository(TicketModel, session).count({
            status: "open",
          } as never),
          unit: "tickets",
        }),
        "Since forever",
      ),
      metricCard("Week over week", async () => ({
        kind: "trend",
        value: 12,
        previous: 8,
        unit: "tickets",
      })),
      metricCard("By status", async () => ({
        kind: "partition",
        segments: [
          { label: "Open", value: 2 },
          { label: "Closed", value: 1 },
        ],
      })),
      metricCard("Broken", async () => {
        throw new Error("metric query blew up");
      }),
    ],
  });
  site.register(
    new AdminModel({
      model: TicketModel,
      listDisplay: ["subject", "status", "priority"],
      searchFields: ["subject"],
      ordering: "subject",
      auditModel: AuditLogModel,
      lenses: [
        adminLens({
          name: "Triage aberta",
          filters: { status: "open" },
          orderBy: "-priority",
        }),
        adminLens({ name: "Fechadas", filters: { status: "closed" } }),
      ],
    }),
  );
  site.register(new AdminModel({ model: SecretModel }));
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
          accessPolicy: (principal, admin, action) => {
            seenActions.push(action);
            return policy(principal, admin, action);
          },
        }),
      );
    },
  });
  server = await runServer(app, { port: 0 });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const login = await post("/admin/login", {
    identifier: "root@example.com",
    password: "hunter2hunter2",
  });
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
});

afterAll(async () => {
  server.close();
  await db.close();
});

describe("access policy", () => {
  it("allows everything when no policy denies", async () => {
    policy = () => true;
    const dash = await (await call("/admin/")).text();
    expect(dash).toContain("Tickets");
    expect(dash).toContain("Secrets");
  });

  it("hides a model the principal may not view, from nav and dashboard", async () => {
    policy = (_principal, admin) => admin.slug() !== "secret";
    const dash = await (await call("/admin/")).text();
    expect(dash).toContain("Tickets");
    expect(dash).not.toContain("Secrets");
    expect((await call("/admin/m/secret")).status).toBe(404);
    policy = () => true;
  });

  it("403s a write the policy refuses but the flags allow", async () => {
    policy = (_principal, _admin, action) => action !== AdminPermission.CREATE;
    expect((await call("/admin/m/ticket/new")).status).toBe(403);
    const list = await (await call("/admin/m/ticket")).text();
    expect(list).not.toContain("+ New");
    policy = () => true;
  });

  it("404s a write the flags disable, before consulting the policy", async () => {
    const site = new AdminSite({ title: "Flags" });
    site.register(new AdminModel({ model: TicketModel, canCreate: false }));
    const app = await createApp({
      health: false,
      configure: (a) => {
        a.use(
          makeAdminRouter(site, {
            engine: db.engine,
            authBackend: new UserModelAuthBackend(UserModel, {
              passwords: new PasswordUtils(4),
            }),
            secretKey: SECRET,
            cookieSecure: false,
            accessPolicy: () => true,
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
      const res = await fetch(`${otherBase}/admin/m/ticket/new`, {
        headers: { cookie: otherCookie },
        redirect: "manual",
      });
      expect(res.status).toBe(404);
    } finally {
      other.close();
    }
  });

  it("asks the policy for the action actually being attempted", async () => {
    policy = () => true;
    seenActions = [];
    await call("/admin/m/ticket/new");
    expect(seenActions).toContain(AdminPermission.CREATE);
  });
});

describe("audit trail", () => {
  it("stamps createdBy on create and updatedBy on edit", async () => {
    const form = await (await call("/admin/m/ticket/new")).text();
    const created = await post("/admin/m/ticket/new", {
      csrf_token: csrfFrom(form),
      subject: "Stamped",
      status: "open",
      priority: "2",
      isActive: "true",
    });
    expect(created.status).toBe(302);

    const row = await ticketBy("Stamped");
    expect(row?.createdBy).toBe(rootId);
    expect(row?.updatedBy).toBe(rootId);
  });

  it("shows timestamps and the resolved actor in the audit panel", async () => {
    const row = await ticketBy("Stamped");
    const html = await (await call(`/admin/m/ticket/${row?.id}`)).text();
    expect(html).toContain("<h2>Audit</h2>");
    expect(html).toContain("Created By");
    expect(html).toContain("root@example.com");
    expect(html).not.toMatch(/<dt>createdAt<\/dt>/);
  });

  it("renders the change timeline from the audit model", async () => {
    const row = await ticketBy("Stamped");
    await new BaseRepository(AuditLogModel, db.session()).create({
      entity: "TicketModel",
      entityId: String(row?.id),
      action: AuditAction.UPDATE,
      actor: rootId,
      changes: { status: { before: "open", after: "closed" } },
      context: { requestId: "abc-123" },
    });

    const html = await (await call(`/admin/m/ticket/${row?.id}`)).text();
    expect(html).toContain("tempest-admin-history");
    expect(html).toContain(">update<");
    expect(html).toContain("<td>status</td>");
    expect(html).toContain("<td>open</td>");
    expect(html).toContain("<td>closed</td>");
    expect(html).toContain("abc-123");
  });

  it("omits the timeline for a model without an audit model", async () => {
    const secret = (await new BaseRepository(SecretModel, db.session()).first(
      {} as never,
    )) as Record<string, unknown>;
    const html = await (await call(`/admin/m/secret/${secret.id}`)).text();
    expect(html).toContain("<h2>Audit</h2>");
    expect(html).not.toContain("tempest-admin-history");
  });
});

describe("dashboard metric cards", () => {
  it("renders value, trend and partition cards", async () => {
    const html = await (await call("/admin/")).text();
    expect(html).toContain("Open tickets");
    expect(html).toContain("tempest-admin-card--trend");
    expect(html).toContain("+50.0%");
    expect(html).toContain("tempest-admin-card--partition");
    expect(html).toContain("Since forever");
  });

  it("keeps the dashboard up when one card throws", async () => {
    const html = await (await call("/admin/")).text();
    expect(html).toContain("Could not compute this metric.");
    expect(html).toContain("Open tickets");
  });

  it("computes trend maths without a baseline", () => {
    expect(trendPercent({ kind: "trend", value: 5, previous: 4 })).toBeCloseTo(25);
    expect(trendPercent({ kind: "trend", value: 5, previous: 0 })).toBeNull();
    expect(trendDirection({ kind: "trend", value: 1, previous: 1 })).toBe("flat");
    expect(trendDirection({ kind: "trend", value: 0, previous: 1 })).toBe("down");
    expect(
      partitionTotal({
        kind: "partition",
        segments: [
          { label: "a", value: 2 },
          { label: "b", value: 3 },
        ],
      }),
    ).toBe(5);
  });
});

describe("lenses", () => {
  it("renders a tab strip with an All tab", async () => {
    const html = await (await call("/admin/m/ticket")).text();
    expect(html).toContain("tempest-admin-lenses");
    expect(html).toContain(">All<");
    expect(html).toContain("lens=triage-aberta");
    expect(html).toContain(">Fechadas<");
  });

  it("applies the lens filters and ordering", async () => {
    const open = await (await call("/admin/m/ticket?lens=triage-aberta")).text();
    expect(open).toContain("tempest-admin-lens--active");
    expect(open).not.toContain("Old business");
    expect(open.indexOf("Urgent crash")).toBeLessThan(open.indexOf("Cold ticket"));

    const closed = await (await call("/admin/m/ticket?lens=fechadas")).text();
    expect(closed).toContain("1 record.");
    expect(closed).toContain("Old business");
  });

  it("ANDs the lens with the operator's own search", async () => {
    const html = await (await call("/admin/m/ticket?lens=fechadas&q=Urgent")).text();
    expect(html).toContain("0 records.");
  });

  it("carries the lens through export and pagination links", async () => {
    const html = await (await call("/admin/m/ticket?lens=fechadas")).text();
    expect(html).toContain("export.csv?lens=fechadas");
    const csv = await (await call("/admin/m/ticket/export.csv?lens=fechadas")).text();
    expect(csv.trimEnd().split("\r\n")).toHaveLength(2);
  });

  it("ignores an unknown lens slug", async () => {
    const html = await (await call("/admin/m/ticket?lens=nope")).text();
    expect(html).toContain("4 records.");
  });

  it("slugifies the lens name", () => {
    expect(adminLens({ name: "Triage aberta" }).slug).toBe("triage-aberta");
    expect(adminLens({ name: "Ação urgente" }).slug).toBe("acao-urgente");
    expect(adminLens({ name: "X", label: "Custom" }).label).toBe("Custom");
  });
});
