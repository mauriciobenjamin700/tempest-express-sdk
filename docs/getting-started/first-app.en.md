# Your first app

Time to run a real API — from scratch, one command at a time. By the end of this
page you'll have a live server with **interactive documentation** generated for
you. 🚀

!!! info "Prerequisites"
    You need Node.js **≥ 20** installed. If you don't yet, go back to
    [Installing Node.js](node.md). A little
    [JavaScript/TypeScript](javascript.md) helps, but we'll explain every line.

---

## 1. Create the project folder

In the terminal, create a folder and enter it:

```bash
mkdir my-first-app
cd my-first-app
```

Then start a Node project. The `-y` accepts all the defaults:

```bash
npm init -y
```

This creates a `package.json` file — your project's **manifest**.

---

## 2. Enable modern modules

Open `package.json` and add the line `"type": "module"`. It turns on the
`import`/`export` (ES modules) the SDK uses:

```json hl_lines="5"
{
  "name": "my-first-app",
  "version": "1.0.0",
  "main": "index.js",
  "type": "module"
}
```

!!! note "Why this?"
    Without `"type": "module"`, Node uses the old format (`require`). The SDK
    examples use `import`, so this line avoids an error right away.

---

## 3. Install the SDK and dependencies

```bash
npm install tempest-express-sdk tempest-db-js express zod
```

- **tempest-express-sdk** — the SDK (what this guide teaches).
- **tempest-db-js** — the database layer (a required dependency of the SDK).
- **express** — the underlying HTTP server.
- **zod** — data validation.

Now the tools to run TypeScript directly, with no build step:

```bash
npm install --save-dev tsx typescript @types/node @types/express
```

!!! tip "What is `tsx`?"
    `tsx` runs a `.ts` file **directly**, without you compiling it first.
    Perfect for learning. In production you compile (the SDK handles that for you
    later).

---

## 4. Write the app

Create a file named `app.ts` with this content — it's a **complete** program,
copy the whole thing:

```ts title="app.ts"
import { createApp, createOpenApiRegistry, runServer, z } from "tempest-express-sdk";

// 1. A "registry" holds the schemas that become OpenAPI documentation.
const registry = createOpenApiRegistry();

// 2. Describe the shape of an "item" ONCE, with Zod.
const itemSchema = registry.register(
  "Item",
  z.object({
    id: z.string().uuid(),
    name: z.string(),
  }),
);

// 3. Build the app. `createApp` already wires JSON, CORS, health and errors.
const app = await createApp({
  corsOrigins: "*",
  openapi: { registry, info: { title: "My first app", version: "1.0.0" } },
  configure: (app) => {
    // 4. A route that returns a list (empty, for now).
    app.get("/api/items", (_req, res) => {
      res.json([]);
    });
  },
});

// 5. Start the server.
await runServer(app, { host: "127.0.0.1", port: 8000 });
```

Each block has a job: register the schema, build the app, declare a route, start
the server. Let's run it. ✅

---

## 5. Run it

```bash
npx tsx app.ts
```

You should see something like:

```json
{"level":"info","logger":"tempest_express_sdk.api.server","message":"Server listening","requestId":null,"host":"127.0.0.1","port":8000}
```

The server is live. 🎉

---

## 6. See the magic

Open in your browser:

- **[http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)** — Swagger UI, the
  **interactive** documentation (you can try the routes right there).
- **[http://127.0.0.1:8000/redoc](http://127.0.0.1:8000/redoc)** — Redoc, a more
  "reading-friendly" version.
- **[http://127.0.0.1:8000/openapi.json](http://127.0.0.1:8000/openapi.json)** —
  the raw OpenAPI spec.
- **[http://127.0.0.1:8000/health](http://127.0.0.1:8000/health)** — the health
  check (`{"status":"ok","checks":{}}`).

!!! check "You defined the schema once"
    …and got validation, types **and** documentation for free. That's the whole
    point of the SDK.

To stop the server, go back to the terminal and press ++ctrl+c++.

---

## Shortcut: the generator

Doing it all by hand was great for understanding the pieces. Next time, the SDK
scaffolds a whole project for you:

```bash
npx tempest-express new my-service
cd my-service
npm install
npm run dev
```

That generates the entire layered structure (model → repository → service →
controller → router → app) ready to go.

---

## Recap

- `npm init` + `"type": "module"` + `npm install` set up the project.
- `npx tsx app.ts` runs TypeScript with no build.
- `createApp` gave you Swagger, Redoc, health and error handling effortlessly.
- A Zod schema became interactive documentation automatically.

Now that the base runs, head to the [Tutorial](../tutorial.md) — it adds **one**
concept at a time on top of this start. If you hit a term you don't know, the
[Glossary](glossary.md) explains it. 💡
