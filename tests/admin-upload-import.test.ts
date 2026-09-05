import { mkdtemp, readFile } from "node:fs/promises";
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
  LocalUploadStorage,
  PasswordUtils,
  type TestDatabase,
  UserModelAuthBackend,
  column,
  createApp,
  createTestDatabase,
  makeAdminRouter,
  parseCsv,
  runServer,
} from "@/index";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

class UserModel extends BaseUserModel {
  static override tablename = "user";
  name = column.varchar(120).notNull();
}

class DocumentModel extends BaseModel {
  static override tablename = "document";
  title = column.varchar(120).notNull();
  attachment = column.varchar(255).notNull();
  thumbnail = column.varchar(255);
  ownerId = column.uuid().references("user.id");
}

const SECRET = "a-test-secret-that-is-long-enough-32";

let db: TestDatabase;
let server: Server;
let base: string;
let cookie = "";
let mediaRoot = "";
let ownerId = "";

function call(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cookie !== "") headers.set("cookie", cookie);
  return fetch(`${base}${path}`, { ...init, headers, redirect: "manual" });
}

function csrfFrom(html: string): string {
  return /name="csrf_token" value="([^"]+)"/.exec(html)?.[1] ?? "";
}

/** Post a multipart form built from text fields plus files. */
function postMultipart(
  path: string,
  fields: Record<string, string>,
  files: { field: string; filename: string; type: string; body: string }[] = [],
): Promise<Response> {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  for (const file of files) {
    form.append(file.field, new Blob([file.body], { type: file.type }), file.filename);
  }
  return call(path, { method: "POST", body: form });
}

async function documentBy(title: string): Promise<Record<string, unknown> | null> {
  const repo = new BaseRepository(DocumentModel, db.session());
  return (await repo.first({ title } as never)) as Record<string, unknown> | null;
}

beforeAll(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), "admin-uploads-"));
  db = createTestDatabase([UserModel, DocumentModel]);
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

  const site = new AdminSite({ title: "Uploads Admin" });
  site.register(
    new AdminModel({
      model: DocumentModel,
      listDisplay: ["title", "attachment"],
      searchFields: ["title"],
      ordering: "title",
      uploadFields: ["attachment", "thumbnail"],
      uploadStorage: new LocalUploadStorage({ root: mediaRoot, baseUrl: "/media" }),
      canImport: true,
      autocompleteFields: ["ownerId"],
    }),
  );
  site.register(new AdminModel({ model: UserModel, searchFields: ["name", "email"] }));

  const app = await createApp({
    health: false,
    configure: (a) => {
      a.use(
        makeAdminRouter(site, {
          engine: db.engine,
          authBackend: new UserModelAuthBackend(UserModel, { passwords }),
          secretKey: SECRET,
          cookieSecure: false,
          maxUploadBytes: 1024,
        }),
      );
    },
  });
  server = await runServer(app, { port: 0 });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const login = await call("/admin/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      identifier: "root@example.com",
      password: "hunter2hunter2",
    }).toString(),
  });
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
});

afterAll(async () => {
  server.close();
  await db.close();
});

describe("upload fields", () => {
  it("renders a file input and a multipart form", async () => {
    const html = await (await call("/admin/m/document/new")).text();
    expect(html).toContain('enctype="multipart/form-data"');
    expect(html).toContain('<input type="file" name="attachment"');
    expect(html).toContain('<input type="file" name="thumbnail"');
  });

  it("stores the file and writes its key to the column", async () => {
    const form = await (await call("/admin/m/document/new")).text();
    const res = await postMultipart(
      "/admin/m/document/new",
      { csrf_token: csrfFrom(form), title: "Contract", isActive: "true", ownerId: "" },
      [
        {
          field: "attachment",
          filename: "contract.pdf",
          type: "application/pdf",
          body: "%PDF-1.4 fake",
        },
      ],
    );
    expect(res.status).toBe(302);

    const row = await documentBy("Contract");
    const key = String(row?.attachment);
    expect(key).toMatch(/^document\/attachment\/[0-9a-f-]{36}\.pdf$/);
    expect(await readFile(join(mediaRoot, key), "utf8")).toBe("%PDF-1.4 fake");
    expect(row?.thumbnail).toBeNull();
  });

  it("requires a file for a NOT NULL upload column on create", async () => {
    const form = await (await call("/admin/m/document/new")).text();
    const res = await postMultipart("/admin/m/document/new", {
      csrf_token: csrfFrom(form),
      title: "No file",
      isActive: "true",
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("This field is required.");
    expect(await documentBy("No file")).toBeNull();
  });

  it("keeps the current file when an edit uploads nothing", async () => {
    const row = await documentBy("Contract");
    const key = String(row?.attachment);
    const form = await (await call(`/admin/m/document/${row?.id}/edit`)).text();
    expect(form).toContain(`Current: ${key}`);

    const res = await postMultipart(`/admin/m/document/${row?.id}/edit`, {
      csrf_token: csrfFrom(form),
      title: "Contract renamed",
      isActive: "true",
      ownerId: "",
    });
    expect(res.status).toBe(302);

    const updated = await documentBy("Contract renamed");
    expect(updated?.attachment).toBe(key);
  });

  it("replaces the file when an edit uploads a new one", async () => {
    const row = await documentBy("Contract renamed");
    const previous = String(row?.attachment);
    const form = await (await call(`/admin/m/document/${row?.id}/edit`)).text();

    const res = await postMultipart(
      `/admin/m/document/${row?.id}/edit`,
      {
        csrf_token: csrfFrom(form),
        title: "Contract renamed",
        isActive: "true",
        ownerId: "",
      },
      [
        {
          field: "attachment",
          filename: "v2.pdf",
          type: "application/pdf",
          body: "second",
        },
      ],
    );
    expect(res.status).toBe(302);

    const updated = await documentBy("Contract renamed");
    expect(updated?.attachment).not.toBe(previous);
    expect(await readFile(join(mediaRoot, String(updated?.attachment)), "utf8")).toBe(
      "second",
    );
  });

  it("rejects a file over the configured limit", async () => {
    const form = await (await call("/admin/m/document/new")).text();
    const res = await postMultipart(
      "/admin/m/document/new",
      { csrf_token: csrfFrom(form), title: "Too big", isActive: "true", ownerId: "" },
      [
        {
          field: "attachment",
          filename: "big.bin",
          type: "application/octet-stream",
          body: "x".repeat(2048),
        },
      ],
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("larger than");
    expect(await documentBy("Too big")).toBeNull();
  });

  it("still enforces CSRF on a multipart submission", async () => {
    const res = await postMultipart(
      "/admin/m/document/new",
      { csrf_token: "forged", title: "Forged", isActive: "true" },
      [{ field: "attachment", filename: "a.txt", type: "text/plain", body: "x" }],
    );
    expect(res.status).toBe(403);
  });

  it("refuses upload fields without a storage backend", () => {
    expect(
      () => new AdminModel({ model: DocumentModel, uploadFields: ["attachment"] }),
    ).toThrow(/requires an uploadStorage/);
  });
});

describe("CSV import", () => {
  it("parses quoted fields, embedded newlines and a BOM", () => {
    const rows = parseCsv(
      '﻿title,notes\r\n"Hello, world","He said ""hi""\nsecond line"\r\nPlain,\r\n',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      title: "Hello, world",
      notes: 'He said "hi"\nsecond line',
    });
    expect(rows[1]).toEqual({ title: "Plain", notes: "" });
  });

  it("throws on a document with no header", () => {
    expect(() => parseCsv("")).toThrow(/no header row/);
  });

  it("links the import page from the list view", async () => {
    const html = await (await call("/admin/m/document")).text();
    expect(html).toContain("Import CSV");
    expect(html).toContain("/admin/m/document/import");
  });

  it("imports rows and reports per-row failures with spreadsheet numbering", async () => {
    const page = await (await call("/admin/m/document/import")).text();
    expect(page).toContain("Recognised columns");

    const csv = [
      "title,attachment,isActive",
      "Imported one,keys/one.pdf,true",
      ",keys/two.pdf,true",
      "Imported three,keys/three.pdf,true",
    ].join("\n");

    const res = await postMultipart(
      "/admin/m/document/import",
      { csrf_token: csrfFrom(page) },
      [{ field: "file", filename: "rows.csv", type: "text/csv", body: csv }],
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Created 2 records.");
    expect(html).toContain("<td>3</td>");
    expect(html).toContain("title: This field is required.");

    expect(await documentBy("Imported one")).not.toBeNull();
    expect(await documentBy("Imported three")).not.toBeNull();
  });

  it("rejects a submission with no file", async () => {
    const page = await (await call("/admin/m/document/import")).text();
    const res = await postMultipart("/admin/m/document/import", {
      csrf_token: csrfFrom(page),
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Choose a CSV file");
  });

  it("404s when import is not enabled", async () => {
    expect((await call("/admin/m/user/import")).status).toBe(404);
  });
});

describe("foreign-key autocomplete", () => {
  it("renders a search box instead of a select", async () => {
    const html = await (await call("/admin/m/document/new")).text();
    expect(html).toContain('data-ac-url="/admin/m/document/autocomplete/ownerId"');
    expect(html).toContain("data-ac-search");
    expect(html).not.toContain('<select name="ownerId"');
  });

  it("searches the referenced admin's search fields", async () => {
    const all = (await (await call("/admin/m/document/autocomplete/ownerId")).json()) as {
      options: { value: string; label: string }[];
    };
    expect(all.options).toHaveLength(1);
    expect(all.options[0]).toEqual({ value: ownerId, label: "Root" });

    const hit = (await (
      await call("/admin/m/document/autocomplete/ownerId?q=roo")
    ).json()) as { options: unknown[] };
    expect(hit.options).toHaveLength(1);

    const miss = (await (
      await call("/admin/m/document/autocomplete/ownerId?q=zzz")
    ).json()) as { options: unknown[] };
    expect(miss.options).toEqual([]);
  });

  it("404s a column that is not an autocomplete field", async () => {
    expect((await call("/admin/m/document/autocomplete/title")).status).toBe(404);
  });

  it("401s an anonymous search", async () => {
    const res = await fetch(`${base}/admin/m/document/autocomplete/ownerId`, {
      redirect: "manual",
    });
    expect(res.status).toBe(401);
  });

  it("shows the current label when editing a row that has one", async () => {
    const form = await (await call("/admin/m/document/new")).text();
    await postMultipart(
      "/admin/m/document/new",
      {
        csrf_token: csrfFrom(form),
        title: "Owned",
        isActive: "true",
        ownerId,
      },
      [{ field: "attachment", filename: "o.pdf", type: "application/pdf", body: "x" }],
    );
    const row = await documentBy("Owned");
    expect(row?.ownerId).toBe(ownerId);

    const edit = await (await call(`/admin/m/document/${row?.id}/edit`)).text();
    expect(edit).toContain('class="tempest-admin-ac__search" value="Root"');
  });
});
