# Tutorial

Let's build an API step by step. Each step adds **one** concept on top of the
last — and explains the why, not just the how. 💡

!!! info "Before you start"
    If you haven't run an app yet, do [Your first app](getting-started/first-app.md)
    first — it sets up the folder, installs everything and shows how to run with
    `npx tsx`. Here we assume you can create a `.ts` file and run it. Hit a
    strange term? The [Glossary](getting-started/glossary.md) explains it.

Put each example in a file (e.g. `app.ts`) and run it with `npx tsx app.ts`.

---

## 1. The first app

`createApp` assembles a service's conventional "skeleton" — JSON parsing, a
per-request id, CORS, a health check and error handling — and returns a ready
[Express](getting-started/glossary.md) app. `runServer` starts it.

```ts title="app.ts"
import { createApp, runServer } from "tempest-express-sdk";

const app = await createApp();
await runServer(app, { port: 8000 });
```

Run it (`npx tsx app.ts`) and open
[http://127.0.0.1:8000/health](http://127.0.0.1:8000/health) →
`{"status":"ok","checks":{}}`. ✅

!!! note "What is `await`?"
    `createApp` and `runServer` are **asynchronous** (they return a Promise),
    hence the `await`. If that's new, take a look at
    [async/await](getting-started/javascript.md).

**Recap:** `createApp()` + `runServer()` = a live server, with `/health` for free.

---

## 2. A Zod schema with OpenAPI

A **schema** describes the shape of some data. Import `z` from the SDK (it's
[Zod](getting-started/glossary.md) already carrying `.openapi()`) and register the
schema in a "registry" — it becomes documentation later:

```ts
import { createApp, createOpenApiRegistry, runServer, z } from "tempest-express-sdk";

const registry = createOpenApiRegistry();

const itemSchema = registry.register(
  "Item",
  z.object({
    id: z.string().uuid().openapi({ description: "The item identifier." }),
    name: z.string().openapi({ description: "The item name." }),
  }),
);
```

`z.object({...})` says "an object with these fields"; `z.string().uuid()` says "a
string that is a UUID". The `.openapi({ description })` attaches the description
that shows up in the docs.

**Recap:** you described `Item` **once**. Soon that becomes validation **and**
documentation.

---

## 3. Routes + native documentation

A **route** links a path (`/api/items`) to a function that answers. Pass
`openapi` to `createApp` and register routes inside `configure`:

```ts hl_lines="4 5 6 7 8 9 10 11"
const app = await createApp({
  openapi: { registry, info: { title: "Catalog", version: "1.0.0" } },
  configure: (app) => {
    registry.registerPath({
      method: "get",
      path: "/api/items",
      summary: "List items",
      responses: {
        200: { description: "OK", content: { "application/json": { schema: itemSchema.array() } } },
      },
    });
    app.get("/api/items", (_req, res) => res.json([]));
  },
});

await runServer(app, { port: 8000 });
```

Two things happen: `registry.registerPath({...})` **documents** the route, and
`app.get(...)` **implements** it. The function `(_req, res) => res.json([])` is
the **handler** — it takes the request (`req`) and the response (`res`), and
returns an empty list for now.

!!! tip "Free docs"
    Open [`/docs`](http://127.0.0.1:8000/docs) (Swagger UI) and
    [`/redoc`](http://127.0.0.1:8000/redoc) — both generated from the registry, no
    hand-written docs.

!!! note "Why `_req` with an underscore?"
    A convention: the leading `_` says "I don't use this parameter". Here the
    handler ignores the request and always returns `[]`.

**Recap:** `registerPath` documents, `app.get/post/...` implements. Swagger and
Redoc come ready.

---

## 4. Input validation

When the client **sends** data (a `POST`), you validate it with a schema. Invalid
data becomes **422** in the standard envelope, automatically:

```ts
const createSchema = z.object({ name: z.string().min(1) });

app.post("/api/items", (req, res) => {
  const data = createSchema.parse(req.body); // throws ZodError → 422
  res.status(201).json({ id: crypto.randomUUID(), ...data });
});
```

`createSchema.parse(req.body)` checks the request body. If `name` is missing or
empty, `.parse` **throws** an error that the SDK turns into this response:

```json
{ "detail": "Validation error", "code": "VALIDATION_ERROR", "details": { "issues": [ ] } }
```

If it passes, you answer **201 Created** with the new item (`crypto.randomUUID()`
generates an id).

!!! info "You don't write the `try/catch`"
    The error handler `createApp` installed catches the `ZodError` and builds the
    422. You just validate and move on.

**Recap:** `schema.parse(req.body)` validates input; errors become 422 on their
own; success answers 201.

---

## 5. Domain errors

When **your rule** fails (item doesn't exist, duplicate email), throw a subclass
of `AppException` — the handler serializes it to the same envelope, with the
right status:

```ts
import { NotFoundException } from "tempest-express-sdk";

app.get("/api/items/:id", (req) => {
  throw new NotFoundException({
    message: "Item not found",
    details: { id: req.params.id },
  });
});
```

→ HTTP **404**,
`{"detail":"Item not found","code":"NOT_FOUND","details":{"id":"…"}}`.

`:id` in the route is a **parameter**: in `/api/items/42`, `req.params.id` is
`"42"`. There are ready subclasses for the common cases — `NotFoundException`
(404), `ConflictException` (409), `UnauthorizedException` (401), etc.

**Recap:** throw `AppException` (or a subclass) and the envelope + status stay
consistent across the whole API.

---

## 6. Layered persistence

So far the data was made up on the spot. To **store** it for real, you define a
**model** (the shape of a table) and get a typed repository over
[`tempest-db-js`](getting-started/glossary.md):

```ts
import { BaseModel, column, tableNameFor } from "tempest-express-sdk";

class ItemModel extends BaseModel {
  static tablename = tableNameFor("ItemModel"); // "item"
  name = column.text().notNull();
}
```

`BaseModel` already ships `id` (UUID), `isActive`, `createdAt` and `updatedAt` —
you only declare your domain columns (here, `name`). Over that model, the SDK
offers the full **repository → service → controller → router** stack:

- **repository** — reads and writes rows.
- **service** — business logic; maps the row to the response.
- **controller** — orchestrates.
- **router** — exposes the routes.

Run `npx tempest-express generate Item` and **all of it is generated for you**.

!!! tip "The full database guide"
    Modeling tables, connecting the engine, filtering, paginating and migrating
    is in [Database (models + repositories)](recipes/database.md). To test
    without a real database, see [Testing](recipes/testing.md).

**Recap:** extend `BaseModel`, declare your columns, and get the typed stack — or
generate it with one command.

---

## Recap

You built an app, described a schema with OpenAPI, served native Swagger/Redoc,
validated input (422), threw domain errors (with the right status) and met the
data layer. That's the skeleton of **any** Tempest service. 🎉

**Continue with:**

- [Database](recipes/database.md) — model and persist for real.
- [Authentication (JWT)](recipes/auth.md) — protect routes by user and role.
- [Configuration](recipes/settings.md) — typed settings from environment variables.
- Lost on a term? [Glossary](getting-started/glossary.md).
