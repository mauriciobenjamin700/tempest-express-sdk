# Advanced database

On top of the [base database guide](database.md), the SDK ships four opt-in
pieces for more demanding domains — a faithful port of `db.tenant` / `db.audit`
/ `db.outbox` / `db.user_model` from `tempest-fastapi-sdk`.

!!! note "Nullable columns are required on insert"
    In `tempest-db-js`, a column without `.notNull()` **and** without
    `.default(...)` is required on `create` — you pass `null` explicitly. That's
    why the examples below pass `lastLoginAt: null`, `context: null`, etc.

---

## 1. Multi-tenant without leaks

`TenantScopedRepository` binds a `tenantId` at construction and injects it into
**every** read and write — you can't forget a `WHERE tenant_id = ?`.

```ts
import { BaseModel, TenantScopedRepository, column, tableNameFor } from "tempest-express-sdk";

class OrderModel extends BaseModel {
  static tablename = tableNameFor("OrderModel"); // "order"
  tenantId = column.uuid().notNull();
  total = column.numeric(12, 2).notNull();
}

const repo = new TenantScopedRepository(OrderModel, session, currentTenantId);

await repo.list();                    // WHERE tenant_id = currentTenantId
await repo.create({ total: "10.00" }); // tenant_id stamped (don't pass it)
await repo.getById(otherTenantOrderId); // throws RecordNotFound across tenants
```

Reads (`list`/`first`/`count`/`exists`/`getById`/`paginate`) filter by tenant;
`create`/`createMany` stamp it; `update`/`delete` only touch the tenant's rows,
and `update` never moves a row to another tenant. Custom field:
`new TenantScopedRepository<typeof M, "orgId">(M, session, id, "orgId")`.

---

## 2. Transactional outbox

Write the domain change **and** the event to publish in the same transaction
(into a `BaseOutboxModel` table). The event is never lost, even if the broker is
down. `OutboxRelay` polls and publishes with at-least-once delivery.

```ts
import {
  BaseOutboxModel,
  BaseRepository,
  OutboxRelay,
  createEngine,
} from "tempest-express-sdk";

class OutboxModel extends BaseOutboxModel {
  static tablename = "outbox";
}

// inside the domain write's transaction:
await engine.transaction(async (tx) => {
  const orders = new OrderRepository(tx);
  const outbox = new BaseRepository(OutboxModel, tx);
  const order = await orders.create({ tenantId, total: "10.00" });
  await outbox.create({
    topic: "order.created",
    payload: { id: order.id },
    sentAt: null,
    lastError: null,
  });
});

// in a background worker:
const relay = new OutboxRelay(
  new BaseRepository(OutboxModel, engine.session()),
  async (topic, payload) => broker.publish(topic, payload), // your broker
);
await relay.run(1000); // drains every 1s; relay.stop() ends it
```

Failures increment `attempts` and reschedule with backoff (`availableAt`); after
`maxAttempts` the row becomes `failed` with the `lastError`.

---

## 3. Audit trail

`BaseAuditLogModel` is an append-only log of who changed what. `snapshot` freezes
a row and `diffSnapshots` computes the before/after diff — what the service
writes.

```ts
import {
  AuditAction,
  BaseAuditLogModel,
  BaseRepository,
  diffSnapshots,
  snapshot,
} from "tempest-express-sdk";

class AuditLogModel extends BaseAuditLogModel {
  static tablename = "audit_log";
}

// in the service, when updating a user:
const before = snapshot(user, ["hashedPassword"]); // exclude sensitive fields
await users.update({ id: user.id }, { name: "Ana Maria" });
const after = snapshot(await users.getById(user.id), ["hashedPassword"]);

await new BaseRepository(AuditLogModel, session).create({
  entity: "UserModel",
  entityId: user.id,
  action: AuditAction.UPDATE,
  actor: actorId,
  changes: diffSnapshots(before, after), // { name: { before, after } }
  context: { requestId },
});
```

---

## 4. Base user and token models

Opt-in starting points that already carry the common columns. Extend, set
`tablename`, add the rest:

```ts
import {
  BaseUserModel,
  BaseUserRefreshTokenModel,
  BaseUserTokenModel,
  UserTokenPurpose,
  column,
  tableNameFor,
} from "tempest-express-sdk";

class UserModel extends BaseUserModel {
  static tablename = tableNameFor("UserModel"); // "user"
  name = column.text().notNull();
}
// BaseUserModel: email, hashedPassword, isAdmin, lastLoginAt

class UserTokenModel extends BaseUserTokenModel {
  static tablename = "user_token";
}
// BaseUserTokenModel: userId, tokenHash, purpose, expiresAt, usedAt, payload

class RefreshTokenModel extends BaseUserRefreshTokenModel {
  static tablename = "refresh_token";
}
// BaseUserRefreshTokenModel: userId, tokenHash, familyId, expiresAt, usedAt, revokedAt
```

`UserTokenPurpose` carries the canonical values (`ACTIVATION`, `PASSWORD_RESET`,
`EMAIL_VERIFICATION`, `EMAIL_CHANGE`). Always store the token **hash**.

---

## Recap

- `TenantScopedRepository` — forget-proof per-tenant isolation.
- `BaseOutboxModel` + `OutboxRelay` — events published atomically with the write.
- `BaseAuditLogModel` + `snapshot`/`diffSnapshots` — who changed what.
- `BaseUserModel` / `BaseUserTokenModel` / `BaseUserRefreshTokenModel` — opt-in base models. ✅
