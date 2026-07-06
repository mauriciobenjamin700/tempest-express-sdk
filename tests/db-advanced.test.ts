import {
  AuditAction,
  BaseAuditLogModel,
  BaseModel,
  BaseOutboxModel,
  BaseRepository,
  BaseUserModel,
  OutboxRelay,
  OutboxStatus,
  TenantScopedRepository,
  column,
  createTestDatabase,
  diffSnapshots,
  snapshot,
  tableNameFor,
} from "@/index";
import { RecordNotFound } from "tempest-db-js";
import { describe, expect, it } from "vitest";

class UserModel extends BaseUserModel {
  static override tablename = tableNameFor("UserModel"); // "user"
  name = column.text().notNull();
}

class OrderModel extends BaseModel {
  static override tablename = tableNameFor("OrderModel"); // "order"
  tenantId = column.uuid().notNull();
  total = column.numeric(12, 2).notNull();
}

class OutboxModel extends BaseOutboxModel {
  static override tablename = "outbox";
}

class AuditLogModel extends BaseAuditLogModel {
  static override tablename = "audit_log";
}

const T1 = "11111111-1111-1111-1111-111111111111";
const T2 = "22222222-2222-2222-2222-222222222222";

describe("BaseUserModel", () => {
  it("ships email/hashedPassword/isAdmin/lastLoginAt plus base columns", async () => {
    const db = createTestDatabase([UserModel]);
    try {
      const repo = new BaseRepository(UserModel, db.session());
      const user = await repo.create({
        email: "ana@x.com",
        hashedPassword: "hash",
        name: "Ana",
        lastLoginAt: null,
      });
      expect(user.isAdmin).toBe(false);
      expect(user.lastLoginAt).toBeNull();
      expect(user.isActive).toBe(true);
    } finally {
      await db.close();
    }
  });
});

describe("snapshot + diffSnapshots", () => {
  it("captures fields and diffs before/after", () => {
    const before = snapshot({ id: "1", name: "Ana", role: () => "x" });
    expect(before).toEqual({ id: "1", name: "Ana" }); // function dropped
    const diff = diffSnapshots({ name: "Ana", age: 1 }, { name: "Ana Maria", age: 1 });
    expect(diff).toEqual({ name: { before: "Ana", after: "Ana Maria" } });
  });

  it("has the expected audit actions", () => {
    expect(AuditAction.CREATE).toBe("create");
  });
});

describe("BaseAuditLogModel", () => {
  it("persists an audit row with a JSON diff", async () => {
    const db = createTestDatabase([AuditLogModel]);
    try {
      const repo = new BaseRepository(AuditLogModel, db.session());
      const row = await repo.create({
        entity: "UserModel",
        entityId: "1",
        action: AuditAction.UPDATE,
        actor: "admin",
        changes: { name: { before: "A", after: "B" } },
        context: null,
      });
      const fetched = await repo.getById(row.id);
      expect(fetched.changes).toEqual({ name: { before: "A", after: "B" } });
    } finally {
      await db.close();
    }
  });
});

describe("TenantScopedRepository", () => {
  it("scopes reads and stamps writes by tenant", async () => {
    const db = createTestDatabase([OrderModel]);
    try {
      const t1 = new TenantScopedRepository(OrderModel, db.session(), T1);
      const t2 = new TenantScopedRepository(OrderModel, db.session(), T2);

      const order = await t1.create({ total: "10.00" });
      expect(order.tenantId).toBe(T1);

      expect(await t1.count()).toBe(1);
      expect(await t2.count()).toBe(0);
      expect(await t1.list()).toHaveLength(1);
      expect(await t2.list()).toHaveLength(0);

      // t2 cannot fetch t1's row by id
      await expect(t2.getById(order.id)).rejects.toBeInstanceOf(RecordNotFound);
      expect(await t1.getById(order.id)).toMatchObject({ tenantId: T1 });

      // t2 cannot delete t1's row
      expect(await t2.delete({ id: order.id })).toBe(0);
      expect(await t1.count()).toBe(1);
    } finally {
      await db.close();
    }
  });
});

describe("OutboxRelay", () => {
  it("publishes pending events and marks them sent", async () => {
    const db = createTestDatabase([OutboxModel]);
    try {
      const repo = new BaseRepository(OutboxModel, db.session());
      await repo.create({
        topic: "user.created",
        payload: { id: "1" },
        sentAt: null,
        lastError: null,
      });
      await repo.create({
        topic: "user.created",
        payload: { id: "2" },
        sentAt: null,
        lastError: null,
      });

      const published: string[] = [];
      const relay = new OutboxRelay(repo, async (topic, payload) => {
        published.push(`${topic}:${(payload as { id: string }).id}`);
      });

      const delivered = await relay.drainOnce();
      expect(delivered).toBe(2);
      expect(published.sort()).toEqual(["user.created:1", "user.created:2"]);
      expect(await repo.count({ status: OutboxStatus.SENT })).toBe(2);
      expect(await repo.count({ status: OutboxStatus.PENDING })).toBe(0);
    } finally {
      await db.close();
    }
  });

  it("retries a failing event and gives up after maxAttempts", async () => {
    const db = createTestDatabase([OutboxModel]);
    try {
      const repo = new BaseRepository(OutboxModel, db.session());
      const now = new Date("2026-07-06T00:00:00Z");
      await repo.create({
        topic: "t",
        payload: {},
        maxAttempts: 1,
        availableAt: now,
        sentAt: null,
        lastError: null,
      });

      const relay = new OutboxRelay(repo, async () => {
        throw new Error("broker down");
      });
      const delivered = await relay.drainOnce(now);
      expect(delivered).toBe(0);
      const rows = await repo.list();
      expect(rows[0]?.status).toBe(OutboxStatus.FAILED);
      expect(rows[0]?.attempts).toBe(1);
      expect(rows[0]?.lastError).toBe("broker down");
    } finally {
      await db.close();
    }
  });
});
