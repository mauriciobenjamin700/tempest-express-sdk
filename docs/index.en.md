# tempest-express-sdk

Shared building blocks for **Express + Zod + tempest-db-js** services — a
Node.js/TypeScript port of the conventions in
[`tempest-fastapi-sdk`](https://pypi.org/project/tempest-fastapi-sdk/). 🚀

Strict TypeScript, `@`-alias imports (no `.js` suffix), native **Swagger UI +
Redoc** generated straight from your Zod schemas, and a layered
router → controller → service → repository → model stack on top of
[`tempest-db-js`](https://www.npmjs.com/package/tempest-db-js).

!!! warning "Status: pre-alpha (v0.1.0)"
    The foundation layer is built and tested. Several `tempest-fastapi-sdk`
    feature modules are not yet ported (see the [Changelog](changelog.md)).

## Why

Define your schema **once** with Zod and get validation, types and OpenAPI docs
all at once:

```ts
import { createApp, createOpenApiRegistry, runServer, z } from "tempest-express-sdk";

const registry = createOpenApiRegistry();
const Item = registry.register(
  "Item",
  z.object({ id: z.string().uuid(), name: z.string() }),
);

const app = await createApp({
  corsOrigins: "*",
  openapi: { registry, info: { title: "My API", version: "1.0.0" } },
  configure: (app) => {
    app.get("/api/items", (_req, res) => res.json([]));
  },
});

await runServer(app, { host: "127.0.0.1", port: 8000 });
```

On boot you already get:

- **Swagger UI** at `/docs`
- **Redoc** at `/redoc`
- **OpenAPI JSON** at `/openapi.json`
- **Health check** at `/health`

## What's inside

| Area | Exports |
| --- | --- |
| **core** | `JSONLogger`, request-id context, `defineEnum` |
| **exceptions** | `AppException` + HTTP subclasses, `MessageCatalog` (i18n) |
| **schemas** | `z` (OpenAPI-augmented), `baseResponseSchema`, pagination (offset + cursor) |
| **settings** | `loadSettings`, `baseAppSettingsShape` |
| **db** | re-exports `tempest-db-js` + `BaseModel`, column helpers |
| **services / controllers** | `BaseService`, `BaseController` |
| **utils** | CPF/CNPJ/CEP/phone/UF, `PasswordUtils`, `JWTUtils`, tokens, throttle |
| **auth** | `UserAuthService`, JWT middleware, `makeAuthRouter` |
| **api** | `createApp`, `runServer`, Swagger/Redoc, health |

## Next steps

- [Installation](installation.md)
- [Tutorial](tutorial.md)
- [Authentication (JWT)](recipes/auth.md)
