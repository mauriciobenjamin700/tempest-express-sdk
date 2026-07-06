import {
  BaseModel,
  BaseRepository,
  column,
  createTestDatabase,
  tableNameFor,
  withTestDatabase,
} from "@/index";
import { describe, expect, it } from "vitest";

class WidgetModel extends BaseModel {
  static override tablename = tableNameFor("WidgetModel"); // "widget"
  name = column.text().notNull();
  qty = column.integer().notNull().default(0);
}

describe("createTestDatabase", () => {
  it("creates tables from models and backs a working repository", async () => {
    const db = createTestDatabase([WidgetModel]);
    try {
      const repo = new BaseRepository(WidgetModel, db.session());
      expect(await repo.count()).toBe(0);

      const created = await repo.create({ name: "Alpha", qty: 3 });
      expect(created.id).toBeTruthy();
      expect(created.isActive).toBe(true);
      expect(created.name).toBe("Alpha");

      const all = await repo.list();
      expect(all).toHaveLength(1);
      expect(await repo.getById(created.id)).toMatchObject({ name: "Alpha", qty: 3 });
    } finally {
      await db.close();
    }
  });

  it("isolates databases across calls", async () => {
    const a = createTestDatabase([WidgetModel]);
    const b = createTestDatabase([WidgetModel]);
    try {
      await new BaseRepository(WidgetModel, a.session()).create({
        name: "only-in-a",
        qty: 1,
      });
      expect(await new BaseRepository(WidgetModel, b.session()).count()).toBe(0);
    } finally {
      await a.close();
      await b.close();
    }
  });
});

describe("withTestDatabase", () => {
  it("disposes even when the body throws", async () => {
    let closedSeen = false;
    await expect(
      withTestDatabase([WidgetModel], async (db) => {
        // If close() runs, a subsequent query on the closed engine would throw.
        db.engine.close = (async () => {
          closedSeen = true;
        }) as typeof db.engine.close;
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(closedSeen).toBe(true);
  });

  it("returns the body result", async () => {
    const n = await withTestDatabase([WidgetModel], async (db) => {
      const repo = new BaseRepository(WidgetModel, db.session());
      await repo.create({ name: "x", qty: 0 });
      return repo.count();
    });
    expect(n).toBe(1);
  });
});
