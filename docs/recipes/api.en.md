# API: `createApp`, OpenAPI, Swagger and Redoc

`createApp` is the factory that assembles an **already wired** Express app: JSON
parsing, request-id, optional CORS, `/health`, your routers, the documentation
(Swagger + Redoc from Zod schemas) and, last, the error-handling stack. It's the
port of `api.app` + `api.server` from `tempest-fastapi-sdk`.

You almost never configure these pieces by hand — you pass options to `createApp`
and boot with `runServer`.

---

## 1. The minimum that boots

```ts
import { createApp, runServer } from "tempest-express-sdk";

const app = await createApp();
await runServer(app, { host: "127.0.0.1", port: 8000 });
```

That already gives you:

- Parsed JSON body (`100kb` limit) + `urlencoded`.
- `X-Request-ID` on every response (generated if the client doesn't send one).
- `GET /health` answering `{ "status": "ok", "checks": {} }`.
- The canonical error envelope for any `AppException` or unmatched route.

!!! note "`createApp` is async"
    It's `async` because the `configure` hook may be async (open a connection,
    load keys…). Always `await` it.

---

## 2. Registering your routers: the `configure` hook

Routers and OpenAPI paths go through the `configure` hook, which runs **after**
the middlewares and **before** the error stack — the right order for Express.

```ts hl_lines="5 6 7 8"
import { createApp, runServer } from "tempest-express-sdk";
import { usersRouter } from "@/api/routers/users";

const app = await createApp({
  configure: (app) => {
    app.use(usersRouter);
    // any app.use / app.get goes here
  },
});

await runServer(app, { port: 8000 });
```

!!! warning "Don't register the error handler by hand"
    Don't call `registerExceptionHandlers` inside `configure` — `createApp`
    already registers it **last**, which is where Express requires it. Adding it
    earlier makes the handler miss routes registered afterwards.

---

## 3. `createApp` options

All optional. The most used:

| Option | Type | Default | For |
| --- | --- | --- | --- |
| `corsOrigins` | `string \| string[] \| false` | `false` (no CORS) | Allow origins. `"*"` or a list. |
| `health` | `HealthRouterOptions \| false` | mounts `/health` | Health check; `false` removes it. |
| `configure` | `(app) => void \| Promise` | — | Mount routers and OpenAPI paths. |
| `openapi` | `CreateAppOpenApi` | — | Wire Swagger/Redoc (section 4). |
| `catalog` | `MessageCatalog` | — | Localized error messages. |
| `errorHandling` | options | — | Forwarded to the exception handler. |
| `jsonLimit` | `string` | `"100kb"` | Max JSON body size. |

A wired example:

```ts
const app = await createApp({
  corsOrigins: ["https://app.example.com", "http://localhost:5173"],
  jsonLimit: "1mb",
  health: {
    checks: [
      {
        name: "db",
        check: async () => {
          await db.raw("SELECT 1");
          return true;
        },
      },
    ],
  },
  configure: (app) => {
    app.use(usersRouter);
  },
});
```

!!! tip "Bind: `127.0.0.1` vs `0.0.0.0`"
    `runServer`'s default is `127.0.0.1` (local only). Use `host: "0.0.0.0"` only
    when another host needs to reach the service (e.g. a frontend in a separate
    container).

!!! note "`checks` is a list of `{ name, check }`"
    Each probe is `{ name: string, check: () => Promise<boolean> | boolean }`.
    `/health` runs them all, exposes the result under `checks`
    (`{ [name]: boolean }`) and **degrades to 503** with `status: "degraded"` if
    any fails (or throws). With no checks it answers `200` with
    `{ status: "ok", checks: {} }`.

---

## 4. Automatic docs (OpenAPI → Swagger + Redoc)

Here's the trick: since every SDK Zod schema carries `.openapi()`, descriptions
and examples flow straight into the docs. The flow is 3 steps.

### Step 1 — create a registry

```ts
import { createOpenApiRegistry, z } from "tempest-express-sdk";

const registry = createOpenApiRegistry();
```

### Step 2 — register schemas and paths

`registry.register(name, schema)` publishes a schema as a reusable
**component**; `registry.registerPath({...})` describes a route.

```ts
const Item = registry.register(
  "Item",
  z.object({
    id: z.string().uuid().openapi({ description: "The item id." }),
    name: z.string().openapi({ description: "The item name." }),
  }),
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
```

### Step 3 — pass the registry to `createApp`

```ts hl_lines="4 5 6 7 8"
const app = await createApp({
  configure: (app) => {
    app.use(itemsRouter);
  },
  openapi: {
    registry,
    info: { title: "My API", version: "1.0.0", description: "Demo." },
    servers: [{ url: "http://127.0.0.1:8000" }],
  },
});
```

Now the app serves:

| Route | What |
| --- | --- |
| `GET /openapi.json` | The generated OpenAPI 3.0 document. |
| `GET /docs` | Swagger UI (interactive, served **offline**). |
| `GET /redoc` | Redoc (read-oriented reference). |

`openapi` block options (`CreateAppOpenApi`):

| Field | Default | For |
| --- | --- | --- |
| `registry` | — (required) | The populated registry. |
| `info` | — (required) | `{ title, version, description? }`. |
| `servers` | — | List of `{ url, description? }`. |
| `v31` | `false` | Emit OpenAPI 3.1 instead of 3.0. |
| `jsonPath` | `/openapi.json` | JSON route. |
| `swaggerPath` | `/docs` | Swagger mount; `false` disables. |
| `redocPath` | `/redoc` | Redoc mount; `false` disables. |
| `swagger` | — | Swagger page's `{ title? }`. |
| `redoc` | — | Redoc page's `{ title?, scriptUrl? }`. |

!!! info "Swagger is 100% offline; Redoc uses a CDN"
    Swagger UI's assets come from the `swagger-ui-dist` package and are served
    locally at `${swaggerPath}/assets` — no external calls. Redoc loads its
    bundle (~1 MB) from the jsDelivr CDN by default; to self-host it, pass
    `redoc: { scriptUrl: "/vendor/redoc.standalone.js" }`.

!!! check "No trailing slash works too"
    As of v0.20.1 Swagger's assets use an **absolute** path (`/docs/assets/...`),
    so `GET /docs` **and** `GET /docs/` both render the full UI. Before, visiting
    `/docs` without the slash fetched `/assets/...` and the page came up
    unstyled (assets 404). If you pinned an earlier version, upgrade.

---

## 5. Mounting the docs manually (advanced)

If you don't use `createApp` (a legacy Express app, say), wire the pieces by
hand:

```ts
import express from "express";
import {
  createOpenApiRegistry,
  generateOpenApiDocument,
  mountOpenApiJson,
  mountSwaggerUi,
  mountRedoc,
} from "tempest-express-sdk";

const app = express();
const registry = createOpenApiRegistry();
// ... registry.register / registerPath ...

const document = generateOpenApiDocument(registry, {
  info: { title: "My API", version: "1.0.0" },
});

mountOpenApiJson(app, "/openapi.json", document);
mountSwaggerUi(app, "/docs", "/openapi.json", { title: "My API" });
mountRedoc(app, "/redoc", "/openapi.json");
```

`generateOpenApiDocument` returns a plain JSON object — you can save it to a
file, version it or serve it from wherever you like.

---

## Recap

- `createApp(options)` assembles middlewares → routers (`configure`) → docs →
  error, in that order; `runServer(app, { host, port })` boots it.
- Register routers inside `configure`; do **not** register the error handler by
  hand.
- Docs in 3 steps: `createOpenApiRegistry()` → `register`/`registerPath` → pass
  the registry in `openapi`. You get `/openapi.json`, `/docs` and `/redoc`.
- Swagger is offline; Redoc uses a CDN (self-hostable via `scriptUrl`).
- `/docs` and `/docs/` behave identically — absolute asset paths. 🚀
