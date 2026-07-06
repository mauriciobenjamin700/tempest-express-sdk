# HTTP hardening (middlewares)

A handful of production-ready middlewares that close the most common gaps in an
Express service: abuse (rate limit), oversize payloads, CSRF, duplicate retries
(idempotency), graceful shutdown, log correlation and per-request metrics. It's
the faithful port of `api.middlewares` from `tempest-fastapi-sdk`.

They all honor the SDK error envelope (`{ detail, code, details }`) and have no
external dependencies.

!!! tip "Order matters"
    Middlewares run in the order you register them. Recommended order:
    request-id → tracing → body-size → rate-limit → CSRF → idempotency → your
    routes → error handlers (`registerExceptionHandlers`, always last).

---

## 1. Rate limiting (sliding window)

Counts requests per **key** inside a window and rejects the excess with
`429 Too Many Requests` + `Retry-After`. Two axes are pluggable: the **store**
(where counters live) and the **key** (who a request counts against).

```ts
import { createApp, rateLimitMiddleware } from "tempest-express-sdk";

const app = await createApp({
  configure: (app) => {
    app.use(rateLimitMiddleware({ maxRequests: 60, windowSeconds: 60 }));
  },
});
```

By default the key is the client IP and the store is in-memory
(`MemoryRateLimitStore`) — right for **one** worker. `X-RateLimit-Limit` /
`X-RateLimit-Remaining` headers ride along with every response.

### Keys: by IP, header, or authenticated principal

```ts
import {
  JWTUtils,
  keyByHeader,
  keyByJwtSubject,
  rateLimitMiddleware,
} from "tempest-express-sdk";

// by API key (falls back to IP when absent)
app.use(rateLimitMiddleware({ keyFunc: keyByHeader("x-api-key") }));

// by authenticated user (JWT `sub` claim; falls back to IP for anonymous)
const jwt = new JWTUtils(process.env.JWT_SECRET ?? "dev-secret");
app.use(rateLimitMiddleware({ keyFunc: keyByJwtSubject(jwt) }));
```

!!! warning "Behind a proxy, resolve the IP from a trusted header"
    The default IP is the transport peer — which becomes the **proxy** once a
    reverse proxy fronts the app, collapsing everyone into one bucket. Pass
    `trustedIpHeader: "x-real-ip"` (a header YOUR edge sets, never the client's
    spoofable `X-Forwarded-For`).

### Multi-replica: a Redis store

A single Lua script prunes expired members, counts, and adds the new hit
atomically — no race between count and add. On a backend error the request is
allowed when `failOpen` (the default).

```ts
import { RedisRateLimitStore, rateLimitMiddleware } from "tempest-express-sdk";
import { createClient } from "redis";

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

app.use(
  rateLimitMiddleware({
    maxRequests: 100,
    windowSeconds: 60,
    store: new RedisRateLimitStore(redis),
  }),
);
```

---

## 2. Body-size limit

Without an upstream limit a client can stream gigabytes before parsers reject
it. `bodySizeLimitMiddleware` cuts early: it rejects a `Content-Length` over the
cap with `413` and monitors the stream for chunked bodies.

```ts
import { bodySizeLimitMiddleware } from "tempest-express-sdk";

// register BEFORE express.json()
app.use(bodySizeLimitMiddleware({ maxBytes: 1024 * 1024, excludePaths: ["/uploads"] }));
```

!!! note "Register before the parsers"
    Place it before `express.json()` so the body is cut before buffering. The
    `Content-Length` check covers the common case; the stream monitor counts
    bytes without stealing them from the parser (Node fans each chunk out to
    every listener) and destroys the request on overflow.

---

## 3. CSRF (double-submit cookie)

Protects mutating methods (POST/PUT/PATCH/DELETE) by requiring a `csrf_token`
cookie and an `X-CSRF-Token` header with the same value. A cross-origin site
can't read the cookie, so it can't forge the header.

```ts
import { csrfMiddleware, generateCsrfToken } from "tempest-express-sdk";

// Bearer (Authorization) routes are NOT subject to CSRF — exclude /api/
app.use(csrfMiddleware({ excludePaths: ["/api/", "/webhooks/"] }));

// issue the cookie on a GET route (e.g. when serving the HTML shell)
app.get("/csrf", (_req, res) => {
  const token = generateCsrfToken();
  res.cookie?.("csrf_token", token, { sameSite: "lax" });
  res.json({ csrfToken: token });
});
```

Safe methods (GET/HEAD/OPTIONS) always pass. The comparison is `timingSafeEqual`
(timing-attack resistant).

---

## 4. Idempotency

A client retrying a POST with the same `Idempotency-Key` gets the **original
response** back, with no duplicate side effect (a second charge, a second
order). Only mutating verbs are eligible; the key is scoped per
`(method, path, key)`.

```ts
import {
  MemoryIdempotencyStore,
  idempotencyMiddleware,
} from "tempest-express-sdk";

app.use(
  idempotencyMiddleware({
    store: new MemoryIdempotencyStore(), // or RedisIdempotencyStore(client)
    ttlSeconds: 24 * 3600,
  }),
);
```

The replayed response carries `Idempotent-Replayed: true`. Only `2xx` responses
are cached — errors stay retryable. In multi-replica production, use
`RedisIdempotencyStore(client)`.

---

## 5. Graceful shutdown

Tracks in-flight requests and, once draining begins, answers `503` to new
non-exempt requests while it waits for the running ones to finish — so a rolling
deploy never cuts a response mid-flight.

```ts
import { GracefulShutdown, createApp, runServer } from "tempest-express-sdk";

const shutdown = new GracefulShutdown({ drainTimeoutSeconds: 30, retryAfterSeconds: 5 });

const app = await createApp({
  configure: (app) => app.use(shutdown.middleware()),
});
const server = await runServer(app, { port: 8000 });

process.on("SIGTERM", async () => {
  shutdown.beginDrain();          // new requests → 503
  await shutdown.waitDrained();   // wait for in-flight (up to the timeout)
  server.close();
});
```

---

## 6. Log correlation (request-id + tracing)

`createApp` already installs `requestIdMiddleware`: it reads/generates an
`X-Request-ID` (validated against CRLF injection), echoes it on the response and
exposes it via `getRequestId()`. Add `requestTracingMiddleware` for one
structured log line per request (method, path, status, duration, request-id):

```ts
import { requestTracingMiddleware } from "tempest-express-sdk";

app.use(requestTracingMiddleware({ exemptPaths: ["/health"] }));
```

---

## 7. Per-request metrics (Prometheus)

Complements the system `/metrics` (`makeMetricsRouter`) with **per-request**
instrumentation: a counter labelled by method/status and a latency histogram.

```ts
import { prometheusMiddleware } from "tempest-express-sdk";

const { metrics, middleware } = prometheusMiddleware({ exemptPaths: ["/metrics"] });
app.use(middleware);
app.get("/metrics", (_req, res) => res.type("text/plain").send(metrics.render()));
```

`metrics.render()` returns Prometheus text:
`http_requests_total{method,status}` and
`http_request_duration_seconds_{bucket,sum,count}`. Using `req.route?.path` as
the label keeps cardinality bounded (the route pattern, not the id-laden path).

---

## Recap

| Middleware | Protects against | 429/413/403/503 |
| --- | --- | --- |
| `rateLimitMiddleware` | abuse / brute force | `429` |
| `bodySizeLimitMiddleware` | oversize payloads | `413` |
| `csrfMiddleware` | CSRF on cookie auth | `403` |
| `idempotencyMiddleware` | duplicate effects on retry | — (replay) |
| `GracefulShutdown` | requests cut on deploy | `503` |
| `requestTracingMiddleware` | uncorrelated logs | — |
| `prometheusMiddleware` | missing per-route metrics | — |

Memory by default, Redis for multi-replica rate-limit and idempotency. 🚀
