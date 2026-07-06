# Database (models + repositories)

This is the layer every Tempest service uses to talk to PostgreSQL (production)
or SQLite (development/tests) over **`tempest-db-js`** — the Node.js port of the
`tempest-fastapi-sdk` data layer. It exists so you never rewrite the same engine,
the same session-per-request, the same CRUD and the same pagination in every
project.

The SDK **re-exports** all of `tempest-db-js`, so you import everything from
`tempest-express-sdk` — models, columns, the engine and `BaseRepository` all come
from one place.

!!! info "Required peer dependency"
    `tempest-db-js` is a peer — install it alongside the SDK:
    ```bash
    npm install tempest-express-sdk tempest-db-js
    ```

There are four pieces, and you'll meet them one at a time:

| Piece | Symbol | For |
| --- | --- | --- |
| Base model | `BaseModel` | The four canonical columns (`id` / `isActive` / `createdAt` / `updatedAt`) declared for you. |
| Connection | `createEngine` | Async engine, pool, session per request and per transaction. |
| Repository | `BaseRepository<typeof Model>` | Typed CRUD, convention filters and offset pagination. |
| Migrations | `tempest-db` (CLI) | Reversible autogenerate + a drift gate in CI. |

!!! tip "How to read this page"
    It's progressive. Start with the model, connect the database, stand up a
    repository, learn the filters, then pagination, the full stack and
    migrations. Every code block is a complete file — copy, paste, run.

---

## 1. The base model

Every model in your service extends `BaseModel`, sets a static `tablename` and
declares **only** its domain columns. You get four columns without writing any:

```ts
// src/db/models/userModel.ts
import { BaseModel, column, tableNameFor } from "tempest-express-sdk";

/** Users table. */
export class UserModel extends BaseModel {
  static tablename = tableNameFor("UserModel"); // "user"
  name = column.text().notNull();
  email = column.varchar(320).notNull();
  passwordHash = column.text().notNull();
}
```

This creates the `user` table with **seven** columns: your three (`name`,
`email`, `passwordHash`) plus the four inherited from `BaseModel`:

| Column | TS type | Default | Role |
| --- | --- | --- | --- |
| `id` | `string` (UUID v4) | `sql.uuidv4()` on insert | Primary key, portable across Postgres/SQLite. |
| `isActive` | `boolean` | `true` | Fast soft-delete flag. |
| `createdAt` | `Date` | `sql.now()` on insert | Creation stamp. |
| `updatedAt` | `Date` | `sql.now()` + `onUpdate` | Last-write stamp. |

!!! info "Why is the table named `user` and not `UserModel`?"
    `tableNameFor` derives the name from the class: it drops the `Model` suffix
    and snake-cases the rest. `UserModel` → `user`, `OrderItemModel` →
    `order_item`. Same behavior as the automatic `__tablename__` in
    `tempest-fastapi-sdk`. You can always set `static tablename = "users"` by
    hand — the explicit declaration wins.

### The column factory

Each model field is a **column builder** from `tempest-db-js`. The SQL type maps
to the TS type the repository infers:

| Builder | SQL | TS type |
| --- | --- | --- |
| `column.integer()` / `column.smallInteger()` | `INTEGER` / `SMALLINT` | `number` |
| `column.bigInteger()` | `BIGINT` | `bigint` (64-bit precision) |
| `column.numeric(p, s)` / `column.decimal(p, s)` | `NUMERIC` | `string` (exact decimal, no float loss) |
| `column.real()` / `column.double()` | `REAL` / `DOUBLE` | `number` |
| `column.varchar(n)` / `column.string(n)` | `VARCHAR(n)` | `string` |
| `column.text()` | `TEXT` | `string` |
| `column.boolean()` | `BOOLEAN` | `boolean` |
| `column.date()` | `DATE` | `Date` |
| `column.datetime({ timezone })` / `column.timestamp()` | `TIMESTAMP` | `Date` |
| `column.json<T>()` / `column.jsonb<T>()` | `JSON` / `JSONB` | `T` |
| `column.uuid()` | `UUID` | `string` |
| `column.enum("a", "b")` | `ENUM` | `"a" \| "b"` (literal union) |
| `column.blob()` | `BLOB`/`BYTEA` | `Uint8Array` |

And the chainable modifiers:

```ts
export class ProductModel extends BaseModel {
  static tablename = tableNameFor("ProductModel"); // "product"

  sku = column.varchar(64).notNull();
  // .default(literal) for constants; .default(sql.now()) for a server-side expression
  status = column.enum("draft", "published").notNull().default("draft");
  price = column.numeric(12, 2).notNull(); // string, e.g. "19.90"
  metadata = column.jsonb<{ tags: string[] }>(); // nullable, typed
}
```

| Modifier | Effect |
| --- | --- |
| `.notNull()` | `NOT NULL` — the field becomes required on insert. |
| `.primaryKey()` | Primary key (rare: `BaseModel.id` already is the PK). |
| `.default(v)` | Insert default: a literal `T`, or an `sql` expression (`sql.now()`, `sql.uuidv4()`, `sql.currentDate()`, `sql.raw("...")`). |
| `.onUpdate(v)` | Re-applies a value on every UPDATE (this is what `updatedAt` uses with `sql.now()`). |

!!! tip "A column without `.notNull()` is nullable"
    Just like SQLAlchemy: a column is born nullable. The inferred type becomes
    `T | null` and it drops out of the required insert payload. Mark
    `.notNull()` only on what the domain requires.

**Recap:** extend `BaseModel`, set `tablename` with `tableNameFor`, declare your
domain columns with the `column` factory. The SDK gives you
id/timestamps/soft-delete and the static row type is inferred for free.

---

## 2. Connecting to the database

`createEngine` builds the async engine from a URL. Instantiate it **once** per
app and inject the session into the lower layers — never create an engine inside
a router.

```ts
// src/db/engine.ts
import { createEngine, loadSettings, databaseSettingsShape } from "tempest-express-sdk";

const settings = loadSettings(databaseSettingsShape);

/** The app's single engine. `DATABASE_URL` falls back to `sqlite://./app.db`. */
export const engine = createEngine(settings.DATABASE_URL, {
  // echo: true,  // echo SQL to stdout (dev)
});
```

The URL decides the backend: `postgresql://app@localhost/app` uses `postgres.js`
(lazy-loaded); `sqlite://./app.db` or `sqlite://:memory:` use the SQLite driver.
No substring tricks — the engine reads the dialect from the URL.

### A session per request

`engine.session()` hands you a session. **It does not commit on its own** — the
repository/service layer writes. The pattern is a middleware that opens a session
per request and stashes it in `res.locals`:

```ts
// src/api/middlewares/session.ts
import type { NextFunction, Request, Response } from "express";
import { engine } from "@/db/engine";

/** Attach a fresh DB session to every request. */
export function sessionMiddleware(_req: Request, res: Response, next: NextFunction): void {
  res.locals.session = engine.session();
  next();
}
```

```ts
// src/api/routers/users.ts
import { Router } from "express";
import { UserRepository } from "@/db/repositories/userRepository";

export function makeUsersRouter(): Router {
  const router = Router();

  router.get("/api/users/:id", async (req, res) => {
    const repository = new UserRepository(res.locals.session);
    const user = await repository.getById(req.params.id); // 404 via RecordNotFound
    res.json(user);
  });

  return router;
}
```

### Transactional writes

For an operation that must be atomic, use `engine.transaction` — it hands you a
session, commits on success and rolls back on error:

```ts
await engine.transaction(async (tx) => {
  const users = new UserRepository(tx);
  const orders = new OrderRepository(tx);
  const user = await users.create({ name: "Ana", email: "ana@x.com", passwordHash: "..." });
  await orders.create({ userId: user.id, total: "0.00" });
  // auto-commit on resolve; rollback on throw
});
```

### Health check and shutdown

```ts
// simple liveness + database probe
router.get("/health", async (_req, res) => {
  try {
    await engine.session().list?.(); // or a SELECT 1 via the query builder
    res.json({ status: "ok", database: true });
  } catch {
    res.status(503).json({ status: "degraded", database: false });
  }
});

// on graceful shutdown:
await engine.close();
```

!!! info "`await using` closes the pool for you"
    The engine implements `Symbol.asyncDispose`, so in a script you can write
    `await using engine = createEngine(url)` and the pool closes when the scope
    ends — no `try/finally`.

**Recap:** one `engine` per app, in `src/db/engine.ts`; `engine.session()` per
request (no implicit commit); `engine.transaction()` for atomic writes;
`engine.close()` on shutdown.

---

## 3. The repository

`BaseRepository<typeof Model>` is the heart of the layer. It encapsulates typed
CRUD, filters and pagination. There are two ways to use it.

### Direct mode — pure CRUD

When there's no custom query, instantiate it directly. **The constructor order is
`(model, session)`:**

```ts
import { BaseRepository } from "tempest-express-sdk";
import { UserModel } from "@/db/models/userModel";

const repository = new BaseRepository(UserModel, session);
const user = await repository.getById(userId);
```

### Subclass mode — the project pattern

Subclass to pin the model in the constructor and add domain queries. This is
exactly the file `tempest-express generate` produces:

```ts
// src/db/repositories/userRepository.ts
import { type AsyncSession, BaseRepository } from "tempest-express-sdk";
import { UserModel } from "@/db/models/userModel";

/** Data access for the user domain. */
export class UserRepository extends BaseRepository<typeof UserModel> {
  constructor(session: AsyncSession) {
    super(UserModel, session);
  }

  /** A domain query the base repo doesn't cover. */
  async getByEmail(email: string): Promise<InstanceType<typeof UserModel> | null> {
    return this.first({ email });
  }
}
```

!!! tip "You don't pass the session twice"
    The subclass constructor takes only the `AsyncSession` and forwards
    `UserModel` to `super`. Unlike `tempest-fastapi-sdk` (where the session
    comes first), the order here is `super(Model, session)`.

### The CRUD you get

Recall the project's collection convention: **single-record** lookups raise 404
(`RecordNotFound`); **collection** lookups return `[]`.

```ts
// Read — single record (throws RecordNotFound when absent → 404)
const user = await repository.getById(userId);

// Read — may not exist (null, no 404)
const maybe = await repository.getByIdOrNull(userId);
const first = await repository.first({ isActive: true });

// Read — collection (always [], never 404)
const users = await repository.list({ isActive: true });

// Existence / count
const taken = await repository.exists({ email: "a@b.com" });
const total = await repository.count({ isActive: true });

// Write
const created = await repository.create({
  name: "Ana",
  email: "ana@x.com",
  passwordHash: "...",
});
const many = await repository.createMany([
  { name: "A", email: "a@x.com", passwordHash: "..." },
  { name: "B", email: "b@x.com", passwordHash: "..." },
]);

// Update by filter — returns the number of affected rows
const n = await repository.update({ id: userId }, { name: "Ana Maria" });

// Delete by filter — returns the number of affected rows (hard delete)
const removed = await repository.delete({ id: userId });
```

!!! note "`update`/`delete` are by filter, not by instance"
    Unlike `tempest-fastapi-sdk` (which persists an attached instance), here
    `update({ id }, { ...fields })` and `delete({ id })` operate on a
    `WhereInput` filter and return the **count** of affected rows. The typical
    flow is: validate → `update({ id }, patch)` → `getById(id)` if you need the
    updated row back.

!!! tip "Soft-delete is an `update` on the `isActive` flag"
    There's no dedicated `softDelete` method (yet). Do
    `repository.update({ id }, { isActive: false })` to deactivate and
    `{ isActive: true }` to restore. For a temporal stamp (`deletedAt`), see
    [section 6](#6-opt-in-columns-soft-delete-and-auditing).

**Recap:** instantiate directly for pure CRUD, subclass to pin the model + add
queries. 404 only in `getById`; collections return `[]`. `update`/`delete` take a
filter and return a count.

---

## 4. Convention filters

`list`, `first`, `exists`, `count`, `update`, `delete` and `paginate` take a
**fully-typed** `WhereInput`: each key must be a real column, and the value
accepts either the raw value (shorthand for `eq`) or an operator object valid for
**that column's type**. A `like` on a `number` field, or `gt` on a `string`, is a
compile error.

```ts
// Equality (shorthand): { col: value }
await repository.list({ isActive: true, email: "a@b.com" });

// Per-column operator object
await repository.list({
  name: { ilike: "%ana%" },          // string → like/ilike (case-insensitive)
  id: { in: [id1, id2, id3] },       // any type → in / notIn
  createdAt: { gte: start, lt: end }, // Date/number/bigint → gt/gte/lt/lte/between
  metadata: { isNull: false },       // any type → isNull (IS NOT NULL)
});
```

Operators available per column type:

| Column type | Operators |
| --- | --- |
| Any | `eq`, `ne`, `in`, `notIn`, `isNull` |
| `string` | + `like`, `ilike` |
| `number` / `bigint` / `Date` | + `gt`, `gte`, `lt`, `lte`, `between` (inclusive `[lo, hi]`) |
| `boolean` | (only the any-type ones) |

```ts
// "active, updated after the watermark" — timestamp precision
const changed = await repository.list({
  isActive: true,
  updatedAt: { gt: watermark },
});

// "created in the range" — inclusive BETWEEN
const report = await repository.list({ createdAt: { between: [start, end] } });

// text search + membership in a set
const hits = await repository.list({ name: { ilike: "%silva%" }, id: { in: selectedIds } });
```

!!! tip "Filters come from a schema, not loose strings"
    In practice you don't build this object by hand. `paginationFilterSchema`
    (and its `.extend` variants) validate the query string and `getConditions`
    returns only the domain filters, without the pagination keys — ready to hand
    to the repository.

**Recap:** a typed object, operators restricted to the column type, checked at
compile time. Raw value = `eq`; object = operators.

---

## 5. Pagination

`BaseRepository.paginate` does **offset pagination** built in — you almost never
write the query by hand:

```ts
const page = await repository.paginate({
  page: 1,
  pageSize: 20,
  orderBy: "createdAt",
  ascending: false,
  filters: { isActive: true },
});
// → { items: UserModel[], total, page, pageSize, pages }
```

`total` is computed from the **same** filtered query, so the count always matches
`items`. The envelope has `items` / `total` / `page` / `pageSize` / `pages` — the
same shape `paginationSchema` validates for the HTTP response.

In a router, the filter comes from a schema via the query string:

```ts
// src/api/routers/users.ts
import { Router } from "express";
import {
  getConditions,
  getPaginationConditions,
  paginationFilterSchema,
} from "tempest-express-sdk";
import { UserRepository } from "@/db/repositories/userRepository";

const userFilterSchema = paginationFilterSchema.extend({
  name: paginationFilterSchema.shape.orderBy, // optional string → ilike by convention
});

router.get("/api/users", async (req, res) => {
  const filter = userFilterSchema.parse(req.query);
  const repository = new UserRepository(res.locals.session);
  const page = await repository.paginate({
    ...getPaginationConditions(filter), // { page, pageSize, orderBy, ascending }
    filters: getConditions(filter),      // domain filters only
  });
  res.json(page);
});
```

!!! info "Cursor pagination: schema helpers ready to go"
    For feeds/large tables, the SDK ships `cursorPaginationFilterSchema`,
    `cursorPaginationSchema`, `encodeCursor` and `decodeCursor`. Today
    `BaseRepository` implements offset only; you build the cursor mode with those
    helpers + a `list({ id: { gt: lastId } })` query ordered by `(orderBy, id)`.
    The cursor is an opaque url-safe base64 JSON — the client returns
    `nextCursor` verbatim until it becomes `null`.

**Recap:** `paginate` (offset) already returns `items` + metadata; the
`getPaginationConditions` / `getConditions` pair splits pagination from domain
filters without renaming anything.

---

## 6. Opt-in columns: soft-delete and auditing

TypeScript has no multiple inheritance, so the `tempest-fastapi-sdk` "mixins"
become **column-builder factories** you assign as fields — only when the domain
asks for them:

| Factory | Column | For |
| --- | --- | --- |
| `deletedAtColumn()` | `deletedAt` (`Date`, nullable) | Temporal soft-delete (when, not just whether). |
| `createdByColumn()` | `createdBy` (`UUID`, nullable) | Who created the row. |
| `updatedByColumn()` | `updatedBy` (`UUID`, nullable) | Who made the last write. |

```ts
// src/db/models/userModel.ts
import {
  BaseModel,
  column,
  createdByColumn,
  deletedAtColumn,
  tableNameFor,
  updatedByColumn,
} from "tempest-express-sdk";

/** Users — soft-deletable and audited. */
export class UserModel extends BaseModel {
  static tablename = tableNameFor("UserModel"); // "user"

  name = column.text().notNull();
  email = column.varchar(320).notNull();
  passwordHash = column.text().notNull();

  // opt-in
  deletedAt = deletedAtColumn();
  createdBy = createdByColumn();
  updatedBy = updatedByColumn();
}
```

Filtering is the caller's responsibility — the columns do **not** install a
global filter. Hide soft-deleted rows by passing
`{ deletedAt: { isNull: true } }`; stamp the audit in the service, where the
current user is in scope:

```ts
// hide soft-deleted
const alive = await repository.list({ deletedAt: { isNull: true } });

// temporal soft-delete (in the service, with the actor in scope)
await repository.update({ id: userId }, { deletedAt: new Date(), updatedBy: actorId });

// restore
await repository.update({ id: userId }, { deletedAt: null });
```

!!! tip "Two delete stamps, different purposes"
    Use `isActive: false` (the `BaseModel` flag) when the boolean is enough. Use
    `deletedAt` when you need to know **when** the delete happened — auditing,
    retention policies.

**Recap:** opt-in columns enter only when the domain needs them; soft-delete
filtering is yours (`{ deletedAt: { isNull: true } }`); the audit stamp lives in
the service.

---

## 7. The full stack (repository → service → controller)

The repository CRUD returns **raw ORM rows**. The layers above exist to map the
row to the response DTO and to orchestrate. `tempest-express generate User`
generates the whole slice; here's what each file holds.

`BaseService` wraps a repository and maps every read through `mapToResponse`:

```ts
// src/services/userService.ts
import { BaseService } from "tempest-express-sdk";
import type { UserModel } from "@/db/models/userModel";
import type { UserRepository } from "@/db/repositories/userRepository";
import type { UserResponse } from "@/schemas/user";

/** Business logic for the user domain. */
export class UserService extends BaseService<typeof UserModel, UserResponse> {
  constructor(repository: UserRepository) {
    super(repository, (row) => ({
      id: row.id,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      name: row.name,
      email: row.email,
    }));
  }
}
```

`BaseController` is the orchestration boundary — thin by default, overridden when
one endpoint calls several services:

```ts
// src/controllers/userController.ts
import { BaseController } from "tempest-express-sdk";
import type { UserModel } from "@/db/models/userModel";
import type { UserResponse } from "@/schemas/user";
import type { UserService } from "@/services/userService";

/** Orchestration boundary for the user domain. */
export class UserController extends BaseController<typeof UserModel, UserResponse> {
  constructor(service: UserService) {
    super(service);
  }
}
```

And the router composes the stack per request from the session in `res.locals`:

```ts
// src/api/routers/users.ts
import { Router } from "express";
import { UserController } from "@/controllers/userController";
import { UserRepository } from "@/db/repositories/userRepository";
import { UserService } from "@/services/userService";
import { userCreateSchema } from "@/schemas/user";

export function makeUsersRouter(): Router {
  const router = Router();

  const controllerFor = (res: import("express").Response) =>
    new UserController(new UserService(new UserRepository(res.locals.session)));

  router.get("/api/users", async (_req, res) => {
    res.json(await controllerFor(res).list());
  });

  router.get("/api/users/:id", async (req, res) => {
    res.json(await controllerFor(res).getById(req.params.id)); // 404 via RecordNotFound
  });

  router.post("/api/users", async (req, res) => {
    const data = userCreateSchema.parse(req.body); // ZodError → 422
    res.status(201).json(await controllerFor(res).create(data));
  });

  return router;
}
```

!!! tip "Let the generator write this"
    `npx tempest-express generate User` creates `userModel.ts`, `user.ts`
    (schemas), `userRepository.ts`, `userService.ts`, `userController.ts` and
    `users.ts` (router) in one shot — the whole vertical slice, ready to edit.

**Recap:** the repository returns a raw row; `BaseService` maps it to the DTO;
`BaseController` is the orchestration boundary; the router composes
`Repository → Service → Controller` per request from the session.

---

## 8. Migrations

`tempest-db-js` ships an Alembic-style CLI (`tempest-db`) with reversible
autogenerate. You declare a config file pointing at the driver, the dialect and
the models; the CLI does the rest.

```ts
// tempest-db.config.mjs
import { NodeSqliteDriver } from "tempest-db-js";
import { defineMigrationConfig } from "tempest-db-js/migrations";
import { migrations } from "./src/db/migrations/index.js";
import { UserModel } from "./src/db/models/userModel.js";
import { ProductModel } from "./src/db/models/productModel.js";

export default defineMigrationConfig({
  driver: NodeSqliteDriver.open("app.db"),
  dialect: "sqlite",
  migrations,
  models: [UserModel, ProductModel], // the autogenerate source of truth
});
```

Full workflow:

```bash
# 1. Generate a revision from the models ↔ schema diff
npx tempest-db revision -m "add users table" --autogenerate

# 2. Apply pending revisions
npx tempest-db upgrade

# 3. Inspect
npx tempest-db current     # current revision
npx tempest-db history     # all revisions
npx tempest-db heads       # pending heads
```

`--autogenerate` diffs the **replayed schema** (the applied migrations) against
the **reflected models**, emitting typed `up()`/`down()` — never a raw `.sql`
blob. Every operation (`create_table`, `add_column`, `alter_column`, …) has a
known inverse, so the `down()` comes out reversible for free.

### CI gate — the schema must match the models

```bash
# fails (exit != 0) if the models diverge from the applied migrations
npx tempest-db check
```

```yaml
# .github/workflows/ci.yml
- name: Check migrations are in sync
  run: npx tempest-db check
```

!!! warning "Postgres vs SQLite"
    The driver and dialect come from the config. For Postgres production, swap
    `NodeSqliteDriver.open(...)` for the Postgres driver and `dialect: "postgres"`.
    The drift `check` works on both (`checkDrift` / `checkDriftPostgres`).

!!! info "Dev without migrations"
    For a quick dev/test without a migration CI, the engine can create tables
    from the reflected models. Migrations are for when the schema must evolve
    safely in production — don't skip them on databases with data.

**Recap:** a `tempest-db.config.mjs` points at driver + dialect + models;
`revision --autogenerate` per change, `upgrade` to apply, `check` in CI.

---

## Next steps

You now model tables with `BaseModel`, connect with `createEngine`, stand up a
typed `BaseRepository`, filter by convention, paginate and migrate. Continue in:

- [Authentication (JWT)](auth.md) — a `UserStore` over your repository.
- [Admin (JSON API)](admin.md) — administrative CRUD auto-derived from the models.
- [Cache, queue and tasks](jobs.md) — the async layers around the database.

This is the same design as [`tempest-fastapi-sdk`](https://mauriciobenjamin700.github.io/tempest-fastapi-sdk/recipes/database/)
— declarative models, typed repository, built-in pagination and autogenerated
migrations — ported faithfully to Node.js. ✅
