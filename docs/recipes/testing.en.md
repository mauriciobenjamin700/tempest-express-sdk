# Testing (in-memory database)

Testing the data layer shouldn't need a running Postgres, temp files or
migrations. `createTestDatabase` stands up a full `tempest-db-js` engine over
**in-memory SQLite**, with the schema created straight from your models — one
connection backs both the DDL and every session, so repositories see the tables
you declared.

It's the port of the `tempest-fastapi-sdk` `testing` module, and it's
**framework-agnostic** (no `vitest`/`jest` import) — use it with any harness.

---

## 1. A repository test

```ts
import { BaseRepository, createTestDatabase } from "tempest-express-sdk";
import { UserModel } from "@/db/models/userModel";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("UserRepository", () => {
  let db: ReturnType<typeof createTestDatabase>;

  beforeEach(() => {
    db = createTestDatabase([UserModel]); // creates the `user` table
  });
  afterEach(() => db.close());

  it("creates and fetches a user", async () => {
    const repo = new BaseRepository(UserModel, db.session());
    const user = await repo.create({
      name: "Ana",
      email: "ana@x.com",
      passwordHash: "...",
    });
    expect(user.id).toBeTruthy();       // generated UUID
    expect(user.isActive).toBe(true);   // BaseModel default
    expect(await repo.count()).toBe(1);
  });
});
```

`createTestDatabase(models)` returns `{ engine, session(), close() }`. Pass
`db.session()` to the repository (or service/controller) exactly as in
production. Every call creates an **isolated** database — tests don't leak state.

!!! tip "Pass every model the test touches"
    The models array is what becomes `CREATE TABLE`. If a repository queries a
    related table, include its model too.

---

## 2. Automatic scoping with `withTestDatabase`

When you want the database only for a block — and guaranteed `close()` even if
the body throws — use the wrapper:

```ts
import { BaseRepository, withTestDatabase } from "tempest-express-sdk";
import { UserModel } from "@/db/models/userModel";

it("lists empty when there are no rows", async () => {
  await withTestDatabase([UserModel], async (db) => {
    const repo = new BaseRepository(UserModel, db.session());
    expect(await repo.list()).toEqual([]);
  });
});
```

It creates the database, runs the function and `close()`s in `finally` —
returning whatever the function returns.

---

## 3. Testing a service/controller

The whole stack runs on the same `db.session()`:

```ts
import { createTestDatabase } from "tempest-express-sdk";
import { UserController } from "@/controllers/userController";
import { UserRepository } from "@/db/repositories/userRepository";
import { UserService } from "@/services/userService";
import { UserModel } from "@/db/models/userModel";

it("maps the row to the response DTO", async () => {
  const db = createTestDatabase([UserModel]);
  try {
    const controller = new UserController(
      new UserService(new UserRepository(db.session())),
    );
    const created = await controller.create({
      name: "Ana",
      email: "ana@x.com",
      passwordHash: "...",
    });
    expect(created).toMatchObject({ name: "Ana", isActive: true });
  } finally {
    await db.close();
  }
});
```

---

## Recap

- `createTestDatabase(models)` → in-memory SQLite engine with the models' tables;
  `session()` for repositories, `close()` on teardown.
- `withTestDatabase(models, fn)` scopes the database to a block and always closes.
- Isolated per call, zero external dependency, harness-agnostic. ✅
