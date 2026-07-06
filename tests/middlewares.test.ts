import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  GracefulShutdown,
  HttpMetrics,
  MemoryIdempotencyStore,
  MemoryRateLimitStore,
  bodySizeLimitMiddleware,
  csrfMiddleware,
  generateCsrfToken,
  idempotencyMiddleware,
  keyByHeader,
  rateLimitMiddleware,
} from "@/index";
import express, { type Express } from "express";
import { afterEach, describe, expect, it } from "vitest";

let server: Server | undefined;

async function boot(app: Express): Promise<string> {
  return new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const { port } = server?.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

afterEach(() => {
  server?.close();
  server = undefined;
});

describe("rateLimitMiddleware", () => {
  it("allows up to the limit then 429s with Retry-After", async () => {
    const app = express();
    app.use(rateLimitMiddleware({ maxRequests: 2, windowSeconds: 60 }));
    app.get("/", (_req, res) => res.json({ ok: true }));
    const base = await boot(app);

    expect((await fetch(`${base}/`)).status).toBe(200);
    expect((await fetch(`${base}/`)).status).toBe(200);
    const third = await fetch(`${base}/`);
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).toBeTruthy();
    expect(third.headers.get("x-ratelimit-limit")).toBe("2");
    const body = (await third.json()) as { code: string };
    expect(body.code).toBe("TOO_MANY_REQUESTS");
  });

  it("keys independently per header value", async () => {
    const app = express();
    app.use(
      rateLimitMiddleware({
        maxRequests: 1,
        windowSeconds: 60,
        keyFunc: keyByHeader("x-api-key", { fallbackToIp: false }),
      }),
    );
    app.get("/", (_req, res) => res.json({ ok: true }));
    const base = await boot(app);

    expect((await fetch(`${base}/`, { headers: { "x-api-key": "a" } })).status).toBe(200);
    expect((await fetch(`${base}/`, { headers: { "x-api-key": "b" } })).status).toBe(200);
    expect((await fetch(`${base}/`, { headers: { "x-api-key": "a" } })).status).toBe(429);
  });

  it("validates its options", () => {
    expect(() => rateLimitMiddleware({ maxRequests: 0 })).toThrow(RangeError);
    expect(() => rateLimitMiddleware({ windowSeconds: 0 })).toThrow(RangeError);
  });
});

describe("MemoryRateLimitStore", () => {
  it("reports remaining and resets after the window", async () => {
    const store = new MemoryRateLimitStore();
    const a = await store.hit("k", 2, 60);
    expect(a).toEqual({ allowed: true, remaining: 1, retryAfter: 0 });
    await store.hit("k", 2, 60);
    const blocked = await store.hit("k", 2, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThanOrEqual(1);
  });
});

describe("bodySizeLimitMiddleware", () => {
  it("rejects an oversize Content-Length with 413", async () => {
    const app = express();
    app.use(bodySizeLimitMiddleware({ maxBytes: 10 }));
    app.use(express.json());
    app.post("/", (_req, res) => res.json({ ok: true }));
    const base = await boot(app);

    const res = await fetch(`${base}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "way-too-long-payload" }),
    });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { code: string }).code).toBe("REQUEST_BODY_TOO_LARGE");
  });

  it("lets a small body through and parses it", async () => {
    const app = express();
    app.use(bodySizeLimitMiddleware({ maxBytes: 1024 }));
    app.use(express.json());
    app.post("/", (req, res) => res.json(req.body));
    const base = await boot(app);

    const res = await fetch(`${base}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ n: 1 }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ n: 1 });
  });
});

describe("csrfMiddleware", () => {
  it("passes safe methods, rejects unsafe without matching token", async () => {
    const app = express();
    app.use(csrfMiddleware());
    app.get("/", (_req, res) => res.json({ ok: true }));
    app.post("/", (_req, res) => res.json({ ok: true }));
    const base = await boot(app);

    expect((await fetch(`${base}/`)).status).toBe(200);
    expect((await fetch(`${base}/`, { method: "POST" })).status).toBe(403);

    const token = generateCsrfToken();
    const ok = await fetch(`${base}/`, {
      method: "POST",
      headers: { cookie: `csrf_token=${token}`, "x-csrf-token": token },
    });
    expect(ok.status).toBe(200);

    const mismatch = await fetch(`${base}/`, {
      method: "POST",
      headers: { cookie: "csrf_token=aaa", "x-csrf-token": "bbb" },
    });
    expect(mismatch.status).toBe(403);
  });

  it("honors excluded prefixes", async () => {
    const app = express();
    app.use(csrfMiddleware({ excludePaths: ["/api/"] }));
    app.post("/api/x", (_req, res) => res.json({ ok: true }));
    const base = await boot(app);
    expect((await fetch(`${base}/api/x`, { method: "POST" })).status).toBe(200);
  });
});

describe("idempotencyMiddleware", () => {
  it("replays a cached response for the same key", async () => {
    const app = express();
    let calls = 0;
    app.use(idempotencyMiddleware({ store: new MemoryIdempotencyStore() }));
    app.post("/", (_req, res) => {
      calls += 1;
      res.json({ calls });
    });
    const base = await boot(app);

    const headers = { "idempotency-key": "abc" };
    const first = await fetch(`${base}/`, { method: "POST", headers });
    const second = await fetch(`${base}/`, { method: "POST", headers });
    expect(await first.json()).toEqual({ calls: 1 });
    expect(await second.json()).toEqual({ calls: 1 });
    expect(second.headers.get("idempotent-replayed")).toBe("true");
    expect(calls).toBe(1);
  });

  it("does not cache GETs or keyless requests", async () => {
    const app = express();
    let calls = 0;
    app.use(idempotencyMiddleware({ store: new MemoryIdempotencyStore() }));
    app.post("/", (_req, res) => {
      calls += 1;
      res.json({ calls });
    });
    const base = await boot(app);
    await fetch(`${base}/`, { method: "POST" });
    await fetch(`${base}/`, { method: "POST" });
    expect(calls).toBe(2);
  });
});

describe("GracefulShutdown", () => {
  it("503s new requests once draining and drains cleanly", async () => {
    const shutdown = new GracefulShutdown({ retryAfterSeconds: 3 });
    const app = express();
    app.use(shutdown.middleware());
    app.get("/", (_req, res) => res.json({ ok: true }));
    const base = await boot(app);

    expect((await fetch(`${base}/`)).status).toBe(200);
    shutdown.beginDrain();
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("3");
    expect(await shutdown.waitDrained()).toBe(true);
  });
});

describe("HttpMetrics", () => {
  it("renders counter and histogram in Prometheus text", () => {
    const metrics = new HttpMetrics();
    metrics.observe("GET", "/items", 200, 0.02);
    metrics.observe("GET", "/items", 200, 0.3);
    const text = metrics.render();
    expect(text).toContain('http_requests_total{method="GET",status="200"} 2');
    expect(text).toContain("http_request_duration_seconds_bucket");
    expect(text).toContain(
      'http_request_duration_seconds_count{method="GET",route="/items"} 2',
    );
  });
});
