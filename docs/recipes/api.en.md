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
    id: z.uuid().openapi({ description: "The item id." }),
    name: z.string().openapi({ description: "The item name." }),
  }),
);

registry.registerPath({
  method: "get",
  path: "/api/items/{id}",
  summary: "Fetch an item",
  request: { params: z.object({ id: z.uuid() }) },
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
| `swagger` | — | Swagger page's `{ title?, favicon? }`. |
| `redoc` | — | Redoc page's `{ title?, favicon?, bundle?, bundlePath?, scriptUrl? }`. |

### Favicon: both pages already ship one

Without a `<link rel="icon">`, the browser requests `/favicon.ico` **at the
origin root**. On an API-only service that root has no favicon: the request is a
404, or a 401 when it sits behind the auth middleware, or it lands on an SPA
catch-all. The result is a red console error on every visit to `/docs`:

```
[ERROR] Failed to load resource: the server responded with a status of 401
        (Unauthorized) @ http://127.0.0.1:3111/favicon.ico
```

Both pages declare an inline SVG icon (a `data:` URI), so the request never goes
out. To use your own:

```ts
const app = await createApp({
  openapi: {
    registry,
    info: { title: "My API", version: "1.0.0" },
    swagger: { favicon: "/static/icon.svg" },
    redoc: { favicon: "/static/icon.svg" },
  },
});
```

`favicon: false` omits the tag — the browser goes back to requesting
`/favicon.ico`, which is what you want when the root **does** have a real
favicon to serve.

### Offline Redoc: install `redoc` next to the service

Swagger UI is offline by construction — its assets come from `swagger-ui-dist`,
served at `${swaggerPath}/assets`. Redoc's renderer is ~1 MB and is **not**
vendored: the `redoc` package pulls 22 dependencies and peers on `react`,
`react-dom`, `styled-components`, `mobx` and `core-js`, bounds no backend service
should inherit just to render a reference page.

It is an **optional peer dependency** instead. Install it and the page serves the
bundle from the service itself, touching no CDN:

```bash
npm install redoc
```

| `bundle` | What it does |
| --- | --- |
| `"auto"` (default) | Serves `redoc`'s bundle when it is installed; falls back to the CDN when it is not. |
| `"local"` | Serves from disk and **throws at mount time** when `redoc` is not installed. |
| `"cdn"` | Always loads from jsDelivr. |

```ts
redoc: { bundle: "local" }                              // fail loudly, never degrade
redoc: { bundlePath: "/opt/app/redoc.standalone.js" }   // your copy, served by the SDK
redoc: { scriptUrl: "/vendor/redoc.standalone.js" }     // a URL you already serve
```

!!! warning "Closed network: use `\"local\"`, not `\"auto\"`"
    On an air-gapped deploy, or one with a restrictive CSP, `"auto"` silently
    falls back to the CDN if somebody forgets to install `redoc` — and the page
    then fails **blank**, because the `<script>` never loads and `Redoc.init`
    never runs. `"local"` turns that omission into a boot-time error.

!!! note "When the bundle fails to load, the page explains itself"
    Instead of a blank screen it shows which URL failed, confirms
    `/openapi.json` is still up, and says how to fix it. That covers a blocked
    CDN and a wrong `scriptUrl` alike.

!!! info "Redoc still fetches its own watermark"
    Even with a local bundle, Redoc requests
    `https://cdn.redoc.ly/redoc/logo-mini.svg` — the "API docs by Redocly" logo
    baked into their bundle, outside the SDK's control. With no network the
    little image is missing; the page renders fine.

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
- Swagger is offline; Redoc is too once `redoc` is installed (`bundle: "local"`
  to refuse the CDN fallback). Both pages ship a favicon, so no `/favicon.ico`
  request hits your API root.
- `/docs` and `/docs/` behave identically — absolute asset paths. 🚀
