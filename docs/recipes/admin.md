# Admin (API JSON)

O módulo `admin` expõe um **admin JSON** com CRUD auto-derivado por recurso e
introspecção de campos — um frontend (React, etc.) consome e renderiza. Ao
contrário do admin server-rendered do FastAPI SDK, aqui a UI fica desacoplada.

## Registrar recursos

Um `AdminResource` é baseado em callbacks — conecte-o a um `BaseService`, a um
repositório `tempest-db-js`, ou a qualquer store.

```ts
import { AdminSite, createApp, makeAdminRouter, z } from "tempest-express-sdk";

const site = new AdminSite("Painel");

site.register({
  name: "users",
  fields: [
    { name: "id", type: "string", readOnly: true },
    { name: "email", type: "string", required: true },
  ],
  createSchema: z.object({ email: z.string().email() }),
  updateSchema: z.object({ email: z.string().email() }),
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
      makeAdminRouter(site, {
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
