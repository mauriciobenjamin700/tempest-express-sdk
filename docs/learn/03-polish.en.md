# Chapter 3 — Polish: errors and filters

In [Chapter 2](02-crud.md) your API already creates and lists tasks. 🚀 What's left is the finishing touch: **fetch one task** by id (and reply 404 when it doesn't exist), **mark it as done**, and **filter** the list. That's what makes a real CRUD.

Everything below goes **inside** the `configure` of your `app.ts`, next to the routes you already have.

## Add the three routes

Paste these three routes inside `configure`, right after the `POST`:

```ts
// Buscar UMA tarefa por id — 404 se não existir.
app.get("/api/tasks/:id", async (req, res) => {
  res.json(await controllerFor().getById(req.params.id));
});

// Marcar como concluída.
app.patch("/api/tasks/:id/done", async (req, res) => {
  const repo = new TaskRepository(engine.session());
  await repo.update({ id: req.params.id }, { done: true });
  res.json(await controllerFor().getById(req.params.id));
});

// Listar só as pendentes: GET /api/tasks?done=false
app.get("/api/tasks/pending", async (_req, res) => {
  res.json(await controllerFor().list({ done: false }));
});
```

Let's go piece by piece.

### Fetch one task (with 404 for free)

```ts
app.get("/api/tasks/:id", async (req, res) => {
  res.json(await controllerFor().getById(req.params.id));
});
```

The `:id` in the route is a **route parameter** — Express captures that slice of the URL and hands it to you in `req.params.id`. So `getById(req.params.id)` asks the controller for the task with that id.

And if the id doesn't exist? `getById` throws `RecordNotFound`, and the SDK translates that into a **404** response automatically — you write no handling. The error body looks like:

```json
{ "detail": "...", "code": "NOT_FOUND", "details": {} }
```

!!! note "The exact message may differ"
    The `detail` above is illustrative — the exact text may differ in your version. What matters is the **404 status** and the `code` `NOT_FOUND`.

### Mark it as done

```ts
app.patch("/api/tasks/:id/done", async (req, res) => {
  const repo = new TaskRepository(engine.session());
  await repo.update({ id: req.params.id }, { done: true });
  res.json(await controllerFor().getById(req.params.id));
});
```

A `PATCH` is the right verb for a **partial update** — you change only the `done` field, not the whole task.

Here we go straight to the repository: `repo.update({ id: req.params.id }, { done: true })`. The first argument is the **filter** (which rows to update: the ones with this `id`); the second is the **fields to change** (`done: true`). Then a `getById` **re-fetches** the updated task to return it in the response.

!!! note "`update` takes a filter, not an instance"
    Notice the shape: `update(filter, fields)`. You do **not** pass a whole task object — you pass a filter (which rows) and the set of fields to change. The method returns **how many rows** were affected. For the repository's full CRUD — create, fetch, update, delete and paginate — see the [Database](../recipes/database.md) recipe.

### Filter the list

```ts
app.get("/api/tasks/pending", async (_req, res) => {
  res.json(await controllerFor().list({ done: false }));
});
```

`list({ done: false })` uses the **convention filter object**: pass an object of `field: value` and you get back only the rows that match. Here, only the tasks where `done` is `false` — the pending ones. ✅

## Try it

First, grab the `id` of a real task (create one in Chapter 2 and copy the `id`, or list with `GET /api/tasks`). Then fetch it:

```bash
curl http://127.0.0.1:8000/api/tasks/3f8c2b6e-0a1d-4e7a-9c11-2b3c4d5e6f70
```

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

Now ask for an id that **doesn't exist** and see the automatic 404:

```bash
curl -i http://127.0.0.1:8000/api/tasks/does-not-exist
```

```text
HTTP/1.1 404 Not Found
content-type: application/json

{"detail":"...","code":"NOT_FOUND","details":{}}
```

Mark the task as done with `PATCH`:

```bash
curl -X PATCH http://127.0.0.1:8000/api/tasks/3f8c2b6e-0a1d-4e7a-9c11-2b3c4d5e6f70/done
```

```json
{
  "id": "3f8c2b6e-0a1d-4e7a-9c11-2b3c4d5e6f70",
  "isActive": true,
  "createdAt": "2026-07-06T12:00:00.000Z",
  "updatedAt": "2026-07-06T12:05:00.000Z",
  "title": "Comprar pão",
  "done": true
}
```

Notice `done` became `true`. 💡 Finally, list only the pending ones:

```bash
curl http://127.0.0.1:8000/api/tasks/pending
```

Since the only task is already done, the pending list comes back empty:

```json
[]
```

!!! tip "You can always check in Swagger"
    All of these routes show up at `http://127.0.0.1:8000/docs`, ready to test in the browser. 🚀

## Where to go next

Congratulations — you have a **complete** Task list API: create, list, fetch, complete and filter, with validation, types, docs and automatic 404. 🎉

From here, each recipe takes you one step further toward a real service:

- **[Authentication (JWT)](../recipes/auth.md)** — require login and protect routes.
- **[Database](../recipes/database.md)** — pagination, migrations and a production database.
- **[Testing](../recipes/testing.md)** — test all of this with an in-memory database.
- **[Settings](../recipes/settings.md)** and **[HTTP hardening](../recipes/hardening.md)** — typed settings and a safer HTTP layer.

## Recap

In this chapter you:

- Added `GET /api/tasks/:id` with `getById`, getting an **automatic 404** via `RecordNotFound`.
- Marked tasks as done with `repo.update(filter, { done: true })` and re-fetched the result.
- Filtered the list with `list({ done: false })` using the convention filter object.
- Tested every route via `curl` and learned the next steps.

You went from an empty folder to a complete API, layer by layer. Now pick the next recipe and keep building. ✅
