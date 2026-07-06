/**
 * In-memory test-database helpers, mirroring `testing.database`.
 *
 * Stand up a fully-wired `tempest-db-js` engine over an in-memory SQLite
 * database whose schema is created directly from your models — no migration
 * files, no temp files, no external service. One shared connection backs both
 * the DDL and every session, so repositories see the tables you declared.
 *
 * The helpers are framework-agnostic (no `vitest`/`jest` import), so wrap them
 * in whatever harness the consuming project uses.
 */

import {
  type AsyncDriver,
  AsyncEngine,
  type AsyncSession,
  type ModelClass,
  NodeSqliteDriver,
} from "tempest-db-js";
import { reflectTable, renderOperation } from "tempest-db-js/migrations";

/** A disposable in-memory test database. */
export interface TestDatabase {
  /** The wired async engine — hand its sessions to repositories. */
  readonly engine: AsyncEngine;
  /** Open a fresh session on the shared in-memory connection. */
  session(): AsyncSession;
  /** Dispose the engine and drop the in-memory database. */
  close(): Promise<void>;
}

/**
 * Create an in-memory SQLite test database with tables reflected from `models`.
 *
 * @param models - The model classes whose tables should be created.
 * @returns A {@link TestDatabase} — remember to `await close()` in teardown.
 *
 * @example
 * ```ts
 * const db = createTestDatabase([UserModel]);
 * const repo = new UserRepository(db.session());
 * await repo.create({ name: "Ana", email: "ana@x.com", passwordHash: "..." });
 * await db.close();
 * ```
 */
export function createTestDatabase(models: readonly ModelClass[]): TestDatabase {
  const driver = NodeSqliteDriver.open(":memory:");
  for (const model of models) {
    const table = reflectTable(model);
    for (const statement of renderOperation({ kind: "create_table", table }, "sqlite")) {
      driver.execute(statement, []);
    }
  }
  // Wrap the single sync SQLite connection as an async driver so `AsyncEngine`
  // (and therefore `BaseRepository`) runs against the very connection that owns
  // the freshly-created tables.
  const asyncDriver: AsyncDriver = {
    execute: (sql, params) => Promise.resolve(driver.execute(sql, params)),
    close: () => {
      driver.close();
      return Promise.resolve();
    },
  };
  const engine = new AsyncEngine(asyncDriver, "sqlite");
  return {
    engine,
    session: () => engine.session(),
    close: () => engine.close(),
  };
}

/**
 * Run `fn` against a fresh in-memory test database, disposing it afterwards even
 * if `fn` throws.
 *
 * @param models - The model classes whose tables should be created.
 * @param fn - Receives the {@link TestDatabase} and returns a promise.
 * @returns Whatever `fn` resolves to.
 *
 * @example
 * ```ts
 * await withTestDatabase([UserModel], async (db) => {
 *   const repo = new UserRepository(db.session());
 *   expect(await repo.count()).toBe(0);
 * });
 * ```
 */
export async function withTestDatabase<T>(
  models: readonly ModelClass[],
  fn: (db: TestDatabase) => Promise<T>,
): Promise<T> {
  const db = createTestDatabase(models);
  try {
    return await fn(db);
  } finally {
    await db.close();
  }
}
