# tempest-express-sdk

Blocos de construção compartilhados para serviços **Express + Zod + tempest-db-js** —
um porte Node.js/TypeScript das convenções do
[`tempest-fastapi-sdk`](https://pypi.org/project/tempest-fastapi-sdk/). 🚀

TypeScript rígido, imports com alias `@` (sem sufixo `.js`), **Swagger UI + Redoc**
nativos gerados direto dos seus schemas Zod, e uma pilha em camadas
router → controller → service → repository → model sobre o
[`tempest-db-js`](https://www.npmjs.com/package/tempest-db-js).

!!! tip "Nunca usou Node.js ou JavaScript? Comece aqui"
    A trilha [**Começando do zero**](getting-started/node.md) leva você de "nunca
    abri um terminal" até um app rodando — instalar o Node, o mínimo de JS/TS, e
    o [primeiro app](getting-started/first-app.md) passo a passo.

!!! check "Status: paridade com o `tempest-fastapi-sdk` (v0.20.0)"
    O SDK atingiu paridade de features com o `tempest-fastapi-sdk`. Veja o
    [Changelog](changelog.md) e o [Roadmap](roadmap.md).

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

- 🌱 Iniciante? [Começando do zero](getting-started/node.md) → [Seu primeiro app](getting-started/first-app.md)
- [Instalação](installation.md)
- [Tutorial](tutorial.md)
- [Glossário](getting-started/glossary.md) — termos explicados
- [Autenticação (JWT)](recipes/auth.md)
