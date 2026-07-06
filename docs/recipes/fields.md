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
- `syncFilterSchema` / `syncPaginationSchema` — delta-sync offline-first.
- `buildPaginationLinkHeader` — `Link` header RFC-5988.
- `logEntrySchema` — o shape de um registro de log. ✅
