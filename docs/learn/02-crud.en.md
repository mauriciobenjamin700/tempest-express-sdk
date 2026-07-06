# Chapter 2 — Full CRUD

In [Chapter 1](01-setup.md) you got the server running with a `TaskModel`, a SQLite `engine`, a `TaskRepository`, and **one** route: `GET /api/tasks`. 🚀

Now let's make it a real API: you'll **create tasks** with a `POST`, validate the input, and return the created task — all without losing the `GET` that already works.

## The layers, one at a time

Before writing any code, it helps to understand **why** we're adding three pieces. Each layer has a single job:

**Schema** — describes the **shape** of the data: what comes in on a request and what goes out on a response. It validates the input (empty title? error!) and guarantees the response always has the same fields.

**Service** — the **business logic**. It talks to the repository (the database) and knows how to translate a raw table row into the response shape the client expects.

**Controller** — the **orchestration boundary**. The route talks to the controller, the controller talks to the service. In a small API it's thin, but keeping it makes the design identical to a real Tempest service.

So a request always flows like this:

```text
router → controller → service → repository → database
```

!!! tip "One piece at a time"
    Don't memorize everything now. Add the code, run it, watch it work — the intuition comes from use. 💡

## Add the schema and the layers

Open your `app.ts`. Right **after** the `TaskRepository` class, paste this block:

```ts
import { BaseController, BaseService, baseResponseSchema, z } from "tempest-express-sdk";

// Formato de entrada ao criar uma tarefa.
const taskCreateSchema = z.object({
  title: z.string().min(1),
  done: z.boolean().default(false),
});

// Formato da resposta (herda id/isActive/createdAt/updatedAt do baseResponseSchema).
const taskResponseSchema = baseResponseSchema.extend({
  title: z.string(),
  done: z.boolean(),
});

type TaskResponse = z.infer<typeof taskResponseSchema>;

class TaskService extends BaseService<typeof TaskModel, TaskResponse> {
  constructor(repository: TaskRepository) {
    super(repository, (row) => ({
      id: row.id,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      title: row.title,
      done: row.done,
    }));
  }
}

class TaskController extends BaseController<typeof TaskModel, TaskResponse> {
  constructor(service: TaskService) {
    super(service);
  }
}
```

!!! note "Merge the imports at the top"
    You already imported a few things at the top of `app.ts` (back in Chapter 1). Instead of repeating the `import` line, add the new names — `BaseController`, `BaseService`, `baseResponseSchema` and `z` — to the import that's already there. A single `import { ... } from "tempest-express-sdk";` at the top is enough.

Let's read the block line by line:

- `taskCreateSchema` describes **what the client sends** when creating a task: a `title` that is a string with at least 1 character (`z.string().min(1)`) and an optional `done` that defaults to `false` when absent (`z.boolean().default(false)`).
- `taskResponseSchema` describes **what the API returns**. It starts from `baseResponseSchema` (which already carries `id`, `isActive`, `createdAt` and `updatedAt`) and adds (`.extend(...)`) your domain fields: `title` and `done`.
- `type TaskResponse = z.infer<typeof taskResponseSchema>;` builds the **TypeScript type** from the schema. You write the shape **once** (in the schema) and TypeScript derives the type for you — no two definitions to keep in sync.
- `TaskService` extends `BaseService`. In `super(...)` you pass two arguments: the `repository` (which talks to the database) and a **mapping function** that takes a raw row (`row`) and returns the response object. This is where a database row becomes a `TaskResponse`.
- `TaskController` extends `BaseController` and only takes the `service`. Thin on purpose — it's the boundary the route calls.

## Wire the routes

Now **replace** the whole `createApp` block with this:

```ts
const app = await createApp({
  configure: (app) => {
    const controllerFor = () =>
      new TaskController(new TaskService(new TaskRepository(engine.session())));

    app.get("/api/tasks", async (_req, res) => {
      res.json(await controllerFor().list());
    });

    app.post("/api/tasks", async (req, res) => {
      const data = taskCreateSchema.parse(req.body); // inválido → 422 automático
      res.status(201).json(await controllerFor().create(data));
    });
  },
});
```

What changed:

- `controllerFor()` is a small helper that **builds the stack** on every request: it creates a `TaskRepository` with a fresh session (`engine.session()`), wraps it in a `TaskService` and, finally, in a `TaskController`. A fresh session per request is the correct pattern.
- The `GET /api/tasks` route is unchanged: it calls `controllerFor().list()`, which returns all tasks already mapped to `TaskResponse`, and replies with `res.json(...)`.
- The `POST /api/tasks` route is the new bit. First `taskCreateSchema.parse(req.body)` **validates** the request body. If the body is invalid (say, an empty `title`), the SDK replies **422** automatically — you write no `if`. If it's valid, `controllerFor().create(data)` **inserts** the task and returns the mapped response, with a generated `id`. The `res.status(201)` marks the classic "Created". ✅

## Try it

Start the server (as in Chapter 1) and create a task with `curl`:

```bash
curl -X POST http://127.0.0.1:8000/api/tasks \
  -H "content-type: application/json" \
  -d '{"title":"Comprar pão"}'
```

The response will look like this (the `id` and dates will differ on your machine):

```json
{
  "id": "3f8c2b6e-0a1d-4e7a-9c11-2b3c4d5e6f70",
  "isActive": true,
  "createdAt": "2026-07-06T12:00:00.000Z",
  "updatedAt": "2026-07-06T12:00:00.000Z",
  "title": "Comprar pão",
  "done": false
}
```

Notice: you only sent `title`, yet the response came back complete — `done` became `false` (the schema default) and `id`, `isActive`, `createdAt` and `updatedAt` were filled in by the database. 💡

Now list the tasks:

```bash
curl http://127.0.0.1:8000/api/tasks
```

And the task you just created shows up in the list:

```json
[
  {
    "id": "3f8c2b6e-0a1d-4e7a-9c11-2b3c4d5e6f70",
    "isActive": true,
    "createdAt": "2026-07-06T12:00:00.000Z",
    "updatedAt": "2026-07-06T12:00:00.000Z",
    "title": "Comprar pão",
    "done": false
  }
]
```

!!! tip "Prefer clicking to typing?"
    Open `http://127.0.0.1:8000/docs` in your browser. The **Swagger UI** shows both routes, with a **Try it out** button to create and list tasks without leaving the browser. Same API — just interactive. 🚀

!!! info "You defined Task once"
    Notice what you got for free: a **single** schema (`taskCreateSchema` + `taskResponseSchema`) gave you input **validation**, TypeScript **types** (via `z.infer`), and **documentation** in Swagger — all from the same source. Defined once, used in three places. ✅

## Recap

In this chapter you:

- Learned the role of each layer — **schema** (shape), **service** (business logic + mapping) and **controller** (boundary).
- Wrote `taskCreateSchema` and `taskResponseSchema`, and derived the `TaskResponse` type with `z.infer`.
- Added `POST /api/tasks`, which **validates** with `parse` (automatic 422) and **creates** with `create`.
- Tested it by creating and listing tasks, via `curl` and via Swagger.

Your API already creates and lists. What's left is handling the "what if it doesn't exist?" cases and filtering tasks. Let's polish. 👉

👉 Continue to **[Chapter 3 — Polish: errors and filters](03-polish.md)**.
