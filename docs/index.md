# tempest-express-sdk

Blocos de construção compartilhados para serviços **Express + Zod + tempest-db-js** —
um porte Node.js/TypeScript das convenções do
[`tempest-fastapi-sdk`](https://pypi.org/project/tempest-fastapi-sdk/). 🚀

TypeScript rígido, imports com alias `@` (sem sufixo `.js`), **Swagger UI + Redoc**
nativos gerados direto dos seus schemas Zod, e uma pilha em camadas
router → controller → service → repository → model sobre o
[`tempest-db-js`](https://www.npmjs.com/package/tempest-db-js).

!!! warning "Status: pré-alpha (v0.1.0)"
    A camada de fundação está pronta e testada. Vários módulos do
    `tempest-fastapi-sdk` ainda não foram portados (veja o [Changelog](changelog.md)).

## Por que usar

Você define o schema **uma vez** com Zod e ganha validação, tipos e documentação
OpenAPI ao mesmo tempo:

```ts
import { createApp, createOpenApiRegistry, runServer, z } from "tempest-express-sdk";

const registry = createOpenApiRegistry();
const Item = registry.register(
  "Item",
  z.object({ id: z.string().uuid(), name: z.string() }),
);

const app = await createApp({
  corsOrigins: "*",
  openapi: { registry, info: { title: "Minha API", version: "1.0.0" } },
  configure: (app) => {
    app.get("/api/items", (_req, res) => res.json([]));
  },
});

await runServer(app, { host: "127.0.0.1", port: 8000 });
```

Ao subir, você já tem:

- **Swagger UI** em `/docs`
- **Redoc** em `/redoc`
- **OpenAPI JSON** em `/openapi.json`
- **Health check** em `/health`

## O que tem dentro

| Área | Exports |
| --- | --- |
| **core** | `JSONLogger`, contexto de request-id, `defineEnum` |
| **exceptions** | `AppException` + subclasses HTTP, `MessageCatalog` (i18n) |
| **schemas** | `z` (com OpenAPI), `baseResponseSchema`, paginação (offset + cursor) |
| **settings** | `loadSettings`, `baseAppSettingsShape` |
| **db** | re-export do `tempest-db-js` + `BaseModel`, helpers de coluna |
| **services / controllers** | `BaseService`, `BaseController` |
| **utils** | CPF/CNPJ/CEP/telefone/UF, `PasswordUtils`, `JWTUtils`, tokens, throttle |
| **auth** | `UserAuthService`, middleware JWT, `makeAuthRouter` |
| **api** | `createApp`, `runServer`, Swagger/Redoc, health |

## Próximos passos

- [Instalação](installation.md)
- [Tutorial](tutorial.md)
- [Autenticação (JWT)](recipes/auth.md)
