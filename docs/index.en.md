# tempest-express-sdk

Shared building blocks for **Express + Zod + tempest-db-js** services — a
Node.js/TypeScript port of the conventions in
[`tempest-fastapi-sdk`](https://pypi.org/project/tempest-fastapi-sdk/). 🚀

Strict TypeScript, `@`-alias imports (no `.js` suffix), native **Swagger UI +
Redoc** generated straight from your Zod schemas, and a layered
router → controller → service → repository → model stack on top of
[`tempest-db-js`](https://www.npmjs.com/package/tempest-db-js).

!!! tip "Never used Node.js or JavaScript? Start here"
    The [**Getting started from zero**](getting-started/node.md) track takes you
    from "never opened a terminal" to a running app — install Node, the minimum
    JS/TS, and your [first app](getting-started/first-app.md) step by step.

!!! check "Status: parity with `tempest-fastapi-sdk` (v0.20.0)"
    The SDK has reached feature parity with `tempest-fastapi-sdk`. See the
    [Changelog](changelog.md) and the [Roadmap](roadmap.md).

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

- 🌱 New here? [Getting started from zero](getting-started/node.md) → [Your first app](getting-started/first-app.md)
- [Installation](installation.md)
- [Tutorial](tutorial.md)
- [Glossary](getting-started/glossary.md) — terms explained
- [Authentication (JWT)](recipes/auth.md)
