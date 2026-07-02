import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  type AdminResource,
  AdminSite,
  createApp,
  makeAdminRouter,
  runServer,
  z,
} from "@/index";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

interface Widget {
  id: string;
  name: string;
}

/** An in-memory resource backing the admin. */
function widgetResource(): AdminResource<Widget> {
  const store = new Map<string, Widget>([["1", { id: "1", name: "Alpha" }]]);
  let seq = 1;
  return {
    name: "widgets",
    fields: [
      { name: "id", type: "string", readOnly: true },
      { name: "name", type: "string", required: true },
    ],
    createSchema: z.object({ name: z.string().min(1) }),
    updateSchema: z.object({ name: z.string().min(1) }),
    async list({ page, pageSize }) {
      const items = [...store.values()];
      return { items, total: items.length, page, pageSize, pages: 1 };
    },
    async get(id) {
      return store.get(id) ?? null;
    },
    async create(data) {
      seq += 1;
      const widget: Widget = { id: String(seq), name: (data as { name: string }).name };
      store.set(widget.id, widget);
      return widget;
    },
    async update(id, data) {
      const widget = { id, name: (data as { name: string }).name };
      store.set(id, widget);
      return widget;
    },
    async remove(id) {
      store.delete(id);
    },
  };
}

let server: Server;
let base: string;
let authed = false;

beforeAll(async () => {
  const site = new AdminSite("Test Admin");
  site.register(widgetResource());
  const app = await createApp({
    health: false,
    configure: (a) => {
      a.use(
        makeAdminRouter(site, {
          guard: (_req, _res, next) => next(authed ? undefined : new Error("locked")),
        }),
      );
    },
  });
  server = await runServer(app, { port: 0 });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => server.close());

const json = (path: string, init?: RequestInit) => fetch(`${base}${path}`, init);

describe("admin router", () => {
  it("applies the guard", async () => {
    authed = false;
    expect((await json("/admin")).status).toBe(500); // guard rejects → unhandled → 500
    authed = true;
  });

  it("lists resources and metadata", async () => {
    const root = (await (await json("/admin")).json()) as {
      brand: string;
      resources: Array<{ name: string }>;
    };
    expect(root.brand).toBe("Test Admin");
    expect(root.resources[0]?.name).toBe("widgets");

    const meta = (await (await json("/admin/widgets/_meta")).json()) as {
      operations: { create: boolean };
    };
    expect(meta.operations.create).toBe(true);
  });

  it("does full CRUD", async () => {
    const list = (await (await json("/admin/widgets")).json()) as { total: number };
    expect(list.total).toBe(1);

    const created = (await (
      await json("/admin/widgets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Beta" }),
      })
    ).json()) as Widget;
    expect(created.name).toBe("Beta");

    const detail = await json(`/admin/widgets/${created.id}`);
    expect(detail.status).toBe(200);

    const patched = (await (
      await json(`/admin/widgets/${created.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Gamma" }),
      })
    ).json()) as Widget;
    expect(patched.name).toBe("Gamma");

    expect(
      (await json(`/admin/widgets/${created.id}`, { method: "DELETE" })).status,
    ).toBe(204);
    expect((await json("/admin/widgets/missing")).status).toBe(404);
  });

  it("validates create input (422)", async () => {
    const res = await json("/admin/widgets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });
    expect(res.status).toBe(422);
  });
});
