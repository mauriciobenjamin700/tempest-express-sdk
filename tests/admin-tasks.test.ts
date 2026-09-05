import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  AdminModel,
  AdminSite,
  BaseJobModel,
  BaseModel,
  BaseRepository,
  BaseUserModel,
  JobStatus,
  JobStore,
  PasswordUtils,
  TaskManager,
  type TestDatabase,
  UserModelAuthBackend,
  column,
  createApp,
  createTestDatabase,
  makeAdminRouter,
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
}

class JobModel extends BaseJobModel {
  static override tablename = "job";
}

const SECRET = "a-test-secret-that-is-long-enough-32";

let db: TestDatabase;
let server: Server;
let base: string;
let cookie = "";
let manager: TaskManager;

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

function store(): JobStore {
  return new JobStore(JobModel, db.session());
}

beforeAll(async () => {
  db = createTestDatabase([UserModel, WidgetModel, JobModel]);
  const passwords = new PasswordUtils(4);
  await new BaseRepository(UserModel, db.session()).create({
    email: "root@example.com",
    hashedPassword: await passwords.hash("hunter2hunter2"),
    isAdmin: true,
    name: "Root",
    lastLoginAt: null,
  });

  manager = new TaskManager();
  manager.register("nightly-export", async () => undefined, {
    description: "Ships yesterday's orders to the warehouse",
    schedule: "0 3 * * *",
  });
  manager.register("send-welcome", async () => undefined);

  const site = new AdminSite({ title: "Tasks Admin" });
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
          tasks: {
            manager,
            jobs: (session) => new JobStore(JobModel, session),
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

describe("task inventory", () => {
  it("reports registered tasks with their metadata, ordered by name", () => {
    expect(manager.inventory()).toEqual([
      {
        name: "nightly-export",
        description: "Ships yesterday's orders to the warehouse",
        schedule: "0 3 * * *",
      },
      { name: "send-welcome", description: null, schedule: null },
    ]);
  });

  it("reports an empty inventory for a manager with no handlers", () => {
    expect(new TaskManager().inventory()).toEqual([]);
  });
});

describe("job store", () => {
  it("walks a job through its lifecycle", async () => {
    const jobs = store();
    const job = await jobs.enqueue("nightly-export", { day: "2026-09-04" });
    const id = String(job.id);
    expect(job.status).toBe(JobStatus.QUEUED);

    await jobs.start(id, 1);
    expect((await jobs.get(id))?.status).toBe(JobStatus.RUNNING);
    expect((await jobs.get(id))?.startedAt).toBeInstanceOf(Date);

    await jobs.succeed(id, { rows: 42 });
    const done = await jobs.get(id);
    expect(done?.status).toBe(JobStatus.SUCCEEDED);
    expect(done?.result).toEqual({ rows: 42 });
    expect(done?.finishedAt).toBeInstanceOf(Date);
  });

  it("records a failure message", async () => {
    const jobs = store();
    const job = await jobs.enqueue("send-welcome");
    await jobs.start(String(job.id));
    await jobs.fail(String(job.id), new Error("smtp refused the connection"));
    const failed = await jobs.get(String(job.id));
    expect(failed?.status).toBe(JobStatus.FAILED);
    expect(failed?.error).toBe("smtp refused the connection");
  });

  it("refuses to cancel a run that already finished", async () => {
    const jobs = store();
    const running = await jobs.enqueue("nightly-export");
    await jobs.start(String(running.id));
    expect(await jobs.cancel(String(running.id))).toBe(true);
    expect((await jobs.get(String(running.id)))?.status).toBe(JobStatus.CANCELLED);
    expect(await jobs.cancel(String(running.id))).toBe(false);
  });

  it("lists newest first and filters by name and status", async () => {
    const jobs = store();
    const all = await jobs.list();
    expect(all.total).toBeGreaterThanOrEqual(3);

    const byName = await jobs.list({ name: "send-welcome" });
    expect(byName.items.every((row) => row.name === "send-welcome")).toBe(true);

    const failed = await jobs.list({ status: JobStatus.FAILED });
    expect(failed.items.every((row) => row.status === JobStatus.FAILED)).toBe(true);
  });
});

describe("tasks page", () => {
  it("shows the declared tasks and the recorded runs", async () => {
    const html = await (await call("/admin/tasks")).text();
    expect(html).toContain("Tasks");
    expect(html).toContain("nightly-export");
    expect(html).toContain("0 3 * * *");
    expect(html).toContain("Ships yesterday&#39;s orders");
    expect(html).toContain("Runs");
    expect(html).toContain("tempest-log-badge--succeeded");
  });

  it("says plainly that queue depth is not shown", async () => {
    const html = await (await call("/admin/tasks")).text();
    expect(html).toContain("Live queue depth is not shown");
  });

  it("filters runs by status and by task name", async () => {
    const failed = await (await call("/admin/tasks?status=failed")).text();
    expect(failed).toContain("tempest-log-badge--failed");
    expect(failed).not.toContain("tempest-log-badge--succeeded");

    const named = await (await call("/admin/tasks?task=send-welcome")).text();
    const runsSection = named.slice(named.indexOf("<h2>Runs</h2>"));
    expect(runsSection).toContain("send-welcome");
    expect(runsSection).not.toContain("nightly-export");
  });

  it("opens one run with its payload, result and cancel state", async () => {
    const jobs = store();
    const job = await jobs.enqueue("nightly-export", { day: "2026-09-05" });
    await jobs.start(String(job.id));

    const running = await (await call(`/admin/tasks/${String(job.id)}`)).text();
    expect(running).toContain("nightly-export");
    expect(running).toContain("&quot;day&quot;: &quot;2026-09-05&quot;");
    expect(running).toContain("Cancel");

    await jobs.succeed(String(job.id), { rows: 7 });
    const finished = await (await call(`/admin/tasks/${String(job.id)}`)).text();
    expect(finished).toContain("&quot;rows&quot;: 7");
    expect(finished).not.toContain(">Cancel<");
  });

  it("cancels a running job from the page", async () => {
    const jobs = store();
    const job = await jobs.enqueue("send-welcome");
    await jobs.start(String(job.id));

    const page = await (await call(`/admin/tasks/${String(job.id)}`)).text();
    const res = await post(`/admin/tasks/${String(job.id)}/cancel`, {
      csrf_token: csrfFrom(page),
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("flash=The+run+was+asked+to+stop.");
    expect((await jobs.get(String(job.id)))?.status).toBe(JobStatus.CANCELLED);
  });

  it("warns instead of lying when the run already finished", async () => {
    const jobs = store();
    const job = await jobs.enqueue("send-welcome");
    await jobs.succeed(String(job.id));

    const page = await (await call("/admin/tasks")).text();
    const res = await post(`/admin/tasks/${String(job.id)}/cancel`, {
      csrf_token: csrfFrom(page),
    });
    expect(res.headers.get("location")).toContain("level=warning");
    expect((await jobs.get(String(job.id)))?.status).toBe(JobStatus.SUCCEEDED);
  });

  it("404s an unknown run and enforces CSRF on cancel", async () => {
    expect((await call("/admin/tasks/00000000000000000000000000000000")).status).toBe(
      404,
    );
    const forged = await post("/admin/tasks/whatever/cancel", { csrf_token: "no" });
    expect(forged.status).toBe(403);
  });

  it("stays off when not configured", async () => {
    const site = new AdminSite({ title: "No tasks" });
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
        `http://127.0.0.1:${(other.address() as AddressInfo).port}/admin/tasks`,
        { redirect: "manual" },
      );
      expect(res.status).toBe(404);
    } finally {
      other.close();
    }
  });

  it("renders the declared half alone when no job store is given", async () => {
    const site = new AdminSite({ title: "Declared only" });
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
            tasks: { manager },
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
      const html = await (
        await fetch(`${otherBase}/admin/tasks`, { headers: { cookie: otherCookie } })
      ).text();
      expect(html).toContain("Declared");
      expect(html).toContain("nightly-export");
      expect(html).not.toContain("<h2>Runs</h2>");
    } finally {
      other.close();
    }
  });
});
