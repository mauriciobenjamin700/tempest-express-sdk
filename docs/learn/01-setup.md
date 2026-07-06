# Capítulo 1 — Setup e o primeiro modelo

Vamos começar do começo: uma pasta vazia. 🚀 Ao final deste capítulo, você terá um servidor rodando, com uma tabela `task` no banco e um endpoint que lista tarefas (ainda vazio, mas funcionando).

## 1. Criar a pasta do projeto

Abra o terminal e crie a pasta do projeto, entre nela e inicie um `package.json`:

```bash
mkdir tarefas
cd tarefas
npm init -y
```

- `mkdir tarefas` cria a pasta.
- `cd tarefas` entra nela.
- `npm init -y` gera um `package.json` com as respostas padrão (o `-y` aceita tudo sem perguntar).

Agora abra o `package.json` e adicione a linha `"type": "module"`. Ela diz ao Node para usar `import`/`export` modernos (ESM), que é o que o SDK usa:

```json title="package.json" hl_lines="6"
{
  "name": "tarefas",
  "version": "1.0.0",
  "main": "index.js",
  "scripts": {},
  "type": "module"
}
```

!!! tip "Por que `\"type\": \"module\"`?"
    Sem essa linha, o Node assume o formato antigo (CommonJS, com `require`). Com ela, você pode usar `import { ... } from "..."` — exatamente como nos exemplos deste guia. ✅

## 2. Instalar as dependências

Instale os pacotes que o app precisa em produção:

```bash
npm install tempest-express-sdk tempest-db-js express zod
```

E as ferramentas de desenvolvimento (usadas só na sua máquina, para rodar TypeScript):

```bash
npm install --save-dev tsx typescript @types/node @types/express
```

O que é cada um:

- **`tempest-express-sdk`** — o SDK: dá as camadas (model, repository, servidor) que você vai montar.
- **`tempest-db-js`** — a camada de banco de dados por baixo do SDK.
- **`express`** — o servidor HTTP que atende as requisições.
- **`zod`** — validação de dados (você vai usar mais nos próximos capítulos).
- **`tsx`** — roda arquivos TypeScript direto, sem passo de build.
- **`typescript`** + **`@types/node`** + **`@types/express`** — o compilador e os tipos, para o editor te ajudar com autocomplete e erros.

## 3. Criar o `app.ts`

Crie um arquivo `app.ts` na pasta `tarefas` com **exatamente** este conteúdo:

```ts title="app.ts"
import {
  AsyncEngine,
  type AsyncSession,
  BaseModel,
  BaseRepository,
  NodeSqliteDriver,
  column,
  createApp,
  runServer,
  tableNameFor,
} from "tempest-express-sdk";
import { reflectTable, renderOperation } from "tempest-db-js/migrations";

// --- O modelo: uma tabela "task" ---
class TaskModel extends BaseModel {
  static tablename = tableNameFor("TaskModel"); // "task"
  title = column.text().notNull();
  done = column.boolean().notNull().default(false);
}

// --- O banco: um arquivo SQLite local, criando a tabela na primeira vez ---
const sqlite = NodeSqliteDriver.open("tarefas.db");
for (const statement of renderOperation(
  { kind: "create_table", table: reflectTable(TaskModel) },
  "sqlite",
)) {
  try {
    sqlite.execute(statement, []);
  } catch {
    // A tabela já existe — tudo bem em execuções seguintes.
  }
}
const engine = new AsyncEngine(
  { execute: (s, p) => Promise.resolve(sqlite.execute(s, p)), close: async () => sqlite.close() },
  "sqlite",
);

// --- Um repositório para a tabela ---
class TaskRepository extends BaseRepository<typeof TaskModel> {
  constructor(session: AsyncSession) {
    super(TaskModel, session);
  }
}

// --- O app ---
const app = await createApp({
  configure: (app) => {
    app.get("/api/tasks", async (_req, res) => {
      const repo = new TaskRepository(engine.session());
      res.json(await repo.list());
    });
  },
});

await runServer(app, { port: 8000 });
```

Parece muita coisa, mas cada bloco tem um papel bem simples. Vamos por partes.

### As importações

```ts
import {
  AsyncEngine,
  type AsyncSession,
  BaseModel,
  BaseRepository,
  NodeSqliteDriver,
  column,
  createApp,
  runServer,
  tableNameFor,
} from "tempest-express-sdk";
import { reflectTable, renderOperation } from "tempest-db-js/migrations";
```

Você traz do SDK tudo o que vai usar: as classes-base (`BaseModel`, `BaseRepository`), o motor de banco (`AsyncEngine`), o driver SQLite (`NodeSqliteDriver`), o helper de colunas (`column`), os helpers do servidor (`createApp`, `runServer`) e o utilitário de nome de tabela (`tableNameFor`). O `type AsyncSession` é só um tipo — você usa na assinatura do repositório. As duas funções de `tempest-db-js/migrations` (`reflectTable` e `renderOperation`) servem para criar a tabela.

### O modelo

```ts
class TaskModel extends BaseModel {
  static tablename = tableNameFor("TaskModel"); // "task"
  title = column.text().notNull();
  done = column.boolean().notNull().default(false);
}
```

Este é o **formato** da sua tabela `task`. Você declara só os campos próprios da tarefa:

- `tableNameFor("TaskModel")` calcula o nome da tabela — resulta em `"task"`.
- `title` é uma coluna de texto obrigatória (`.notNull()`).
- `done` é um booleano obrigatório com valor padrão `false` — toda tarefa nova nasce como "não concluída".

E os campos como `id`, `isActive`, `createdAt` e `updatedAt`? Você **não precisa declarar**: eles vêm de graça do `BaseModel`. 💡

### O banco de dados

```ts
const sqlite = NodeSqliteDriver.open("tarefas.db");
for (const statement of renderOperation(
  { kind: "create_table", table: reflectTable(TaskModel) },
  "sqlite",
)) {
  try {
    sqlite.execute(statement, []);
  } catch {
    // A tabela já existe — tudo bem em execuções seguintes.
  }
}
```

Aqui você abre um arquivo SQLite local chamado `tarefas.db` (ele é criado na primeira vez que você roda o app). Em seguida:

- `reflectTable(TaskModel)` lê o formato do seu modelo.
- `renderOperation({ kind: "create_table", ... }, "sqlite")` transforma isso nos comandos SQL de `CREATE TABLE`.
- O `for` roda cada comando. O `try/catch` ignora o erro "a tabela já existe" — assim, da segunda execução em diante, ele simplesmente não recria a tabela.

```ts
const engine = new AsyncEngine(
  { execute: (s, p) => Promise.resolve(sqlite.execute(s, p)), close: async () => sqlite.close() },
  "sqlite",
);
```

O `AsyncEngine` é o motor que o SDK usa para conversar com o banco de forma assíncrona. Você o conecta ao driver SQLite passando duas funções: `execute` (roda um comando) e `close` (fecha a conexão).

### O repositório

```ts
class TaskRepository extends BaseRepository<typeof TaskModel> {
  constructor(session: AsyncSession) {
    super(TaskModel, session);
  }
}
```

O **repositório** é quem fala com a tabela: ele já vem com métodos prontos como `list()`, herdados de `BaseRepository`. Você só diz a ele qual modelo (`TaskModel`) e qual sessão (`session`) usar.

### O app e a rota

```ts
const app = await createApp({
  configure: (app) => {
    app.get("/api/tasks", async (_req, res) => {
      const repo = new TaskRepository(engine.session());
      res.json(await repo.list());
    });
  },
});

await runServer(app, { port: 8000 });
```

- `createApp` monta o servidor. Dentro de `configure`, você registra suas rotas.
- `app.get("/api/tasks", ...)` cria um endpoint que responde a `GET /api/tasks`.
- Dentro dele, você cria um repositório com uma sessão (`engine.session()`) e responde com `repo.list()` — a lista de tarefas. Por enquanto, vazia.
- `runServer(app, { port: 8000 })` sobe o servidor na porta `8000`.

## 4. Rodar o servidor

Com tudo salvo, rode:

```bash
npx tsx app.ts
```

O `tsx` executa o TypeScript diretamente. Você deve ver uma linha parecida com esta:

```json
{"level":"info","msg":"Server listening","host":"127.0.0.1","port":8000}
```

Servidor no ar! 🚀 Agora abra no navegador:

- **<http://127.0.0.1:8000/api/tasks>** — retorna `[]` (uma lista vazia).
- **<http://127.0.0.1:8000/docs>** — a documentação interativa (Swagger).

!!! check "Lista vazia é sucesso!"
    Ver `[]` em `/api/tasks` **não é erro** — é o resultado certo. Você ainda não criou nenhuma tarefa, então a lista está vazia. Assim que criar a primeira (no próximo capítulo), ela vai aparecer aqui. ✅

## 5. Entendendo as escolhas

!!! note "Por que um arquivo só?"
    Colocamos tudo em `app.ts` de propósito: assim você vê o fluxo inteiro numa tela só, sem pular entre arquivos. É o ideal para aprender. No **Capítulo 2** você adiciona o endpoint de criar tarefas — e as coisas começam a ficar interessantes. Num projeto real, cada camada mora em seu próprio arquivo; a receita de [Banco de dados](../recipes/database.md) mostra como.

??? note "E as migrations?"
    Criar a tabela ali no `app.ts` (com `reflectTable` + `renderOperation`) é um **atalho de desenvolvimento** — prático para um tutorial. Em aplicações reais, a estrutura do banco é gerenciada pela CLI de migrations `tempest-db`, que versiona e aplica cada mudança de schema com segurança. Veja a receita de [Banco de dados](../recipes/database.md) para o caminho completo.

## Recapitulando

Você criou o projeto do zero, instalou o SDK, definiu o modelo `TaskModel` (a tabela `task`), criou a tabela num SQLite local e subiu um servidor com um endpoint que lista tarefas. Ver `[]` é a prova de que tudo funciona. ✅

No próximo capítulo, você deixa a lista ganhar vida: adiciona o endpoint para **criar** tarefas e o para **concluir** cada uma.

👉 Continue no **[Capítulo 2 — CRUD completo](02-crud.md)**.
