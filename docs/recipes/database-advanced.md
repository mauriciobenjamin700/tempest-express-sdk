# Banco de dados avançado

Sobre o [guia base de banco](database.md), o SDK traz quatro peças opcionais
para domínios mais exigentes — porte fiel de `db.tenant` / `db.audit` /
`db.outbox` / `db.user_model` do `tempest-fastapi-sdk`.

!!! note "Colunas anuláveis são obrigatórias no insert"
    No `tempest-db-js`, uma coluna sem `.notNull()` **e** sem `.default(...)` é
    obrigatória no `create` — você passa `null` explicitamente. É por isso que os
    exemplos abaixo passam `lastLoginAt: null`, `context: null` etc.

---

## 1. Multi-tenant sem vazamento

`TenantScopedRepository` amarra um `tenantId` na construção e o injeta em **toda**
leitura e escrita — impossível esquecer um `WHERE tenant_id = ?`.

```ts
import { BaseModel, TenantScopedRepository, column, tableNameFor } from "tempest-express-sdk";

class OrderModel extends BaseModel {
  static tablename = tableNameFor("OrderModel"); // "order"
  tenantId = column.uuid().notNull();
  total = column.numeric(12, 2).notNull();
}

const repo = new TenantScopedRepository(OrderModel, session, currentTenantId);

await repo.list();                    // WHERE tenant_id = currentTenantId
await repo.create({ total: "10.00" }); // tenant_id carimbado (não passe você)
await repo.getById(otherTenantOrderId); // lança RecordNotFound entre tenants
```

Reads (`list`/`first`/`count`/`exists`/`getById`/`paginate`) filtram pelo tenant;
`create`/`createMany` carimbam o tenant; `update`/`delete` só atingem linhas do
tenant, e `update` nunca move uma linha para outro tenant. Campo custom:
`new TenantScopedRepository<typeof M, "orgId">(M, session, id, "orgId")`.

---

## 2. Outbox transacional

Grave a mudança de domínio **e** o evento a publicar na mesma transação (numa
tabela `BaseOutboxModel`). O evento nunca se perde, mesmo se o broker estiver
fora. O `OutboxRelay` faz o polling e publica com entrega ao-menos-uma-vez.

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

// dentro da transação da escrita de domínio:
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

// em um worker de fundo:
const relay = new OutboxRelay(
  new BaseRepository(OutboxModel, engine.session()),
  async (topic, payload) => broker.publish(topic, payload), // seu broker
);
await relay.run(1000); // drena a cada 1s; relay.stop() encerra
```

Falhas incrementam `attempts` e reagendam com backoff (`availableAt`); após
`maxAttempts` a linha vira `failed` com o `lastError`.

---

## 3. Trilha de auditoria

`BaseAuditLogModel` é um log append-only de quem mudou o quê. `snapshot` congela
uma linha e `diffSnapshots` calcula o diff antes/depois — o que o service grava.

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

// no service, ao atualizar um usuário:
const before = snapshot(user, ["hashedPassword"]); // exclui campos sensíveis
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

## 4. Modelos base de usuário e token

Pontos de partida opcionais que já trazem as colunas comuns. Estenda, fixe
`tablename`, adicione o que faltar:

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

`UserTokenPurpose` traz os valores canônicos (`ACTIVATION`, `PASSWORD_RESET`,
`EMAIL_VERIFICATION`, `EMAIL_CHANGE`). Guarde sempre o **hash** do token.

---

## 5. Log de queries lentas

O `tempest-db-js` expõe SQL+params no `onQuery`, mas **sem duração** — então o
timing acontece na camada do driver. `wrapWithSlowQueryLog` embrulha um
`AsyncDriver` e loga cada statement que passar de um limiar (inclusive dentro de
transações):

```ts
import { AsyncEngine, NodeSqliteDriver, wrapWithSlowQueryLog } from "tempest-express-sdk";

const sync = NodeSqliteDriver.open("app.db");
const timed = wrapWithSlowQueryLog(
  { execute: (s, p) => Promise.resolve(sync.execute(s, p)), close: async () => sync.close() },
  { thresholdMs: 200 }, // logParameters só em dev (pode conter PII)
);
const engine = new AsyncEngine(timed, "sqlite");
```

!!! note "Aplica-se a engines construídos por você"
    `createEngine` ainda não expõe injeção de driver, então o wrap vale quando
    você constrói o `AsyncEngine` a partir de um driver (SQLite, ou o mesmo
    padrão dos [testes](testing.md)). Um hook de timing no `createEngine` é
    upstream.

## 6. Backup do banco

`backupDatabase` detecta o dialeto pela URL: `pg_dump` no Postgres (precisa do
binário no `PATH`), cópia de arquivo no SQLite.

```ts
import { backupDatabase } from "tempest-express-sdk";

await backupDatabase("sqlite://./app.db", "./backups/app-2026-07-06.db");
await backupDatabase(
  "postgresql://app@localhost/app",
  "./backups/app.dump",
  { pgDumpArgs: ["-Fc", "--no-owner"] },
);
```

SQLite em memória lança erro (nada a copiar).

## Recapitulando

- `TenantScopedRepository` — isolamento por tenant à prova de esquecimento.
- `BaseOutboxModel` + `OutboxRelay` — eventos publicados atomicamente com a escrita.
- `BaseAuditLogModel` + `snapshot`/`diffSnapshots` — quem mudou o quê.
- `BaseUserModel` / `BaseUserTokenModel` / `BaseUserRefreshTokenModel` — modelos base opt-in.
- `wrapWithSlowQueryLog` — loga queries lentas; `backupDatabase` — backup por dialeto. ✅
