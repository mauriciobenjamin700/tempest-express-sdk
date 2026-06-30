import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  NotFoundException,
  createApp,
  createOpenApiRegistry,
  runServer,
  z,
} from "@/index";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let server: Server;
let base: string;

beforeAll(async () => {
  const registry = createOpenApiRegistry();
  const Item = registry.register(
    "Item",
    z.object({ id: z.string().uuid(), name: z.string() }),
  );
  registry.registerPath({
    method: "get",
    path: "/api/items/{id}",
    summary: "Fetch an item",
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
      200: { description: "ok", content: { "application/json": { schema: Item } } },
    },
  });

  const app = await createApp({
    corsOrigins: "*",
    openapi: { registry, info: { title: "Test API", version: "1.2.3" } },
    configure: (a) => {
      a.get("/api/boom", () => {
        throw new NotFoundException({ message: "nope", details: { hint: "x" } });
      });
    },
  });
  server = await runServer(app, { port: 0 });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

describe("createApp", () => {
  it("serves a healthy /health", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", checks: {} });
  });

  it("serves the OpenAPI document with registered paths", async () => {
    const res = await fetch(`${base}/openapi.json`);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as {
      info: Record<string, unknown>;
      paths: Record<string, unknown>;
      components: { schemas: Record<string, unknown> };
    };
    expect(doc.info).toMatchObject({ title: "Test API", version: "1.2.3" });
    expect(doc.paths["/api/items/{id}"]).toBeDefined();
    expect(doc.components.schemas.Item).toBeDefined();
  });

  it("serves Swagger UI and Redoc HTML", async () => {
    const swagger = await fetch(`${base}/docs`);
    expect(swagger.headers.get("content-type")).toContain("text/html");
    expect(await swagger.text()).toContain("swagger-ui");

    const redoc = await fetch(`${base}/redoc`);
    expect(await redoc.text()).toContain("redoc");
  });

  it("renders AppException as the canonical envelope", async () => {
    const res = await fetch(`${base}/api/boom`);
    expect(res.status).toBe(404);
    expect(res.headers.get("x-request-id")).toBeTruthy();
    expect(await res.json()).toEqual({
      detail: "nope",
      code: "NOT_FOUND",
      details: { hint: "x" },
    });
  });

  it("renders unmatched routes as a 404 envelope", async () => {
    const res = await fetch(`${base}/api/missing`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("NOT_FOUND");
  });
});
