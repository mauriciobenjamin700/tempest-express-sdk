# Tutorial

Let's build an API step by step. Each step adds **one** concept on top of the
previous. 💡

## 1. Your first app

`createApp` wires the conventional stack (JSON, request-id, CORS, health, error
handlers) and returns a ready Express app:

```ts
import { createApp, runServer } from "tempest-express-sdk";

const app = await createApp();
await runServer(app, { port: 8000 });
```

Open `http://127.0.0.1:8000/health` → `{"status":"ok","checks":{}}`. ✅

## 2. A Zod schema with OpenAPI

Import the SDK's `z` (already `.openapi()`-enabled) and register the schema:

```ts
import { createApp, createOpenApiRegistry, runServer, z } from "tempest-express-sdk";

const registry = createOpenApiRegistry();

const itemSchema = registry.register(
  "Item",
  z.object({
    id: z.string().uuid().openapi({ description: "Item identifier." }),
    name: z.string().openapi({ description: "Item name." }),
  }),
);
```

## 3. Routes + native docs

Pass `openapi` and mount routes inside `configure`:

```ts hl_lines="3 4 5 6 7 8"
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

!!! tip "Free docs"
    Open `/docs` (Swagger UI) and `/redoc` (Redoc) — both generated from the registry.

## 4. Input validation

Validate the body with the schema; a validation error becomes a **422** in the
canonical envelope automatically:

```ts
const createSchema = z.object({ name: z.string().min(1) });

app.post("/api/items", (req, res) => {
  const data = createSchema.parse(req.body); // throws ZodError → 422
  res.status(201).json({ id: crypto.randomUUID(), ...data });
});
```

An invalid body responds:

```json
{ "detail": "Validation error", "code": "VALIDATION_ERROR", "details": { "issues": [ ... ] } }
```

## 5. Domain errors

Throw any `AppException` subclass — the handler serializes it to the envelope:

```ts
import { NotFoundException } from "tempest-express-sdk";

app.get("/api/items/:id", (req) => {
  throw new NotFoundException({ message: "Item not found", details: { id: req.params.id } });
});
```

→ HTTP **404**, `{"detail":"Item not found","code":"NOT_FOUND","details":{"id":"…"}}`.

## 6. Layered persistence

With `tempest-db-js` you define a model and get a typed repository:

```ts
import { BaseModel, BaseService, column, tableNameFor } from "tempest-express-sdk";

class ItemModel extends BaseModel {
  static tablename = tableNameFor("ItemModel"); // "item"
  name = column.text().notNull();
}
```

`BaseModel` already ships `id` (UUID), `isActive`, `createdAt` and `updatedAt`.
Use `BaseRepository` / `BaseService` / `BaseController` for the full stack — or
run `tempest-express generate Item` and it's all generated for you.

The complete guide — modeling tables, connecting the engine, standing up the
repository, filtering, paginating and migrating — is in
[Database (models + repositories)](recipes/database.md).

## Recap

You built an app, registered an OpenAPI schema, served native Swagger/Redoc,
validated input (422), threw domain errors, and met the data layer. Continue with
[Authentication (JWT)](recipes/auth.md). 🎉
