# Testes (banco em memória)

Testar a camada de dados não deveria exigir um Postgres rodando, arquivos
temporários ou migrations. `createTestDatabase` sobe um engine `tempest-db-js`
completo sobre **SQLite em memória**, com o schema criado direto dos seus
models — uma conexão só serve tanto o DDL quanto todas as sessões, então os
repositories enxergam as tabelas que você declarou.

É o porte do módulo `testing` do `tempest-fastapi-sdk`, e é **agnóstico de
framework** (não importa `vitest`/`jest`) — use com o harness que quiser.

---

## 1. Um teste de repository

```ts
import { BaseRepository, createTestDatabase } from "tempest-express-sdk";
import { UserModel } from "@/db/models/userModel";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("UserRepository", () => {
  let db: ReturnType<typeof createTestDatabase>;

  beforeEach(() => {
    db = createTestDatabase([UserModel]); // cria a tabela `user`
  });
  afterEach(() => db.close());

  it("cria e busca um usuário", async () => {
    const repo = new BaseRepository(UserModel, db.session());
    const user = await repo.create({
      name: "Ana",
      email: "ana@x.com",
      passwordHash: "...",
    });
    expect(user.id).toBeTruthy();       // UUID gerado
    expect(user.isActive).toBe(true);   // default do BaseModel
    expect(await repo.count()).toBe(1);
  });
});
```

`createTestDatabase(models)` devolve `{ engine, session(), close() }`. Passe
`db.session()` para o repository (ou service/controller) exatamente como em
produção. Cada chamada cria um banco **isolado** — testes não vazam estado entre
si.

!!! tip "Passe todos os models que o teste toca"
    O array de models é o que vira `CREATE TABLE`. Se um repository consulta uma
    tabela relacionada, inclua o model dela também.

---

## 2. Escopo automático com `withTestDatabase`

Quando você quer o banco só durante um bloco — e garantir o `close()` mesmo se
o corpo lançar — use o wrapper:

```ts
import { BaseRepository, withTestDatabase } from "tempest-express-sdk";
import { UserModel } from "@/db/models/userModel";

it("lista vazio quando não há registros", async () => {
  await withTestDatabase([UserModel], async (db) => {
    const repo = new BaseRepository(UserModel, db.session());
    expect(await repo.list()).toEqual([]);
  });
});
```

Ele cria o banco, roda a função e faz `close()` no `finally` — devolvendo o que
a função retornar.

---

## 3. Testando um service/controller

A pilha inteira funciona sobre o mesmo `db.session()`:

```ts
import { createTestDatabase } from "tempest-express-sdk";
import { UserController } from "@/controllers/userController";
import { UserRepository } from "@/db/repositories/userRepository";
import { UserService } from "@/services/userService";
import { UserModel } from "@/db/models/userModel";

it("mapeia a linha para o DTO de resposta", async () => {
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

## Recapitulando

- `createTestDatabase(models)` → engine SQLite em memória com as tabelas dos
  models; `session()` para os repositories, `close()` no teardown.
- `withTestDatabase(models, fn)` escopa o banco a um bloco e sempre fecha.
- Isolado por chamada, zero dependência externa, agnóstico de harness. ✅
