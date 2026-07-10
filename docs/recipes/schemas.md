# Schemas (base, resposta e paginação)

Todo endpoint recebe e devolve dados. Em vez de validar "na mão" e montar o
JSON de resposta com objetos soltos, o SDK dá uma **fundação de schemas Zod** —
o porte de `schemas.base` (`BaseSchema` / `BaseResponseSchema`) e
`schemas.pagination` do `tempest-fastapi-sdk`.

Um schema faz três coisas de uma vez:

1. **Valida** a entrada (query, body, params) e lança `ZodError` quando algo
   está errado.
2. **Tipa** o resultado — o TypeScript infere o tipo direto do schema.
3. **Documenta** — como `z` já vem com `.openapi()`, cada campo alimenta o
   Swagger/Redoc (veja [API: app, OpenAPI e docs](api.md)).

!!! info "De onde vem o `z`"
    `z` é o Zod **já aumentado** com `.openapi()`, re-exportado pelo SDK.
    Importe sempre de `tempest-express-sdk`, nunca de `zod` direto — senão o
    `.openapi()` não existe no seu `z`.

    ```ts
    import { z } from "tempest-express-sdk";
    ```

---

## 1. `toDict` — serializar limpando nulos

`toDict` espelha o `BaseSchema.to_dict` do FastAPI SDK: transforma um objeto
validado num record simples, **descartando `null`/`undefined`**, removendo
chaves e mesclando extras.

```ts
import { toDict } from "tempest-express-sdk";

const user = { id: "u1", name: "Ana", nickname: null, password: "secret" };

toDict(user);
// { id: "u1", name: "Ana" }  ← nickname (null) sumiu

toDict(user, { exclude: ["password"] });
// { id: "u1", name: "Ana" }  ← password removido

toDict(user, { include: { role: "admin" } });
// { id: "u1", name: "Ana", role: "admin" }  ← extra mesclado por cima
```

!!! tip "Para que serve"
    Útil ao montar filtros para o repositório (só as chaves preenchidas) ou ao
    devolver um payload sem campos sensíveis. É a mesma ideia do
    `exclude_none=True` do Pydantic.

---

## 2. `baseResponseSchema` — os campos que todo registro tem

Todo registro do `tempest-db-js` carrega `id`, `isActive`, `createdAt` e
`updatedAt`. Em vez de repetir isso em cada `*ResponseSchema`, **estenda** o
base:

```ts hl_lines="3"
import { baseResponseSchema, z } from "tempest-express-sdk";

const userResponseSchema = baseResponseSchema.extend({
  name: z.string().openapi({ description: "O nome de exibição do usuário." }),
  email: z.string().email().openapi({ description: "O e-mail do usuário." }),
});

type UserResponse = z.infer<typeof userResponseSchema>;
// { id: string; isActive: boolean; createdAt: Date; updatedAt: Date;
//   name: string; email: string }
```

O que o base já traz:

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `id` | `string` (uuid) | Identificador único do registro. |
| `isActive` | `boolean` | Flag de soft-delete. |
| `createdAt` | `Date` (coerce) | Timestamp de criação (UTC). |
| `updatedAt` | `Date` (coerce) | Timestamp da última atualização (UTC). |

!!! note "`z.coerce.date()` aceita string"
    `createdAt`/`updatedAt` usam `z.coerce.date()`, então uma string ISO vinda
    do banco ou de JSON vira `Date` automaticamente no parse.

---

## 3. Os três schemas de um recurso

O padrão do SDK: **Create** (entrada), **Update** (entrada parcial) e
**Response** (saída). Nomeie sempre com o sufixo do propósito.

```ts
import { baseResponseSchema, z } from "tempest-express-sdk";

// entrada de criação — sem id/timestamps (o banco gera)
export const userCreateSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

// entrada de atualização — tudo opcional
export const userUpdateSchema = userCreateSchema.partial();

// saída — base + campos públicos, SEM a senha
export const userResponseSchema = baseResponseSchema.extend({
  name: z.string(),
  email: z.string().email(),
});

export type UserCreate = z.infer<typeof userCreateSchema>;
export type UserUpdate = z.infer<typeof userUpdateSchema>;
export type UserResponse = z.infer<typeof userResponseSchema>;
```

Uso num router:

```ts
router.post("/api/users", async (req, res) => {
  const data = userCreateSchema.parse(req.body); // 400 automático se inválido
  const created = await repo.create(data);
  res.status(201).json(userResponseSchema.parse(created)); // saída limpa
});
```

!!! warning "Faça o parse da saída também"
    `userResponseSchema.parse(created)` não é só firula: ele **garante** que a
    senha (ausente no schema de resposta) nunca vaze, mesmo que o repositório
    devolva a coluna. Validar a saída é sua última linha de defesa.

---

## 4. Paginação por offset

Para listas com página + tamanho. `paginationFilterSchema` faz o parse da query;
`paginationSchema(item)` monta o envelope da resposta.

```ts
import {
  paginationFilterSchema,
  paginationSchema,
  getConditions,
  getPaginationConditions,
  z,
} from "tempest-express-sdk";

const userItem = z.object({ id: z.string(), name: z.string() });
const UserPage = paginationSchema(userItem);

router.get("/api/users", async (req, res) => {
  // estenda o filtro base com filtros de domínio
  const filter = paginationFilterSchema
    .extend({ isActive: z.coerce.boolean().optional() })
    .parse(req.query);

  const page = await repo.paginate({
    ...getPaginationConditions(filter),      // { page, pageSize, orderBy, ascending }
    filters: getConditions(filter),          // só os filtros de domínio (isActive)
  });

  res.json(UserPage.parse(page));
});
```

`paginationFilterSchema` traz `page` (≥1, default 1), `pageSize` (≥1, default 20),
`orderBy?` e `ascending` (default `true`) — os nomes casam com os argumentos do
`BaseRepository.paginate`, então repassam sem renomear.

- **`getPaginationConditions(filter)`** → extrai `{ page, pageSize, orderBy, ascending }`.
- **`getConditions(filter)`** → remove as chaves de paginação e devolve **só**
  os filtros de domínio.

O envelope `paginationSchema(item)` devolve `{ items, total, page, pageSize, pages }`.

---

## 5. Paginação por cursor

Para feeds/scroll infinito, onde offset fica caro. Cursor opaco, sem pular
páginas.

```ts
import {
  cursorPaginationFilterSchema,
  cursorPaginationSchema,
  encodeCursor,
  decodeCursor,
  z,
} from "tempest-express-sdk";

const userItem = z.object({ id: z.string(), name: z.string() });
const UserFeed = cursorPaginationSchema(userItem);

router.get("/api/users/feed", async (req, res) => {
  const f = cursorPaginationFilterSchema.parse(req.query); // { cursor?, limit, orderBy, ascending }
  const after = f.cursor ? decodeCursor(f.cursor) : undefined;

  // `BaseRepository.list(filters)` devolve as linhas que casam (sem limit no
  // repo); ordene por `id` e recorte a página no app.
  const rows = (await repo.list(after ? { id: { gt: String(after.id) } } : {})).sort(
    (a, b) => a.id.localeCompare(b.id),
  );

  const hasMore = rows.length > f.limit;
  const items = rows.slice(0, f.limit);
  const last = items.at(-1);

  res.json(
    UserFeed.parse({
      items: items.map((u) => ({ id: u.id, name: u.name })),
      nextCursor: hasMore && last ? encodeCursor({ id: last.id }) : null,
      hasMore,
      limit: f.limit,
    }),
  );
});
```

- **`encodeCursor(payload)`** → base64url URL-safe (sem padding).
- **`decodeCursor(cursor)`** → volta ao objeto; lança `Error` se o cursor for
  inválido.

!!! note "O repositório pagina offset nativamente"
    `BaseRepository.paginate` cobre offset embutido. O `list(filters)` recebe
    **só** condições (`WhereInput`) — sem `limit`/`orderBy` —, então o cursor
    você monta com `list({ id: { gt } })` + estes helpers + recorte no app. O
    padrão completo está em [Banco de dados](database.md).

!!! tip "Offset ou cursor?"
    **Offset** para telas de tabela com "página 3 de 12". **Cursor** para feeds
    infinitos e sync — não sofre com inserções deslocando as páginas.

Para o modo **delta-sync** (offline-first, `since`/`serverTime`) veja
[Campos validados e paginação](fields.md#2-paginacao-delta-sync-offline-first).

---

## Recapitulando

- `z` do SDK vem com `.openapi()` — importe dele, não do `zod`.
- `toDict` limpa nulos, exclui e mescla — como `to_dict` do Pydantic.
- `baseResponseSchema.extend({...})` = `id`/`isActive`/`createdAt`/`updatedAt` +
  seus campos.
- Padrão de recurso: `*CreateSchema`, `*UpdateSchema` (`.partial()`),
  `*ResponseSchema` — e **parseie a saída** para não vazar campos.
- `paginationFilterSchema` + `paginationSchema(item)` para offset;
  `cursorPaginationFilterSchema` + `cursorPaginationSchema(item)` +
  `encodeCursor`/`decodeCursor` para cursor. ✅
