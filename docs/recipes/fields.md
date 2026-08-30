# Campos validados e extras de paginação

Blocos Zod prontos para reaproveitar em DTOs, mais os extras de paginação
(delta-sync, `Link` header) e o schema de log — porte de `utils.fields` /
`schemas.pagination` (Sync) / `schemas.link_headers` / `schemas.logs`.

---

## 1. Tipos de campo prontos

Pare de reescrever a mesma restrição. Componha nos seus schemas:

```ts
import { z, centsField, priceField, percentField, slugField, hexColorField } from "tempest-express-sdk";

const productSchema = z.object({
  slug: slugField,           // ^[a-z0-9]+(-[a-z0-9]+)*$
  priceCents: centsField,    // inteiro >= 0 (dinheiro sem float)
  price: priceField,         // string decimal exata: "19.90"
  discountPct: percentField, // 0..100
  color: hexColorField,      // #rgb ou #rrggbb
});
```

Disponíveis:

| Numéricos | Faixa | | Strings | Regra |
| --- | --- | --- | --- | --- |
| `positiveIntField` | `> 0` | | `nonEmptyStrField` | trim + `min 1` |
| `nonNegativeIntField` | `>= 0` | | `slugField` | slug minúsculo |
| `centsField` | int `>= 0` | | `hexColorField` | `#rgb`/`#rrggbb` |
| `portField` | `1..65535` | | `priceField` | string decimal `"19.90"` |
| `ratingField` | `0..5` | | | |
| `positiveFloatField` | `> 0` | | | |
| `percentField` | `0..100` | | | |
| `ratioField` | `0..1` | | | |
| `latitudeField` | `-90..90` | | | |
| `longitudeField` | `-180..180` | | | |

!!! tip "Dinheiro: `centsField` ou `priceField`"
    Guarde valores em centavos (`centsField`, inteiro) para aritmética exata, ou
    como string decimal (`priceField`) espelhando as colunas `numeric` do
    `tempest-db-js` — nunca `float`, que perde precisão.

---

### `looseBoolean` — o booleano que chega como texto

Query string e variável de ambiente entregam **string**, e aí `z.coerce.boolean()`
é uma armadilha: ele é `Boolean(input)`, então `"false"` e `"0"` viram `true` e
não existe forma de pedir `false` pela URL.

`looseBoolean(default)` lê os tokens dos dois lados e **recusa** o que não
reconhece, para um typo virar 422 em vez de um `false` silencioso:

```ts
import { looseBoolean, z } from "tempest-express-sdk";

const filterSchema = z.object({ onlyActive: looseBoolean(true) });

filterSchema.parse({ onlyActive: "false" }).onlyActive; // false ✅
filterSchema.parse({ onlyActive: " YES " }).onlyActive; // true  (trim + case-insensitive)
filterSchema.parse({ onlyActive: "" }).onlyActive;      // true  (vazio = ausente → default)
filterSchema.parse({}).onlyActive;                      // true  (default)
filterSchema.parse({ onlyActive: "talvez" });           // ❌ ZodError
```

| Vira `true` | Vira `false` |
| --- | --- |
| `true` `1` `yes` `on` `y` `enabled` | `false` `0` `no` `off` `n` `disabled` |

!!! info "É o mesmo helper do `envBoolean`"
    `envBoolean` dos settings é este mesmo `looseBoolean` sob outro nome — uma
    implementação só, para o booleano do filtro e o da variável de ambiente
    nunca divergirem. Detalhes em
    [Configuração (settings tipados)](settings.md#3-booleans-e-listas-do-ambiente).

!!! tip "Já vem aplicado nos filtros do SDK"
    `paginationFilterSchema.ascending`, `cursorPaginationFilterSchema.ascending`
    e `syncFilterSchema.includeDeleted` usam `looseBoolean`, então
    `?ascending=false` faz o que diz. No OpenAPI o campo aparece como
    `type: boolean` com o `default`, não como a união usada para parsear.

---

## 2. Paginação delta-sync (offline-first)

Para clientes que puxam "tudo que mudou desde o último sync". O cliente devolve o
`serverTime` da página anterior como `since` — usar o relógio do **servidor**
evita buracos por clock skew.

```ts
import {
  getConditions,
  syncFilterSchema,
  syncPaginationSchema,
  z,
} from "tempest-express-sdk";

const userSyncItem = z.object({ id: z.string(), name: z.string() });
const UserSyncPage = syncPaginationSchema(userSyncItem);

router.get("/api/users/sync", async (req, res) => {
  const f = syncFilterSchema.parse(req.query); // { since?, cursor?, limit, includeDeleted }
  const serverTime = new Date();
  const changed = await repo.list({
    ...getConditions(f, { exclude: ["since", "cursor", "limit", "includeDeleted"] }),
    ...(f.since ? { updatedAt: { gt: f.since } } : {}),
  });
  res.json(
    UserSyncPage.parse({
      items: changed.slice(0, f.limit).map((u) => ({ id: u.id, name: u.name })),
      nextCursor: null,
      hasMore: changed.length > f.limit,
      limit: f.limit,
      serverTime, // o cliente persiste e reenvia como `since`
    }),
  );
});
```

---

## 3. `Link` header de paginação (RFC-5988)

Emita os rels `first`/`prev`/`next`/`last` que clientes estilo GitHub esperam:

```ts
import { buildPaginationLinkHeader } from "tempest-express-sdk";

const page = await repo.paginate({ page: 2, pageSize: 20, filters: { isActive: true } });
res.setHeader(
  "Link",
  buildPaginationLinkHeader({
    baseUrl: "/api/users",
    page: page.page,
    pageSize: page.pageSize,
    pages: page.pages,
    extraParams: { active: "true" }, // preservado em todos os links
  }),
);
res.json(page);
```

`prev`/`next` são omitidos nas pontas; retorna `""` quando há uma página só.

---

## 4. `logEntrySchema`

O shape de um registro de log estruturado (o mesmo que o `JSONLogger` emite).
Aberto (`passthrough`), então chaves `extra` (`path`, `requestId`, `http_500`)
sobrevivem — útil ao servir um endpoint de logs:

```ts
import { logEntrySchema } from "tempest-express-sdk";

const entry = logEntrySchema.parse(JSON.parse(line));
// { timestamp, level, logger, message, requestId?, stack?, ...extra }
```

---

## Recapitulando

- Tipos de campo (`centsField`, `priceField`, `slugField`, …) — restrições Zod
  reaproveitáveis.
- `looseBoolean` — o booleano que chega como texto: `"false"` é `false`, token
  desconhecido é erro. Já aplicado nos filtros de paginação e sync.
- `syncFilterSchema` / `syncPaginationSchema` — delta-sync offline-first.
- `buildPaginationLinkHeader` — `Link` header RFC-5988.
- `logEntrySchema` — o shape de um registro de log. ✅
