# Glossary

A quick dictionary of the terms that show up in the docs. No need to memorize —
come back here whenever you hit a new word. 💡

## Node and JavaScript

**Node.js** — the program that runs JavaScript outside the browser (on the
server). See [Installing Node.js](node.md).

**npm** — Node's package manager. Installs libraries (`npm install`) and runs
scripts (`npm run`).

**Package** — a reusable piece of code published on npm (`tempest-express-sdk` is
one). Listed in `package.json`, downloaded into `node_modules/`.

**Module** — a code file. `import`/`export` move things between modules.

**Promise / `async` / `await`** — a Promise is "a value that arrives later" (a
database query, an HTTP request). `await` waits for it; `async` marks the
function that can wait. See [JS/TS essentials](javascript.md).

**TypeScript (TS)** — JavaScript with types. Catches errors before running and
gives autocomplete. The SDK is written in TS.

## Web and HTTP

**HTTP** — the web's protocol. A client makes a **request**, the server returns a
**response**.

**HTTP method** — the request verb: `GET` (read), `POST` (create), `PUT`/`PATCH`
(update), `DELETE` (remove).

**Route / endpoint** — a path the server answers, like `GET /api/items`.
"Endpoint" = method + path.

**Handler** — the function that answers a route (`(req, res) => { ... }`).

**Status code** — the number that sums up the result: `200` ok, `201` created,
`401` unauthenticated, `403` forbidden, `404` not found, `422` invalid data,
`429` too many requests, `500` server error.

**Middleware** — a function that runs **before** the handlers, in the order it's
registered — to log, authenticate, rate-limit, etc. See
[HTTP hardening](../recipes/hardening.md).

**CORS** — the rule deciding which sites (origins) may call your API from the
browser.

**JSON** — the text format data travels in (`{"name":"Ana"}`).

## The SDK layers

**Model** — the class describing a database table. See
[Database](../recipes/database.md).

**Repository** — the **data-access** layer: create, read, update, delete rows.

**Service** — the **business-logic** layer; calls repositories and maps the raw
row to the response.

**Controller** — the **orchestration** boundary between the route and the
services.

**Router** — groups a domain's routes and registers them on the app.

**Schema / DTO** — the validated shape of data in or out. In the SDK these are
**Zod** schemas. "DTO" = *Data Transfer Object*, the object that enters/leaves the
API.

**Zod** — the validation library. Describe the shape once and get validation
**and** types.

## Database

**ORM** — *Object-Relational Mapping*: talking to the database via objects/classes
instead of raw SQL. Here it's `tempest-db-js`.

**Migration** — a versioned step that evolves the database schema (create table,
add column). See the migrations section in [Database](../recipes/database.md).

**Pagination** — returning results in pages. **Offset** = "page 3 of 12";
**cursor** = "the next 20 after this one" (better for large tables).

**Soft delete** — marking a row inactive (`isActive: false` or `deletedAt`)
instead of really deleting it.

**Multi-tenant** — many customers ("tenants") sharing the same tables, told apart
by a `tenantId`. See [Advanced database](../recipes/database-advanced.md).

## Authentication and security

**Authentication** — proving **who** you are (login). **Authorization** — deciding
what you **may** do (roles).

**JWT** — *JSON Web Token*: a signed token carrying the user's identity across
requests. See [Authentication](../recipes/auth.md).

**Hash** — a one-way transformation of a password; you store the hash, never the
plaintext. The SDK uses bcrypt.

**MFA / TOTP** — a second authentication factor; TOTP is the 6-digit code that
changes every 30s (Google Authenticator).

**Rate limit** — capping how many requests a key (IP/user) can make per time
window.

**CSRF** — an attack that uses the victim's browser to trigger authenticated
actions; the defense is the *double-submit cookie*.

**Idempotency** — resending the same request (same `Idempotency-Key`) without
duplicating the effect (a second charge, a second order).

**Webhook** — when another service calls **your** API to signal an event; the HMAC
signature proves it came from who it claims. See
[OAuth and webhooks](../recipes/oauth-webhooks.md).

**OAuth / OIDC** — social login ("sign in with Google/GitHub").

## Infra and real-time

**Cache** — storing expensive results to answer fast later (Redis).

**Queue / broker** — messages processed asynchronously; the *broker* (RabbitMQ)
delivers them. See [Cache, queue and tasks](../recipes/jobs.md).

**SSE / WebSocket** — real-time channels: SSE is server→client; WebSocket is
both ways. See [Real-time](../recipes/realtime.md).

**Feature flag** — a switch that turns a feature on/off with no new deploy.

**Storage / upload** — where uploaded files live (local disk, S3/MinIO).

**Environment variable / settings** — configuration coming from the environment
(`process.env`), not the code. See [Configuration](../recipes/settings.md).

**OpenAPI / Swagger / Redoc** — OpenAPI is your API's **spec**; Swagger UI and
Redoc are pages that display it (one interactive, one for reading).

**Health check** — an endpoint (`/health`) that reports whether the service is up.

---

Didn't find a term? Open an issue on the
[repository](https://github.com/mauriciobenjamin700/tempest-express-sdk) — we'll
add it. 🙌
