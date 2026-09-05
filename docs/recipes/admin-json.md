# Admin headless (API JSON)

O módulo `admin` também expõe um **admin JSON**, com CRUD auto-derivado por
recurso e introspecção de campos: seu frontend (React, etc.) consome e
renderiza. É o irmão headless do [painel admin](admin.md) — use este quando a
UI é sua, e o painel quando você quer as telas prontas.

!!! warning "Nomes mudaram na 0.24.0"
    `AdminSite` e `makeAdminRouter` passaram a designar o **painel HTML**. O
    admin JSON virou `AdminJsonSite` + `makeAdminJsonRouter` (os tipos ganharam
    o mesmo infixo: `AdminJsonResource`, `AdminJsonField`, …). O prefixo padrão
    continua `/admin`, então montar os dois na mesma app exige dar um `prefix`
    diferente para um deles.

## Registrar recursos

Um `AdminJsonResource` é baseado em callbacks — conecte-o a um `BaseService`, a um
repositório `tempest-db-js`, ou a qualquer store.

```ts
import { AdminJsonSite, createApp, makeAdminJsonRouter, z } from "tempest-express-sdk";

const site = new AdminJsonSite("Painel");

site.register({
  name: "users",
  fields: [
    { name: "id", type: "string", readOnly: true },
    { name: "email", type: "string", required: true },
  ],
  createSchema: z.object({ email: z.email() }),
  updateSchema: z.object({ email: z.email() }),
  async list({ page, pageSize, filters }) {
    const data = await userService.paginate({ page, pageSize, filters });
    return data; // { items, total, page, pageSize, pages }
  },
  async get(id) {
    return userService.getByIdOrNull(id);
  },
  async create(data) {
    return userService.create(data as { email: string });
  },
  async update(id, data) {
    return userService.updateById(id, data);
  },
  async remove(id) {
    await userService.deleteById(id);
  },
});
```

## Montar o router (protegido)

Passe um `guard` — reuse o middleware JWT + `requireRoles("admin")`.

```ts
import { makeJwtAuthMiddleware, requireRoles } from "tempest-express-sdk";

const app = await createApp({
  configure: (a) => {
    a.use(
      makeAdminJsonRouter(site, {
        prefix: "/admin",
        guard: [makeJwtAuthMiddleware(jwt), requireRoles("admin")] as never,
      }),
    );
  },
});
```

!!! tip "Um guard só"
    `guard` aceita um único middleware. Para encadear auth + role, componha-os
    num middleware que chama um depois do outro, ou use `express.Router()` com
    os dois `use()` antes de montar o admin.

## Endpoints

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/admin` | Brand + lista de recursos |
| `GET` | `/admin/:resource/_meta` | Campos + operações suportadas |
| `GET` | `/admin/:resource` | Lista paginada (`?page=&pageSize=` + filtros) |
| `GET` | `/admin/:resource/:id` | Detalhe (404 se ausente) |
| `POST` | `/admin/:resource` | Cria (valida `createSchema`) |
| `PATCH` | `/admin/:resource/:id` | Atualiza (valida `updateSchema`) |
| `DELETE` | `/admin/:resource/:id` | Remove (204) |

Operação de escrita ausente no recurso → **405**; recurso desconhecido → **404**;
payload inválido → **422**.

## Recapitulando

Registre recursos (callbacks sobre seus services), monte um router guardado, e
qualquer frontend renderiza o admin a partir da introspecção `_meta`.
