# Schemas (base, response and pagination)

Every endpoint receives and returns data. Instead of validating by hand and
assembling the response JSON from loose objects, the SDK gives you a **Zod
schema foundation** — the port of `schemas.base` (`BaseSchema` /
`BaseResponseSchema`) and `schemas.pagination` from `tempest-fastapi-sdk`.

A schema does three things at once:

1. **Validates** the input (query, body, params) and throws `ZodError` when
   something is wrong.
2. **Types** the result — TypeScript infers the type straight from the schema.
3. **Documents** — since `z` already ships `.openapi()`, every field feeds
   Swagger/Redoc (see [API: app, OpenAPI and docs](api.md)).

!!! info "Where `z` comes from"
    `z` is Zod **already augmented** with `.openapi()`, re-exported by the SDK.
    Always import it from `tempest-express-sdk`, never from `zod` directly —
    otherwise `.openapi()` won't exist on your `z`.

    ```ts
    import { z } from "tempest-express-sdk";
    ```

---

## 1. `toDict` — serialize dropping nullish

`toDict` mirrors FastAPI SDK's `BaseSchema.to_dict`: it turns a validated object
into a plain record, **dropping `null`/`undefined`**, removing keys and merging
extras.

```ts
import { toDict } from "tempest-express-sdk";

const user = { id: "u1", name: "Ana", nickname: null, password: "secret" };

toDict(user);
// { id: "u1", name: "Ana" }  ← nickname (null) is gone

toDict(user, { exclude: ["password"] });
// { id: "u1", name: "Ana" }  ← password removed

toDict(user, { include: { role: "admin" } });
// { id: "u1", name: "Ana", role: "admin" }  ← extra merged on top
```

!!! tip "What it's for"
    Handy when building repository filters (only the filled keys) or when
    returning a payload without sensitive fields. Same idea as Pydantic's
    `exclude_none=True`.

---

## 2. `baseResponseSchema` — the fields every record carries

Every `tempest-db-js` record carries `id`, `isActive`, `createdAt` and
`updatedAt`. Instead of repeating that in each `*ResponseSchema`, **extend** the
base:

```ts hl_lines="3"
import { baseResponseSchema, z } from "tempest-express-sdk";

const userResponseSchema = baseResponseSchema.extend({
  name: z.string().openapi({ description: "The user's display name." }),
  email: z.string().email().openapi({ description: "The user's email." }),
});

type UserResponse = z.infer<typeof userResponseSchema>;
// { id: string; isActive: boolean; createdAt: Date; updatedAt: Date;
//   name: string; email: string }
```

What the base already brings:

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` (uuid) | The record's unique id. |
| `isActive` | `boolean` | Soft-delete flag. |
| `createdAt` | `Date` (coerce) | Creation timestamp (UTC). |
| `updatedAt` | `Date` (coerce) | Last-update timestamp (UTC). |

!!! note "`z.coerce.date()` accepts strings"
    `createdAt`/`updatedAt` use `z.coerce.date()`, so an ISO string coming from
    the DB or JSON becomes a `Date` automatically on parse.

---

## 3. A resource's three schemas

The SDK pattern: **Create** (input), **Update** (partial input) and **Response**
(output). Always name them with the purpose suffix.

```ts
import { baseResponseSchema, z } from "tempest-express-sdk";

// create input — no id/timestamps (the DB generates them)
export const userCreateSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

// update input — everything optional
export const userUpdateSchema = userCreateSchema.partial();

// output — base + public fields, NO password
export const userResponseSchema = baseResponseSchema.extend({
  name: z.string(),
  email: z.string().email(),
});

export type UserCreate = z.infer<typeof userCreateSchema>;
export type UserUpdate = z.infer<typeof userUpdateSchema>;
export type UserResponse = z.infer<typeof userResponseSchema>;
```

Used in a router:

```ts
router.post("/api/users", async (req, res) => {
  const data = userCreateSchema.parse(req.body); // automatic 400 if invalid
  const created = await repo.create(data);
  res.status(201).json(userResponseSchema.parse(created)); // clean output
});
```

!!! warning "Parse the output too"
    `userResponseSchema.parse(created)` isn't decoration: it **guarantees** the
    password (absent from the response schema) never leaks, even if the
    repository returns the column. Validating the output is your last line of
    defense.

---

## 4. Offset pagination

For page + size lists. `paginationFilterSchema` parses the query;
`paginationSchema(item)` builds the response envelope.

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
  // extend the base filter with domain filters
  const filter = paginationFilterSchema
    .extend({ isActive: z.coerce.boolean().optional() })
    .parse(req.query);

  const page = await repo.paginate({
    ...getPaginationConditions(filter),      // { page, pageSize, orderBy, ascending }
    filters: getConditions(filter),          // only the domain filters (isActive)
  });

  res.json(UserPage.parse(page));
});
```

`paginationFilterSchema` brings `page` (≥1, default 1), `pageSize` (≥1, default
20), `orderBy?` and `ascending` (default `true`) — the names match
`BaseRepository.paginate`'s arguments, so they forward with no renaming.

- **`getPaginationConditions(filter)`** → extracts `{ page, pageSize, orderBy, ascending }`.
- **`getConditions(filter)`** → strips the pagination keys and returns **only**
  the domain filters.

The `paginationSchema(item)` envelope returns `{ items, total, page, pageSize, pages }`.

---

## 5. Cursor pagination

For feeds / infinite scroll, where offset gets expensive. Opaque cursor, no page
skipping.

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

  // `BaseRepository.list(filters)` returns the matching rows (no limit on the
  // repo); order by `id` and slice the page in the app.
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

- **`encodeCursor(payload)`** → URL-safe base64url (no padding).
- **`decodeCursor(cursor)`** → back to the object; throws `Error` if the cursor
  is invalid.

!!! note "The repository paginates offset natively"
    `BaseRepository.paginate` covers offset out of the box. `list(filters)` takes
    **only** conditions (`WhereInput`) — no `limit`/`orderBy` — so you assemble a
    cursor with `list({ id: { gt } })` + these helpers + slicing in the app. The
    full pattern is in [Database](database.md).

!!! tip "Offset or cursor?"
    **Offset** for table screens with "page 3 of 12". **Cursor** for infinite
    feeds and sync — it doesn't suffer from inserts shifting the pages.

For the **delta-sync** mode (offline-first, `since`/`serverTime`) see
[Validated fields and pagination](fields.md#2-delta-sync-pagination-offline-first).

---

## Recap

- The SDK's `z` ships `.openapi()` — import it from the SDK, not from `zod`.
- `toDict` drops nullish, excludes and merges — like Pydantic's `to_dict`.
- `baseResponseSchema.extend({...})` = `id`/`isActive`/`createdAt`/`updatedAt` +
  your fields.
- Resource pattern: `*CreateSchema`, `*UpdateSchema` (`.partial()`),
  `*ResponseSchema` — and **parse the output** so you don't leak fields.
- `paginationFilterSchema` + `paginationSchema(item)` for offset;
  `cursorPaginationFilterSchema` + `cursorPaginationSchema(item)` +
  `encodeCursor`/`decodeCursor` for cursor. ✅
