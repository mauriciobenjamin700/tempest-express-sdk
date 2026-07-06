# Chapter 1 — Setup and the first model

Let's start from the very beginning: an empty folder. 🚀 By the end of this chapter you'll have a server running, a `task` table in the database, and an endpoint that lists tasks (still empty, but working).

## 1. Create the project folder

Open your terminal, create the project folder, step into it, and initialize a `package.json`:

```bash
mkdir tarefas
cd tarefas
npm init -y
```

- `mkdir tarefas` creates the folder.
- `cd tarefas` steps into it.
- `npm init -y` generates a `package.json` with default answers (the `-y` accepts everything without asking).

Now open `package.json` and add the line `"type": "module"`. It tells Node to use modern `import`/`export` (ESM), which is what the SDK uses:

```json title="package.json" hl_lines="6"
{
  "name": "tarefas",
  "version": "1.0.0",
  "main": "index.js",
  "scripts": {},
  "type": "module"
}
```

!!! tip "Why `\"type\": \"module\"`?"
    Without that line, Node assumes the old format (CommonJS, with `require`). With it, you can use `import { ... } from "..."` — exactly like the examples in this guide. ✅

## 2. Install the dependencies

Install the packages the app needs in production:

```bash
npm install tempest-express-sdk tempest-db-js express zod
```

And the development tools (used only on your machine, to run TypeScript):

```bash
npm install --save-dev tsx typescript @types/node @types/express
```

What each one is:

- **`tempest-express-sdk`** — the SDK: it provides the layers (model, repository, server) you'll assemble.
- **`tempest-db-js`** — the database layer underneath the SDK.
- **`express`** — the HTTP server that handles the requests.
- **`zod`** — data validation (you'll use it more in the next chapters).
- **`tsx`** — runs TypeScript files directly, with no build step.
- **`typescript`** + **`@types/node`** + **`@types/express`** — the compiler and the types, so your editor can help you with autocomplete and errors.

## 3. Create `app.ts`

Create an `app.ts` file in the `tarefas` folder with **exactly** this content:

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

// --- The model: a "task" table ---
class TaskModel extends BaseModel {
  static tablename = tableNameFor("TaskModel"); // "task"
  title = column.text().notNull();
  done = column.boolean().notNull().default(false);
}

// --- The database: a local SQLite file, creating the table the first time ---
const sqlite = NodeSqliteDriver.open("tarefas.db");
for (const statement of renderOperation(
  { kind: "create_table", table: reflectTable(TaskModel) },
  "sqlite",
)) {
  try {
    sqlite.execute(statement, []);
  } catch {
    // The table already exists — fine on later runs.
  }
}
const engine = new AsyncEngine(
  { execute: (s, p) => Promise.resolve(sqlite.execute(s, p)), close: async () => sqlite.close() },
  "sqlite",
);

// --- A repository for the table ---
class TaskRepository extends BaseRepository<typeof TaskModel> {
  constructor(session: AsyncSession) {
    super(TaskModel, session);
  }
}

// --- The app ---
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

It looks like a lot, but each block has a very simple job. Let's go piece by piece.

### The imports

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

You bring in from the SDK everything you'll use: the base classes (`BaseModel`, `BaseRepository`), the database engine (`AsyncEngine`), the SQLite driver (`NodeSqliteDriver`), the column helper (`column`), the server helpers (`createApp`, `runServer`), and the table-name utility (`tableNameFor`). The `type AsyncSession` is just a type — you use it in the repository's signature. The two functions from `tempest-db-js/migrations` (`reflectTable` and `renderOperation`) are used to create the table.

### The model

```ts
class TaskModel extends BaseModel {
  static tablename = tableNameFor("TaskModel"); // "task"
  title = column.text().notNull();
  done = column.boolean().notNull().default(false);
}
```

This is the **shape** of your `task` table. You declare only the fields specific to the task:

- `tableNameFor("TaskModel")` computes the table name — it resolves to `"task"`.
- `title` is a required text column (`.notNull()`).
- `done` is a required boolean with a default of `false` — every new task starts out "not done".

What about fields like `id`, `isActive`, `createdAt`, and `updatedAt`? You **don't need to declare** them: they come for free from `BaseModel`. 💡

### The database

```ts
const sqlite = NodeSqliteDriver.open("tarefas.db");
for (const statement of renderOperation(
  { kind: "create_table", table: reflectTable(TaskModel) },
  "sqlite",
)) {
  try {
    sqlite.execute(statement, []);
  } catch {
    // The table already exists — fine on later runs.
  }
}
```

Here you open a local SQLite file called `tarefas.db` (it's created the first time you run the app). Then:

- `reflectTable(TaskModel)` reads your model's shape.
- `renderOperation({ kind: "create_table", ... }, "sqlite")` turns that into the SQL `CREATE TABLE` statements.
- The `for` runs each statement. The `try/catch` ignores the "table already exists" error — so from the second run onward, it simply doesn't recreate the table.

```ts
const engine = new AsyncEngine(
  { execute: (s, p) => Promise.resolve(sqlite.execute(s, p)), close: async () => sqlite.close() },
  "sqlite",
);
```

The `AsyncEngine` is the engine the SDK uses to talk to the database asynchronously. You connect it to the SQLite driver by passing two functions: `execute` (runs a statement) and `close` (closes the connection).

### The repository

```ts
class TaskRepository extends BaseRepository<typeof TaskModel> {
  constructor(session: AsyncSession) {
    super(TaskModel, session);
  }
}
```

The **repository** is what talks to the table: it already ships with ready-made methods like `list()`, inherited from `BaseRepository`. You just tell it which model (`TaskModel`) and which session (`session`) to use.

### The app and the route

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

- `createApp` builds the server. Inside `configure`, you register your routes.
- `app.get("/api/tasks", ...)` creates an endpoint that responds to `GET /api/tasks`.
- Inside it, you create a repository with a session (`engine.session()`) and respond with `repo.list()` — the list of tasks. Empty for now.
- `runServer(app, { port: 8000 })` boots the server on port `8000`.

## 4. Run the server

With everything saved, run:

```bash
npx tsx app.ts
```

`tsx` executes the TypeScript directly. You should see a line like this:

```json
{"level":"info","msg":"Server listening","host":"127.0.0.1","port":8000}
```

Server is up! 🚀 Now open in your browser:

- **<http://127.0.0.1:8000/api/tasks>** — returns `[]` (an empty list).
- **<http://127.0.0.1:8000/docs>** — the interactive documentation (Swagger).

!!! check "An empty list is success!"
    Seeing `[]` at `/api/tasks` is **not an error** — it's the correct result. You haven't created any tasks yet, so the list is empty. As soon as you create the first one (in the next chapter), it'll show up here. ✅

## 5. Understanding the choices

!!! note "Why a single file?"
    We put everything in `app.ts` on purpose: that way you see the whole flow on one screen, without jumping between files. It's ideal for learning. In **Chapter 2** you add the create-task endpoint — and things start to get interesting. In a real project, each layer lives in its own file; the [Database](../recipes/database.md) recipe shows how.

??? note "What about migrations?"
    Creating the table right there in `app.ts` (with `reflectTable` + `renderOperation`) is a **development shortcut** — handy for a tutorial. In real applications, the database structure is managed by the `tempest-db` migration CLI, which versions and applies each schema change safely. See the [Database](../recipes/database.md) recipe for the full path.

## Recap

You created the project from scratch, installed the SDK, defined the `TaskModel` model (the `task` table), created the table in a local SQLite file, and booted a server with an endpoint that lists tasks. Seeing `[]` is proof that it all works. ✅

In the next chapter, you'll bring the list to life: adding the endpoint to **create** tasks and the one to **complete** each one.

👉 Continue with **[Chapter 2 — Full CRUD](02-crud.md)**.
