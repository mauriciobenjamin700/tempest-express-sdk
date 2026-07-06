# Banco de dados (models + repositories)

Esta é a camada que toda service Tempest usa para falar com PostgreSQL
(produção) ou SQLite (desenvolvimento/testes) sobre o **`tempest-db-js`** — o
porte Node.js da camada de dados do `tempest-fastapi-sdk`. Ela existe para que
você nunca reescreva a mesma engine, a mesma sessão por request, o mesmo CRUD e
a mesma paginação em cada projeto.

O SDK **re-exporta** todo o `tempest-db-js`, então você importa tudo de
`tempest-express-sdk` — models, colunas, engine e `BaseRepository` vêm de um
lugar só.

!!! info "Peer dependency obrigatória"
    `tempest-db-js` é um peer — instale junto com o SDK:
    ```bash
    npm install tempest-express-sdk tempest-db-js
    ```

São quatro peças, e você vai conhecê-las uma de cada vez:

| Peça | Símbolo | Para quê |
| --- | --- | --- |
| Modelo base | `BaseModel` | As quatro colunas canônicas (`id` / `isActive` / `createdAt` / `updatedAt`) declaradas para você. |
| Conexão | `createEngine` | Engine assíncrona, pool, sessão por request e por transação. |
| Repository | `BaseRepository<typeof Model>` | CRUD tipado, filtros por convenção e paginação offset. |
| Migrações | `tempest-db` (CLI) | Autogenerate reversível + gate de drift no CI. |

!!! tip "Como ler esta página"
    Ela é progressiva. Comece pelo modelo, conecte o banco, suba um
    repository, aprenda os filtros, então paginação, a pilha completa e as
    migrações. Cada bloco de código é um arquivo completo — copie, cole, rode.

---

## 1. O modelo base

Todo modelo da sua service estende `BaseModel`, fixa um `tablename` estático e
declara **só** as colunas do domínio. Você ganha quatro colunas sem escrever
nenhuma:

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

Isso cria a tabela `user` com **sete** colunas: as três suas (`name`, `email`,
`passwordHash`) mais as quatro herdadas de `BaseModel`:

| Coluna | Tipo TS | Padrão | Papel |
| --- | --- | --- | --- |
| `id` | `string` (UUID v4) | `sql.uuidv4()` no insert | Chave primária, portável entre Postgres/SQLite. |
| `isActive` | `boolean` | `true` | Flag de soft-delete rápido. |
| `createdAt` | `Date` | `sql.now()` no insert | Carimbo de criação. |
| `updatedAt` | `Date` | `sql.now()` + `onUpdate` | Carimbo da última escrita. |

!!! info "Por que o nome da tabela é `user` e não `UserModel`?"
    `tableNameFor` deriva o nome da classe: tira o sufixo `Model` e converte
    para `snake_case`. `UserModel` → `user`, `OrderItemModel` → `order_item`.
    É o mesmo comportamento do `__tablename__` automático do
    `tempest-fastapi-sdk`. Você sempre pode fixar `static tablename = "users"`
    à mão — a declaração explícita vence.

### O column factory

Cada campo do model é um **column builder** de `tempest-db-js`. O tipo SQL vira o
tipo TS que o repository infere:

| Builder | SQL | Tipo TS |
| --- | --- | --- |
| `column.integer()` / `column.smallInteger()` | `INTEGER` / `SMALLINT` | `number` |
| `column.bigInteger()` | `BIGINT` | `bigint` (precisão 64-bit) |
| `column.numeric(p, s)` / `column.decimal(p, s)` | `NUMERIC` | `string` (decimal exato, sem perda de float) |
| `column.real()` / `column.double()` | `REAL` / `DOUBLE` | `number` |
| `column.varchar(n)` / `column.string(n)` | `VARCHAR(n)` | `string` |
| `column.text()` | `TEXT` | `string` |
| `column.boolean()` | `BOOLEAN` | `boolean` |
| `column.date()` | `DATE` | `Date` |
| `column.datetime({ timezone })` / `column.timestamp()` | `TIMESTAMP` | `Date` |
| `column.json<T>()` / `column.jsonb<T>()` | `JSON` / `JSONB` | `T` |
| `column.uuid()` | `UUID` | `string` |
| `column.enum("a", "b")` | `ENUM` | `"a" \| "b"` (union literal) |
| `column.blob()` | `BLOB`/`BYTEA` | `Uint8Array` |

E os modificadores encadeáveis:

```ts
export class ProductModel extends BaseModel {
  static tablename = tableNameFor("ProductModel"); // "product"

  sku = column.varchar(64).notNull();
  // .default(literal) para constantes; .default(sql.now()) para expressão server-side
  status = column.enum("draft", "published").notNull().default("draft");
  price = column.numeric(12, 2).notNull(); // string, ex.: "19.90"
  metadata = column.jsonb<{ tags: string[] }>(); // nullable, tipado
}
```

| Modificador | Efeito |
| --- | --- |
| `.notNull()` | `NOT NULL` — o campo entra como obrigatório no insert. |
| `.primaryKey()` | Chave primária (raro: `BaseModel.id` já é a PK). |
| `.default(v)` | Default de insert: um literal `T`, ou uma expressão de `sql` (`sql.now()`, `sql.uuidv4()`, `sql.currentDate()`, `sql.raw("...")`). |
| `.onUpdate(v)` | Re-aplica um valor a cada UPDATE (é o que `updatedAt` usa com `sql.now()`). |

!!! tip "Coluna sem `.notNull()` é anulável"
    Igual ao SQLAlchemy: uma coluna nasce anulável. O tipo inferido vira
    `T | null` e ela some do payload obrigatório de insert. Marque
    `.notNull()` só no que o domínio exige.

**Recap:** estenda `BaseModel`, fixe `tablename` com `tableNameFor`, declare as
colunas do domínio com o `column` factory. O SDK entrega id/timestamps/soft-delete
e o tipo estático da linha é inferido sozinho.

---

## 2. Conectando ao banco

`createEngine` monta a engine assíncrona a partir de uma URL. Instancie **uma
vez** por aplicação e injete a sessão nas camadas de baixo — não crie engine
dentro de router.

```ts
// src/db/engine.ts
import { createEngine, loadSettings, databaseSettingsShape } from "tempest-express-sdk";

const settings = loadSettings(databaseSettingsShape);

/** A engine única da aplicação. `DATABASE_URL` cai para `sqlite://./app.db`. */
export const engine = createEngine(settings.DATABASE_URL, {
  // echo: true,  // ecoa SQL no stdout (dev)
});
```

A URL decide o backend: `postgresql://app@localhost/app` usa `postgres.js`
(carregado sob demanda); `sqlite://./app.db` ou `sqlite://:memory:` usam o driver
SQLite. Não há truque de substring — a engine lê o dialeto da URL.

### Uma sessão por request

`engine.session()` entrega uma sessão. **Ela não faz commit sozinha** — quem
escreve é a camada de repository/service. O padrão é um middleware que abre uma
sessão por request e a coloca em `res.locals`:

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

### Escrita transacional

Para uma operação que precisa ser atômica, use `engine.transaction` — ela dá uma
sessão, faz commit no sucesso e rollback no erro:

```ts
await engine.transaction(async (tx) => {
  const users = new UserRepository(tx);
  const orders = new OrderRepository(tx);
  const user = await users.create({ name: "Ana", email: "ana@x.com", passwordHash: "..." });
  await orders.create({ userId: user.id, total: "0.00" });
  // commit automático ao resolver; rollback se lançar
});
```

### Health check e shutdown

```ts
// probe simples de liveness + banco
router.get("/health", async (_req, res) => {
  try {
    await engine.session().list?.(); // ou um SELECT 1 via query builder
    res.json({ status: "ok", database: true });
  } catch {
    res.status(503).json({ status: "degraded", database: false });
  }
});

// no shutdown gracioso da aplicação:
await engine.close();
```

!!! info "`await using` fecha o pool sozinho"
    A engine implementa `Symbol.asyncDispose`, então em um script você pode
    escrever `await using engine = createEngine(url)` e o pool fecha quando o
    escopo termina — sem `try/finally`.

**Recap:** uma `engine` por app, em `src/db/engine.ts`; `engine.session()` por
request (sem commit implícito); `engine.transaction()` para escritas atômicas;
`engine.close()` no shutdown.

---

## 3. O repository

`BaseRepository<typeof Model>` é o coração da camada. Ele encapsula CRUD tipado,
filtros e paginação. Há dois jeitos de usá-lo.

### Modo direto — CRUD puro

Quando não há query custom, instancie direto. **A ordem do construtor é
`(model, session)`:**

```ts
import { BaseRepository } from "tempest-express-sdk";
import { UserModel } from "@/db/models/userModel";

const repository = new BaseRepository(UserModel, session);
const user = await repository.getById(userId);
```

### Modo subclasse — o padrão do projeto

Subclassifique para fixar o model no construtor e adicionar queries do domínio.
Este é exatamente o arquivo que `tempest-express generate` gera:

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

!!! tip "Não precisa passar a session duas vezes"
    O construtor da subclasse recebe só a `AsyncSession` e repassa o
    `UserModel` para `super`. Diferente do `tempest-fastapi-sdk` (onde a session
    vem primeiro), aqui a ordem é `super(Model, session)`.

### O CRUD que você ganha

Lembrando da convenção de coleções do projeto: lookups de **registro único**
levantam 404 (`RecordNotFound`); lookups de **coleção** devolvem `[]`.

```ts
// Leitura — registro único (lança RecordNotFound quando não acha → 404)
const user = await repository.getById(userId);

// Leitura — pode não existir (null, sem 404)
const maybe = await repository.getByIdOrNull(userId);
const first = await repository.first({ isActive: true });

// Leitura — coleção (sempre [], nunca 404)
const users = await repository.list({ isActive: true });

// Existência / contagem
const taken = await repository.exists({ email: "a@b.com" });
const total = await repository.count({ isActive: true });

// Escrita
const created = await repository.create({
  name: "Ana",
  email: "ana@x.com",
  passwordHash: "...",
});
const many = await repository.createMany([
  { name: "A", email: "a@x.com", passwordHash: "..." },
  { name: "B", email: "b@x.com", passwordHash: "..." },
]);

// Update por filtro — retorna nº de linhas afetadas
const n = await repository.update({ id: userId }, { name: "Ana Maria" });

// Delete por filtro — retorna nº de linhas afetadas (hard delete)
const removed = await repository.delete({ id: userId });
```

!!! note "`update`/`delete` são por filtro, não por instância"
    Ao contrário do `tempest-fastapi-sdk` (que persiste uma instância anexada),
    aqui `update({ id }, { ...campos })` e `delete({ id })` operam sobre um
    filtro `WhereInput` e devolvem a **contagem** de linhas afetadas. O fluxo
    típico é: valide → `update({ id }, patch)` → `getById(id)` se precisar da
    linha atualizada de volta.

!!! tip "Soft-delete é um `update` na flag `isActive`"
    Não há método `softDelete` dedicado (ainda). Faça
    `repository.update({ id }, { isActive: false })` para desativar e
    `{ isActive: true }` para restaurar. Para um carimbo temporal
    (`deletedAt`), veja a [seção 6](#6-colunas-opt-in-soft-delete-e-auditoria).

**Recap:** instancie direto para CRUD puro, subclassifique para fixar o model +
queries. 404 só em `getById`; coleção devolve `[]`. `update`/`delete` recebem um
filtro e retornam contagem.

---

## 4. Filtros por convenção

`list`, `first`, `exists`, `count`, `update`, `delete` e `paginate` recebem um
`WhereInput` **totalmente tipado**: cada chave precisa ser uma coluna real, e o
valor aceita ou o valor cru (atalho para `eq`) ou um objeto de operadores válidos
para o **tipo daquela coluna**. Um `like` num campo `number`, ou `gt` num
`string`, é erro de compilação.

```ts
// Igualdade (atalho): { col: value }
await repository.list({ isActive: true, email: "a@b.com" });

// Objeto de operadores por coluna
await repository.list({
  name: { ilike: "%ana%" },          // string → like/ilike (case-insensitive)
  id: { in: [id1, id2, id3] },       // qualquer tipo → in / notIn
  createdAt: { gte: start, lt: end }, // Date/number/bigint → gt/gte/lt/lte/between
  metadata: { isNull: false },       // qualquer tipo → isNull (IS NOT NULL)
});
```

Operadores disponíveis por tipo de coluna:

| Tipo da coluna | Operadores |
| --- | --- |
| Qualquer | `eq`, `ne`, `in`, `notIn`, `isNull` |
| `string` | + `like`, `ilike` |
| `number` / `bigint` / `Date` | + `gt`, `gte`, `lt`, `lte`, `between` (`[lo, hi]` inclusivo) |
| `boolean` | (só os de qualquer tipo) |

```ts
// "ativos atualizados depois da marca d'água" — precisão de timestamp
const changed = await repository.list({
  isActive: true,
  updatedAt: { gt: watermark },
});

// "criados no intervalo" — BETWEEN inclusivo
const report = await repository.list({ createdAt: { between: [start, end] } });

// busca textual + pertinência a um conjunto
const hits = await repository.list({ name: { ilike: "%silva%" }, id: { in: selectedIds } });
```

!!! tip "Filtros vêm de um schema, não de strings soltas"
    Na prática você não monta esse objeto à mão. `paginationFilterSchema`
    (e suas extensões via `.extend`) validam a query string e `getConditions`
    devolve só os filtros de domínio, sem as chaves de paginação — pronto para
    repassar ao repository.

**Recap:** um objeto tipado, operadores restritos ao tipo da coluna, checados em
tempo de compilação. Valor cru = `eq`; objeto = operadores.

---

## 5. Paginação

`BaseRepository.paginate` faz **paginação offset** embutida — você quase nunca
escreve a query à mão:

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

O `total` é computado da **mesma** query filtrada, então a contagem sempre bate
com os `items`. O envelope tem `items` / `total` / `page` / `pageSize` / `pages`
— o mesmo shape que `paginationSchema` valida para a resposta HTTP.

Num router, o filtro vem de um schema via a query string:

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
  name: paginationFilterSchema.shape.orderBy, // string opcional → ilike pela convenção
});

router.get("/api/users", async (req, res) => {
  const filter = userFilterSchema.parse(req.query);
  const repository = new UserRepository(res.locals.session);
  const page = await repository.paginate({
    ...getPaginationConditions(filter), // { page, pageSize, orderBy, ascending }
    filters: getConditions(filter),      // só os filtros de domínio
  });
  res.json(page);
});
```

!!! info "Paginação por cursor: helpers de schema prontos"
    Para feeds/tabelas grandes, o SDK traz `cursorPaginationFilterSchema`,
    `cursorPaginationSchema`, `encodeCursor` e `decodeCursor`. Hoje o
    `BaseRepository` implementa só o modo offset; o cursor você monta com esses
    helpers + uma query `list({ id: { gt: lastId } })` ordenada por `(orderBy,
    id)`. O cursor é um JSON em base64 url-safe opaco — o cliente devolve
    `nextCursor` literalmente até virar `null`.

**Recap:** `paginate` (offset) já entrega `items` + metadados; o par
`getPaginationConditions` / `getConditions` separa paginação de filtros de
domínio sem renomear nada.

---

## 6. Colunas opt-in: soft-delete e auditoria

TypeScript não tem herança múltipla, então os "mixins" do `tempest-fastapi-sdk`
viram **column-builder factories** que você atribui como campos — só quando o
domínio pede:

| Factory | Coluna | Para quê |
| --- | --- | --- |
| `deletedAtColumn()` | `deletedAt` (`Date`, anulável) | Soft-delete temporal (quando, não só se). |
| `createdByColumn()` | `createdBy` (`UUID`, anulável) | Quem criou a linha. |
| `updatedByColumn()` | `updatedBy` (`UUID`, anulável) | Quem fez a última escrita. |

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

A filtragem é responsabilidade de quem chama — as colunas **não** instalam um
filtro global. Esconda linhas soft-deleted passando `{ deletedAt: { isNull: true } }`;
carimbe a auditoria no service, onde o usuário atual está em escopo:

```ts
// esconder soft-deleted
const alive = await repository.list({ deletedAt: { isNull: true } });

// soft-delete temporal (no service, com o actor em escopo)
await repository.update({ id: userId }, { deletedAt: new Date(), updatedBy: actorId });

// restaurar
await repository.update({ id: userId }, { deletedAt: null });
```

!!! tip "Dois carimbos de delete, propósitos diferentes"
    Use `isActive: false` (a flag de `BaseModel`) quando o booleano já basta.
    Use `deletedAt` quando precisa **saber quando** o delete aconteceu —
    auditoria, políticas de retenção.

**Recap:** as colunas opt-in entram só quando o domínio precisa; a filtragem de
soft-delete é sua (`{ deletedAt: { isNull: true } }`); o carimbo de auditoria mora
no service.

---

## 7. A pilha completa (repository → service → controller)

O CRUD do repository devolve **linhas cruas** do ORM. As camadas acima existem
para mapear a linha ao DTO de resposta e orquestrar. `tempest-express generate
User` gera a fatia inteira; aqui está o que cada arquivo contém.

`BaseService` embrulha um repository e mapeia cada leitura pelo `mapToResponse`:

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

`BaseController` é a fronteira de orquestração — fino por padrão, sobrescrito
quando um endpoint chama várias services:

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

E o router monta a pilha por request, a partir da sessão em `res.locals`:

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

!!! tip "Deixe o gerador escrever isso"
    `npx tempest-express generate User` cria `userModel.ts`, `user.ts` (schemas),
    `userRepository.ts`, `userService.ts`, `userController.ts` e `users.ts`
    (router) de uma vez — a fatia vertical inteira, pronta para editar.

**Recap:** repository devolve linha crua; `BaseService` mapeia para o DTO;
`BaseController` é a fronteira de orquestração; o router compõe
`Repository → Service → Controller` por request a partir da sessão.

---

## 8. Migrações

O `tempest-db-js` traz um CLI Alembic-style (`tempest-db`) com autogenerate
reversível. Você declara um arquivo de config apontando para o driver, o dialeto
e os models; o CLI faz o resto.

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
  models: [UserModel, ProductModel], // fonte de verdade do autogenerate
});
```

Fluxo completo:

```bash
# 1. Gerar uma revisão a partir do diff models ↔ schema
npx tempest-db revision -m "add users table" --autogenerate

# 2. Aplicar as revisões pendentes
npx tempest-db upgrade

# 3. Inspecionar
npx tempest-db current     # revisão atual
npx tempest-db history     # todas as revisões
npx tempest-db heads       # cabeças pendentes
```

O `--autogenerate` faz o diff entre o **schema replay** (as migrações aplicadas)
e os **models refletidos**, emitindo `up()`/`down()` tipados — nunca um blob
`.sql` cru. Cada operação (`create_table`, `add_column`, `alter_column`, …) tem
inverso conhecido, então o `down()` sai reversível de graça.

### Gate de CI — o schema deve casar com os models

```bash
# falha (exit != 0) se os models divergirem das migrações aplicadas
npx tempest-db check
```

```yaml
# .github/workflows/ci.yml
- name: Check migrations are in sync
  run: npx tempest-db check
```

!!! warning "Postgres vs SQLite"
    O driver e o dialeto vêm do config. Para produção Postgres, troque
    `NodeSqliteDriver.open(...)` pelo driver Postgres e `dialect: "postgres"`.
    O `check` de drift funciona nos dois (`checkDrift` / `checkDriftPostgres`).

!!! info "Dev sem migração"
    Para um dev/teste rápido sem CI de migração, a engine pode criar as tabelas
    a partir dos models refletidos. Migrações são para quando o schema precisa
    evoluir com segurança em produção — não pule elas em bases com dados.

**Recap:** um `tempest-db.config.mjs` aponta driver + dialeto + models;
`revision --autogenerate` por mudança, `upgrade` para aplicar, `check` no CI.

---

## Próximos passos

Você agora modela tabelas com `BaseModel`, conecta com `createEngine`, sobe um
`BaseRepository` tipado, filtra por convenção, pagina e migra. Continue em:

- [Autenticação (JWT)](auth.md) — um `UserStore` sobre o seu repository.
- [Admin (API JSON)](admin.md) — CRUD administrativo auto-derivado dos models.
- [Cache, fila e tarefas](jobs.md) — as camadas assíncronas ao redor do banco.

Este é o mesmo desenho do [`tempest-fastapi-sdk`](https://mauriciobenjamin700.github.io/tempest-fastapi-sdk/recipes/database/)
— models declarativos, repository tipado, paginação embutida e migrações
autogeradas — portado fielmente para Node.js. ✅
