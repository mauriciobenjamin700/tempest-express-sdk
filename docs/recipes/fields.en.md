# Validated fields and pagination extras

Ready-made Zod building blocks for DTOs, plus the pagination extras (delta-sync,
`Link` header) and the log record schema — a port of `utils.fields` /
`schemas.pagination` (Sync) / `schemas.link_headers` / `schemas.logs`.

---

## 1. Ready-made field types

Stop re-writing the same constraint. Compose them into your schemas:

```ts
import { z, centsField, priceField, percentField, slugField, hexColorField } from "tempest-express-sdk";

const productSchema = z.object({
  slug: slugField,           // ^[a-z0-9]+(-[a-z0-9]+)*$
  priceCents: centsField,    // integer >= 0 (money without float)
  price: priceField,         // exact decimal string: "19.90"
  discountPct: percentField, // 0..100
  color: hexColorField,      // #rgb or #rrggbb
});
```

Available:

| Numeric | Range | | Strings | Rule |
| --- | --- | --- | --- | --- |
| `positiveIntField` | `> 0` | | `nonEmptyStrField` | trim + `min 1` |
| `nonNegativeIntField` | `>= 0` | | `slugField` | lowercase slug |
| `centsField` | int `>= 0` | | `hexColorField` | `#rgb`/`#rrggbb` |
| `portField` | `1..65535` | | `priceField` | decimal string `"19.90"` |
| `ratingField` | `0..5` | | | |
| `positiveFloatField` | `> 0` | | | |
| `percentField` | `0..100` | | | |
| `ratioField` | `0..1` | | | |
| `latitudeField` | `-90..90` | | | |
| `longitudeField` | `-180..180` | | | |

!!! tip "Money: `centsField` or `priceField`"
    Store amounts in cents (`centsField`, integer) for exact arithmetic, or as a
    decimal string (`priceField`) mirroring `tempest-db-js` `numeric` columns —
    never a `float`, which loses precision.

---

### `looseBoolean` — the boolean that arrives as text

Query strings and environment variables hand you a **string**, and there
`z.coerce.boolean()` is a trap: it is `Boolean(input)`, so `"false"` and `"0"`
become `true` and there is no way to ask for `false` over the URL.

`looseBoolean(default)` reads the tokens on both sides and **rejects** what it
does not recognise, so a typo becomes a 422 instead of a silent `false`:

```ts
import { looseBoolean, z } from "tempest-express-sdk";

const filterSchema = z.object({ onlyActive: looseBoolean(true) });

filterSchema.parse({ onlyActive: "false" }).onlyActive; // false ✅
filterSchema.parse({ onlyActive: " YES " }).onlyActive; // true  (trimmed, case-insensitive)
filterSchema.parse({ onlyActive: "" }).onlyActive;      // true  (empty = absent → default)
filterSchema.parse({}).onlyActive;                      // true  (default)
filterSchema.parse({ onlyActive: "maybe" });            // ❌ ZodError
```

| Becomes `true` | Becomes `false` |
| --- | --- |
| `true` `1` `yes` `on` `y` `enabled` | `false` `0` `no` `off` `n` `disabled` |

!!! info "It is the same helper as `envBoolean`"
    The settings' `envBoolean` is this very `looseBoolean` under another name —
    one implementation, so the boolean in a filter and the one in an environment
    variable can never drift apart. Details in
    [Configuration (typed settings)](settings.md#3-booleans-and-lists-from-the-environment).

!!! tip "Already applied to the SDK's filters"
    `paginationFilterSchema.ascending`, `cursorPaginationFilterSchema.ascending`
    and `syncFilterSchema.includeDeleted` use `looseBoolean`, so
    `?ascending=false` does what it says. In OpenAPI the field shows up as
    `type: boolean` with its `default`, not as the union used to parse it.

---

## 2. Delta-sync pagination (offline-first)

For clients that pull "everything changed since my last sync". The client sends
the previous page's `serverTime` back as `since` — using the **server** clock
avoids clock-skew gaps.

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
      serverTime, // the client persists this and sends it back as `since`
    }),
  );
});
```

---

## 3. Pagination `Link` header (RFC-5988)

Emit the `first`/`prev`/`next`/`last` rels GitHub-style clients expect:

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
    extraParams: { active: "true" }, // preserved on every link
  }),
);
res.json(page);
```

`prev`/`next` are omitted at the ends; returns `""` for a single page.

---

## 4. `logEntrySchema`

The shape of one structured log record (the same one `JSONLogger` emits). It's
open (`passthrough`), so `extra` keys (`path`, `requestId`, `http_500`) survive —
useful when serving a logs endpoint:

```ts
import { logEntrySchema } from "tempest-express-sdk";

const entry = logEntrySchema.parse(JSON.parse(line));
// { timestamp, level, logger, message, requestId?, stack?, ...extra }
```

---

## Recap

- Field types (`centsField`, `priceField`, `slugField`, …) — reusable Zod
  constraints.
- `looseBoolean` — the boolean that arrives as text: `"false"` is `false`, an
  unknown token is an error. Already applied to the pagination and sync filters.
- `syncFilterSchema` / `syncPaginationSchema` — offline-first delta sync.
- `buildPaginationLinkHeader` — an RFC-5988 `Link` header.
- `logEntrySchema` — the shape of a log record. ✅
