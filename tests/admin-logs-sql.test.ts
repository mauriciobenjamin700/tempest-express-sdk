import { mkdtemp, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AdminModel,
  AdminSite,
  BaseModel,
  BaseRepository,
  BaseUserModel,
  PasswordUtils,
  type SqlAuditEntry,
  SqlCapability,
  type TestDatabase,
  UserModelAuthBackend,
  analyzeSql,
  checkSqlPolicy,
  column,
  createApp,
  createTestDatabase,
  filterLogEntries,
  loadSqlParser,
  makeAdminRouter,
  renderLogEntriesMarkdown,
  runServer,
  toLogEntry,
} from "@/index";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

class UserModel extends BaseUserModel {
  static override tablename = "user";
  name = column.varchar(120).notNull();
}

class WidgetModel extends BaseModel {
  static override tablename = "widget";
  label = column.varchar(80).notNull();
}

const SECRET = "a-test-secret-that-is-long-enough-32";

let db: TestDatabase;
let server: Server;
let base: string;
let cookie = "";
let logDir = "";
const audits: SqlAuditEntry[] = [];

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

async function runSql(sql: string): Promise<Response> {
  const page = await (await call("/admin/sql")).text();
  return post("/admin/sql", { csrf_token: csrfFrom(page), sql });
}

beforeAll(async () => {
  logDir = await mkdtemp(join(tmpdir(), "admin-logs-"));
  await writeFile(
    join(logDir, "error.log"),
    [
      JSON.stringify({
        level: "error",
        logger: "app.api",
        message: "Unhandled exception",
        timestamp: "2026-09-05T10:00:00.000Z",
        stack: "Error: boom\n    at handler (app.ts:1:1)",
        requestId: "req-1",
        path: "/orders",
      }),
      JSON.stringify({
        level: "error",
        logger: "app.db",
        message: "Connection reset",
        timestamp: "2026-09-05T11:00:00.000Z",
      }),
      "{ not json",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(logDir, "info.log"),
    `${JSON.stringify({
      level: "info",
      logger: "app.api",
      message: "Server listening",
      timestamp: "2026-09-05T09:00:00.000Z",
    })}\n`,
  );

  db = createTestDatabase([UserModel, WidgetModel]);
  const passwords = new PasswordUtils(4);
  await new BaseRepository(UserModel, db.session()).create({
    email: "root@example.com",
    hashedPassword: await passwords.hash("hunter2hunter2"),
    isAdmin: true,
    name: "Root",
    lastLoginAt: null,
  });
  const widgets = new BaseRepository(WidgetModel, db.session());
  await widgets.create({ label: "Alpha" });
  await widgets.create({ label: "Beta" });

  const site = new AdminSite({ title: "Ops Admin" });
  site.register(new AdminModel({ model: WidgetModel, listDisplay: ["label"] }));

  const app = await createApp({
    health: false,
    configure: (a) => {
      a.use(
        makeAdminRouter(site, {
          engine: db.engine,
          authBackend: new UserModelAuthBackend(UserModel, { passwords }),
          secretKey: SECRET,
          cookieSecure: false,
          logDir,
          sqlConsole: {
            dialect: "sqlite",
            policy: {
              capabilities: [SqlCapability.READ],
              denyTables: ["user"],
              maxRows: 1,
            },
            onAudit: (entry) => {
              audits.push(entry);
            },
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

describe("logs page", () => {
  it("appears in the sidebar and lists the records newest first", async () => {
    const html = await (await call("/admin/logs")).text();
    expect(html).toContain("System");
    expect(html).toContain("3 records.");
    expect(html.indexOf("Connection reset")).toBeLessThan(
      html.indexOf("Unhandled exception"),
    );
  });

  it("makes a traceback expandable and shows the correlation fields", async () => {
    const html = await (await call("/admin/logs")).text();
    expect(html).toContain("<details><summary>Unhandled exception</summary>");
    expect(html).toContain("req-1");
    expect(html).toContain("at handler (app.ts:1:1)");
    expect(html).toContain("tempest-log-badge--error");
  });

  it("filters by source and by search term", async () => {
    const errors = await (await call("/admin/logs?source=error")).text();
    expect(errors).toContain("2 records.");
    expect(errors).not.toContain("Server listening");

    const searched = await (await call("/admin/logs?q=reset")).text();
    expect(searched).toContain("1 record.");
    expect(searched).toContain("Connection reset");
  });

  it("searches inside the stack, not only the message", async () => {
    const html = await (await call("/admin/logs?q=app.ts")).text();
    expect(html).toContain("1 record.");
    expect(html).toContain("Unhandled exception");
  });

  it("exports markdown honouring the filters", async () => {
    const res = await call("/admin/logs/export?source=error&q=boom&format=md");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="logs.md"');
    const body = await res.text();
    expect(body).toContain("**Source:** `error`");
    expect(body).toContain("**Search:** `boom`");
    expect(body).toContain("```text");
    expect(body).toContain("at handler (app.ts:1:1)");
    expect(body).not.toContain("Connection reset");
  });

  it("exports JSON verbatim", async () => {
    const res = await call("/admin/logs/export?source=info&format=json");
    const rows = (await res.json()) as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.logger).toBe("app.api");
  });

  it("stays off when no log directory is configured", async () => {
    const site = new AdminSite({ title: "No logs" });
    site.register(new AdminModel({ model: WidgetModel }));
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
          }),
        );
      },
    });
    const other = await runServer(app, { port: 0 });
    try {
      const res = await fetch(
        `http://127.0.0.1:${(other.address() as AddressInfo).port}/admin/logs`,
        { redirect: "manual" },
      );
      expect(res.status).toBe(404);
    } finally {
      other.close();
    }
  });
});

describe("log helpers", () => {
  it("lifts known fields and keeps the rest as context", () => {
    const entry = toLogEntry({
      level: "warning",
      logger: "app",
      message: "Slow query",
      timestamp: "t",
      durationMs: 900,
      requestId: null,
    });
    expect(entry.level).toBe("warning");
    expect(entry.stack).toBeNull();
    expect(entry.context).toEqual({ durationMs: 900 });
  });

  it("declares a truncated export as partial", () => {
    const markdown = renderLogEntriesMarkdown(
      [toLogEntry({ level: "error", message: "one" })],
      { source: "error", query: "", total: 12 },
    );
    expect(markdown).toContain("**Exported:** 1 of 12");
    expect(markdown).toContain("Truncated");
  });

  it("filters case-insensitively", () => {
    const entries = [toLogEntry({ message: "Boom" }), toLogEntry({ message: "fine" })];
    expect(filterLogEntries(entries, "boom")).toHaveLength(1);
    expect(filterLogEntries(entries, "")).toHaveLength(2);
  });
});

describe("SQL console", () => {
  it("runs a permitted read and caps the rows", async () => {
    const res = await runSql("SELECT label FROM widget ORDER BY label");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("2 rows");
    expect(html).toContain("truncated by the row cap");
    expect(html).toContain("Alpha");
    expect(html).not.toContain(">Beta<");
  });

  it("refuses a capability the policy does not grant", async () => {
    const res = await runSql("DELETE FROM widget");
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("may not run delete statements");
  });

  it("refuses a denied table", async () => {
    const res = await runSql("SELECT email FROM user");
    const html = await res.text();
    expect(res.status).toBe(400);
    expect(html).toContain("Table &quot;user&quot; is not available here");
  });

  it("audits every attempt, allowed or refused", async () => {
    audits.length = 0;
    await runSql("SELECT label FROM widget");
    await runSql("DROP TABLE widget");
    expect(audits).toHaveLength(2);
    expect(audits[0]?.allowed).toBe(true);
    expect(audits[0]?.principal).toBe("root@example.com");
    expect(audits[0]?.rowCount).toBe(2);
    expect(audits[1]?.allowed).toBe(false);
    expect(audits[1]?.reason).toContain("drop");
  });

  it("reports a database error without a 500", async () => {
    const res = await runSql("SELECT nope FROM widget");
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("nope");
  });

  it("enforces CSRF", async () => {
    const res = await post("/admin/sql", { csrf_token: "forged", sql: "SELECT 1" });
    expect(res.status).toBe(403);
  });

  it("stays off when not configured", async () => {
    const site = new AdminSite({ title: "No SQL" });
    site.register(new AdminModel({ model: WidgetModel }));
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
          }),
        );
      },
    });
    const other = await runServer(app, { port: 0 });
    try {
      const res = await fetch(
        `http://127.0.0.1:${(other.address() as AddressInfo).port}/admin/sql`,
        { redirect: "manual" },
      );
      expect(res.status).toBe(404);
    } finally {
      other.close();
    }
  });
});

describe("SQL analysis and policy", () => {
  it("classifies statement families, CTEs included", async () => {
    const parser = await loadSqlParser();
    const read = analyzeSql("WITH x AS (SELECT 1) SELECT * FROM x", "postgresql", parser);
    expect(read.capabilities).toEqual([SqlCapability.READ]);

    expect(analyzeSql("DROP TABLE users", "postgresql", parser).capabilities).toEqual([
      SqlCapability.DROP,
    ]);
    expect(analyzeSql("TRUNCATE TABLE users", "postgresql", parser).capabilities).toEqual(
      [SqlCapability.DROP],
    );
    expect(
      analyzeSql("CREATE TABLE t (id int)", "postgresql", parser).capabilities,
    ).toEqual([SqlCapability.DDL]);
  });

  it("sends unparseable text to the admin capability, not the least one", async () => {
    const parser = await loadSqlParser();
    const analysis = analyzeSql("VACUUM FULL VERBOSE", "postgresql", parser);
    expect(analysis.parsed).toBe(false);
    expect(analysis.capabilities).toEqual([SqlCapability.ADMIN]);
    expect(checkSqlPolicy(analysis, { capabilities: [SqlCapability.READ] }).allowed).toBe(
      false,
    );
  });

  it("refuses an unscoped write by default", async () => {
    const parser = await loadSqlParser();
    const analysis = analyzeSql("UPDATE users SET active = false", "postgresql", parser);
    expect(analysis.unscopedWrite).toBe(true);
    const strict = checkSqlPolicy(analysis, { capabilities: [SqlCapability.UPDATE] });
    expect(strict.allowed).toBe(false);
    expect(strict.reason).toContain("WHERE");

    const relaxed = checkSqlPolicy(analysis, {
      capabilities: [SqlCapability.UPDATE],
      requireWhereOnWrites: false,
    });
    expect(relaxed.allowed).toBe(true);
  });

  it("enforces the allow list, including for untraceable tables", async () => {
    const parser = await loadSqlParser();
    const scoped = analyzeSql("SELECT * FROM orders", "postgresql", parser);
    expect(
      checkSqlPolicy(scoped, {
        capabilities: [SqlCapability.READ],
        allowTables: ["orders"],
      }).allowed,
    ).toBe(true);
    expect(
      checkSqlPolicy(scoped, {
        capabilities: [SqlCapability.READ],
        allowTables: ["customers"],
      }).allowed,
    ).toBe(false);

    const tableless = analyzeSql("SELECT 1", "postgresql", parser);
    expect(
      checkSqlPolicy(tableless, {
        capabilities: [SqlCapability.READ],
        allowTables: ["orders"],
      }).allowed,
    ).toBe(false);
  });
});
