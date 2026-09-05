# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres
to [SemVer](https://semver.org/).

## [0.24.0] — 2026-09-05

### Added

- **admin**: a **server-rendered admin panel** — the Django-style operator UI
  the FastAPI SDK ships, now in this SDK. `AdminSite` holds the registry,
  `AdminModel` configures one model, and `makeAdminRouter(site, { engine,
  authBackend, secretKey })` mounts login, dashboard, list views (search,
  per-column-type filters, sortable columns, pagination) and auto-derived
  create/edit/delete forms under `/admin`.

  Widgets, filters and validation are derived from `tempest-db-js` column
  metadata (`columnsOf`), not from a second schema the project has to keep in
  sync: an `enum` column becomes a `<select>` of its members, a `datetime`
  column a `datetime-local` input and a from/to filter pair, a `varchar(>255)`
  a textarea. `AdminModel.automap` registers a whole models barrel at once and
  skips the abstract bases.

  Nothing new is installed: the HTML and the ~32 KB stylesheet (ported verbatim
  from `tempest-fastapi-sdk`) are strings in this package, the session is signed
  with `node:crypto`, and passwords go through the existing `PasswordUtils`.
  There is no template engine and no framework JavaScript — the responsive
  off-canvas sidebar is pure CSS.

- **admin**: `UserModelAuthBackend` authenticates against a `BaseUserModel`
  subclass, admitting only rows that are `isActive` **and** `isAdmin`. Pass an
  `AdminMfaVerifier` and a principal who enrolled TOTP is sent through
  `/admin/mfa` after the password, so the panel can never be the weaker door
  into an MFA-protected account.

- **admin**: `AdminSessionStore` issues stateless signed-cookie sessions
  (HMAC-SHA256, `HttpOnly`, `SameSite=Lax`, `Secure` by default) carrying the
  CSRF token every write form echoes back. A secret shorter than 32 characters
  is refused at construction. `AdminTheme` restyles the panel through typed
  fields injected as CSS custom properties, rejecting values that would break
  out of the injected `<style>` block.

### Changed

- **BREAKING — admin**: the JSON admin was renamed so the HTML panel could take
  the names it has in `tempest-fastapi-sdk`. `AdminSite` → `AdminJsonSite`,
  `makeAdminRouter` → `makeAdminJsonRouter`, and the types took the same infix
  (`AdminResource` → `AdminJsonResource`, `AdminField` → `AdminJsonField`,
  `AdminListQuery`/`AdminListResult` → `AdminJsonListQuery`/`AdminJsonListResult`,
  `AdminRouterOptions` → `AdminJsonRouterOptions`).

  No deprecated alias is possible here: the old and new meanings collide on the
  same identifier. Update the import and the constructor call — the behaviour,
  the routes and the default `/admin` prefix are unchanged. Mounting the panel
  and the JSON admin in one app now means giving one of them a different
  `prefix`.

- **deps**: the `tempest-db-js` peer floor moves to `>=0.8.0` (dev dependency
  and CLI scaffold to `^0.8.0`), keeping consumers on the current DB foundation.

### Fixed

- **admin**: a blank create form now pre-fills each column's literal default, so
  submitting it untouched writes what the database would have written. Without
  it a `default(true)` flag arrived as `false` — the panel silently deactivated
  every row it created. Caught in a real browser, not by the type-checker.

- **admin**: the detail view renders **every** column, no longer narrowed by
  `listDisplay`. The list view is a scannable summary; trimming the detail view
  the same way hid data with nowhere else to read it.

## [0.23.0] — 2026-08-30

### Added

- **api**: `mountSwaggerUi` and `mountRedoc` now emit a `<link rel="icon">`,
  defaulting to `DEFAULT_DOCS_FAVICON` — a small inline SVG `data:` URI. Without
  one the browser requests `/favicon.ico` at the **origin root**, which on an
  API-only service is a 404, a 401 behind the auth middleware, or an SPA
  catch-all: a red console error on every visit to `/docs`. `SwaggerOptions` and
  `RedocOptions` take `favicon?: string | false`; `false` omits the tag. Closes #7.

- **api**: `mountRedoc` serves the renderer **from the service** when the new
  optional peer `redoc` is installed, so the reference page works on a closed
  network. New `RedocOptions.bundle`: `"auto"` (default — local when available,
  CDN otherwise), `"local"` (throws at mount time when `redoc` is missing, so an
  air-gapped deploy cannot silently degrade into a CDN request) and `"cdn"`.
  `RedocOptions.bundlePath` serves a vendored copy; `scriptUrl` still wins over
  both.

  `redoc` is an **optional peer**, not a dependency: the package pulls 22
  dependencies and peers on `react`, `react-dom`, `styled-components`, `mobx`
  and `core-js` — bounds no backend service should inherit just to render a
  reference page. Consumers who want offline Redoc opt in with
  `npm install redoc`; everyone else pays nothing.

- **api**: `SwaggerOptions.ui` — a passthrough merged into the `SwaggerUIBundle`
  constructor, so any Swagger UI option JSON can carry is reachable without the
  SDK modelling each one. Three defaults now differ from Swagger UI's own:
  `layout` is `"BaseLayout"` instead of `"StandaloneLayout"` (the standalone
  layout renders the **Explore** topbar, an editable URL field that loads any
  spec from any origin — the point of the Swagger editor, the wrong surface for
  a page documenting one service), and `deepLinking` and `persistAuthorization`
  are `true` (a linkable operation, and credentials that survive a reload).
  `ui: { layout: "StandaloneLayout" }` restores the old page, standalone preset
  script included. `supportedSubmitMethods` keeps Swagger UI's default, so
  **Try it out** still executes every verb until a caller narrows it — which is
  now possible for an API whose calls are irreversible. A function passed in
  `ui` throws at mount time instead of being dropped silently by the JSON
  serialization. Closes #8.

- **api**: new exports `DEFAULT_DOCS_FAVICON`, `REDOC_CDN_URL`,
  `resolveRedocBundle` and the `RedocBundleSource` type.

### Fixed

- **api**: the Redoc page no longer renders **blank** when the bundle fails to
  load. A blocked CDN, a restrictive CSP or a wrong `scriptUrl` meant
  `Redoc.init` never ran and the page came up empty, which reads as a broken
  service. It now names the URL that failed, confirms the OpenAPI document is
  still served, and says how to fix it.

- **api**: page titles and favicon URLs are HTML-escaped, and values inlined
  into `<script>` escape `<`. A title read from configuration could previously
  close the `<title>` element and inject markup.

### Docs

- The API recipe gains **Favicon**, **Configuring Swagger UI** and **Offline
  Redoc** sections (bilingual),
  with the `bundle` table, the air-gapped warning and an honest note that Redoc
  still fetches its own `cdn.redoc.ly` watermark from inside its bundle.

## [0.22.0] — 2026-08-30

### Fixed

- **BREAKING (behaviour) — schemas**: `?ascending=false` now actually sorts
  descending. `paginationFilterSchema.ascending`,
  `cursorPaginationFilterSchema.ascending` and `syncFilterSchema.includeDeleted`
  were built on `z.coerce.boolean()`, which is `Boolean(input)` — every non-empty
  string is `true`, `"false"` and `"0"` included — so there was **no way to send
  `false` over the wire**. They now use the new `looseBoolean`. Closes #4.

- **BREAKING (behaviour) — settings**: `DEBUG=false` now disables debug. The
  `DEBUG` field of `serverSettingsShape` had the same `z.coerce.boolean()`
  defect, so any non-empty value — `"false"` included — turned debug on.

### Added

- **schemas**: `looseBoolean(defaultValue)` — the boolean field for values that
  arrive as text (query strings, environment variables). Reads
  `true`/`1`/`yes`/`on`/`y`/`enabled` and `false`/`0`/`no`/`off`/`n`/`disabled`,
  case-insensitively and trimmed; treats an empty or whitespace-only value as
  absent (so an unset `.env` entry falls back to the default); passes real
  booleans through; and **rejects** anything else, so a typo surfaces as a
  validation error instead of silently becoming `false`. Built on zod 4's
  `z.stringbool()`. Its OpenAPI metadata is pinned to `type: boolean` with the
  default, so the document describes what the client sends rather than the union
  used to parse it.

### Changed

- **BREAKING (behaviour) — settings**: `envBoolean` is now `looseBoolean` under
  the settings-facing name — one implementation shared with the query filters,
  instead of two token lists that drift. Same signature, and every previously
  accepted token still parses the same way. Two behaviours change: an
  **unrecognised token is now a `ZodError`** rather than a silent `false`, and an
  **empty variable** (`SMTP_USE_TLS=`) now falls back to the field default
  instead of being read as `false`. Both make wrong environment config fail at
  boot rather than degrade quietly. Affects every boolean settings field:
  `LOG_JSON`, `SMTP_USE_TLS`, `SMTP_USE_SSL`, `MINIO_SECURE`, `SESSION_*`,
  `AUTH_*`.

### Docs

- New section **`looseBoolean` — the boolean that arrives as text** in the
  validated-fields recipe (bilingual), with the token table and the OpenAPI note.
- The settings recipe's `envBoolean` section documents the rejection of unknown
  tokens and the empty-variable rule, and links to `looseBoolean`.

## [0.21.0] — 2026-08-30

### Changed

- **BREAKING — deps**: `zod` moved from a direct **dependency** to a required
  **peer dependency** at `^4.0.0`, and `@asteasolutions/zod-to-openapi` was
  bumped `^7.3.0` → `^9.1.0`. Install `zod@^4` alongside the SDK
  (`npm install zod@^4`). See the [zod 4 migration guide](https://mauriciobenjamin700.github.io/tempest-express-sdk/migration/zod-4/).

  Why: as a direct dependency the SDK shipped its own copy of zod. A project on
  zod 4 ended up with **two instances** in `node_modules`, and since
  `zod-to-openapi` works by patching the `ZodType` prototype, it patched the
  SDK's zod 3 — not the project's zod 4. Registering a project schema then failed
  with `TypeError: zodSchema.openapi is not a function`, and patching the project
  instance by hand only moved the failure to
  `UnknownZodTypeError: Unknown zod object type`. As a peer dependency there is
  exactly one instance, shared by the SDK and the consumer, so `instanceof
  ZodType` and the prototype patch both cross the boundary. Closes #2.

- **schemas**: internal schemas migrated to zod 4 idioms — `z.uuid()`,
  `z.email()`, `z.url()` (the `z.string().uuid()` chain is deprecated in zod 4),
  `z.record(z.string(), z.unknown())` (the key type is now required) and
  `.loose()` in place of the deprecated `.passthrough()`. `z.ZodTypeAny` in the
  public generic signatures of `paginationSchema`, `cursorPaginationSchema`,
  `syncPaginationSchema`, `loadSettings` and `AdminResource` is now `z.ZodType`.
  The zod 3 spellings still parse, so consumer schemas keep working.

- **cli**: the scaffold template now pins `zod@^4.0.0`.

### Added

- **tests**: `tests/zod-instance.test.ts` — a regression guard proving the SDK's
  `z` **is** the consumer's `zod` instance, that `.openapi()` is present on it,
  and that a document generates from schemas built with a bare `import { z } from
  "zod"`.

### Docs

- New page **Migração para zod 4** (bilingual) — the breaking change, the
  before/after install, the API renames and the "two instances" diagnostic.

## [0.20.1] — 2026-07-09

### Changed

- **deps**: bump `tempest-db-js` to `>=0.4.0` (peer), `^0.4.0` (dev) and the CLI
  scaffold template. No API changes; build and full suite green on 0.4.0.

### Fixed

- **api**: Swagger UI now loads its assets when visited at `/docs` (no trailing
  slash), not only `/docs/`. The bootstrap HTML referenced assets with a
  relative path (`./assets/…`), which the browser resolved against `/docs` to
  `/assets/…` — a 404 that left the UI blank/unstyled. Asset URLs are now
  **absolute** (`/docs/assets/…`) and resolve correctly at both paths.

### Docs

- New recipe **Schemas (base, response and pagination)** — `toDict`,
  `baseResponseSchema`, the Create/Update/Response pattern, and offset vs cursor
  pagination.
- New recipe **API: `createApp`, OpenAPI, Swagger and Redoc** — full `createApp`
  option reference, the `configure` hook, and the 3-step OpenAPI wiring (registry
  → `register`/`registerPath` → `openapi`). Bilingual (PT-BR + EN-US).

## [0.20.0] — 2026-07-06

### Added

- **db**: `wrapWithSlowQueryLog` — wraps an `AsyncDriver` to log statements at or
  above a threshold (timing at the driver boundary, since `tempest-db-js`'s
  `onQuery` has no duration); times reserved-transaction statements too.
- **db**: `backupDatabase(url, dest)` — dialect-aware backup (`pg_dump` for
  PostgreSQL, file copy for SQLite; in-memory refused).
- **auth**: `renderAuthResultPage` and `renderPasswordResetFormPage` — optional,
  self-contained, theme-aware, XSS-escaped HTML pages for email-link landings
  (activation result, password-reset form).

This closes the parity roadmap; the only open item (a slow-query timing hook in
`createEngine`) is upstream in `tempest-db-js`.

## [0.19.0] — 2026-07-06

### Added

- **storage**: `S3UploadStorage` — the `UploadStorage` contract over a MinIO/S3
  client (`minio`, an optional peer, lazy-loaded; or inject your own). Swaps with
  `LocalUploadStorage` without touching call sites.
- **cli**: `tempest-express lint` (runs Biome check), `config` (prints the
  resolved base settings, reading `.env`), and `user --email --password [--admin]`
  (prints a ready-to-insert user record with a bcrypt hash).

## [0.18.0] — 2026-07-06

### Added

- **utils**: `sendFileDownload` (range-aware disk streaming → `206`),
  `sendBytesDownload` and traversal-safe `resolveDownloadPath` (`utils.download`).
- **utils**: `configureFileLogging` — routes every `JSONLogger` record to
  per-level files + a dedicated `500.log`; `LEVEL_LOG_FILES` / `HTTP_500_LOG_FILE`.
- **core**: `addLogSink` / `LogSink` — register a sink invoked for every emitted
  record (what `configureFileLogging` builds on).
- **api**: `makeLogsRouter` — a guardable, paginated read endpoint over the log
  files (`source` ∈ all/debug/info/warning/error/500).

## [0.17.0] — 2026-07-06

### Added

- **schemas**: validated Zod field types mirroring `utils.fields` —
  `positiveIntField`, `nonNegativeIntField`, `centsField`, `portField`,
  `ratingField`, `positiveFloatField`, `nonNegativeFloatField`, `percentField`,
  `ratioField`, `latitudeField`, `longitudeField`, `nonEmptyStrField`,
  `slugField`, `hexColorField`, `priceField`.
- **schemas**: delta-sync pagination (`syncFilterSchema` / `syncPaginationSchema`)
  for offline-first clients, keyed on the server clock.
- **schemas**: `buildPaginationLinkHeader` — an RFC-5988 `Link` header
  (first/prev/next/last) for offset pagination.
- **schemas**: `logEntrySchema` — the structured log-record shape (open, so
  `extra` keys pass through).

## [0.16.0] — 2026-07-06

### Added

- **api**: OAuth2/OIDC clients mirroring `api.oauth` — `GoogleOAuthClient`,
  `GitHubOAuthClient`, generic `OIDCProvider` (authorize URL → code exchange →
  userinfo), `generateOAuthState`, `OAuthUser`/`OAuthTokens`/`OAuthError`.
- **api**: `WebhookSignatureVerifier` (`api.webhooks`) — constant-time HMAC
  verification of an inbound webhook signature over the raw body, with hex/base64
  encodings, an optional prefix, and an Express middleware.
- **api**: `makeToolSpecRouter` (`api.routers.tool_spec`) — a root-prefix
  capability manifest endpoint accepting a static object or a sync/async provider.

## [0.15.0] — 2026-07-06

### Added

- **db**: advanced database layer mirroring `db.tenant` / `db.audit` /
  `db.outbox` / `db.user_model` — `TenantScopedRepository` (per-tenant read
  filtering + write stamping, cross-tenant `getById` throws), `BaseOutboxModel` +
  `OutboxRelay` (transactional outbox with at-least-once delivery, retry
  backoff), `BaseAuditLogModel` + `snapshot` / `diffSnapshots` (who-changed-what
  audit trail), and opt-in base models `BaseUserModel`, `BaseUserTokenModel`,
  `BaseUserRefreshTokenModel` (+ `UserTokenPurpose`, `AuditAction`,
  `OutboxStatus`).

## [0.14.0] — 2026-07-06

### Added

- **testing**: framework-agnostic in-memory test-database helpers mirroring the
  Python `testing` module — `createTestDatabase(models)` stands up a
  `tempest-db-js` engine over in-memory SQLite with tables reflected from the
  models (one shared connection backs the DDL and every session), returning
  `{ engine, session(), close() }`; `withTestDatabase(models, fn)` scopes it to a
  block and always disposes. No temp files, no migrations, no external service.

## [0.13.0] — 2026-07-06

### Added

- **api/middlewares**: HTTP hardening middlewares mirroring `api.middlewares` —
  `rateLimitMiddleware` (sliding window; `MemoryRateLimitStore` +
  `RedisRateLimitStore`; `keyByIp` / `keyByHeader` / `keyByJwtClaim` /
  `keyByJwtSubject`), `bodySizeLimitMiddleware` (413 on oversize),
  `csrfMiddleware` + `generateCsrfToken` (double-submit cookie),
  `idempotencyMiddleware` (`MemoryIdempotencyStore` + `RedisIdempotencyStore`),
  `GracefulShutdown` (drain in-flight requests → 503), `requestTracingMiddleware`
  (structured access log) and `prometheusMiddleware` / `HttpMetrics`
  (per-request counter + latency histogram).

### Changed

- **api**: `requestIdMiddleware` now validates the inbound `X-Request-ID`
  against a printable-ASCII whitelist before reusing it (prevents CRLF/log
  injection via a spoofed header); malformed values get a fresh UUID.

## [0.12.0] — 2026-07-06

### Added

- **settings**: composable domain settings fragments mirroring the
  `tempest-fastapi-sdk` mixins — `authSettingsShape`, `jwtSettingsShape`,
  `emailSettingsShape`, `redisSettingsShape`, `rabbitmqSettingsShape`,
  `sessionSettingsShape`, `uploadSettingsShape`, `minioSettingsShape`,
  `webPushSettingsShape`, `webSocketSettingsShape`, `logSettingsShape`,
  `tokenSettingsShape` (same env var names + defaults). Plus `envBoolean`
  (parses `"false"` as `false`, unlike `z.coerce.boolean()`) and `envList`
  (CSV → `string[]`) helpers.

### Fixed

- **cli**: the `new` scaffold pinned `tempest-express-sdk` at `^0.1.0`, which
  cannot resolve a `0.12.x` release. Bumped to `^0.12.0`.

### Docs

- **recipes/settings**: new bilingual guide for composing typed settings.
- **recipes/database**: new bilingual guide (models + repositories) teaching
  `BaseModel` + the `column` factory, the engine, `BaseRepository`, convention
  filters, pagination, opt-in soft-delete/audit columns, the
  `repository → service → controller` stack, and `tempest-db` migrations — the
  faithful port of the `tempest-fastapi-sdk` "Banco de dados" recipe.

## [0.11.0] — 2026-07-02

### Added

- **integrations**: `broadcastText` (fan a message out to many recipients with
  bounded concurrency + per-recipient results) and `MessagingHub` (named
  providers with `send`/`broadcast` by channel).

## [0.10.0] — 2026-07-02

### Added

- **integrations**: `EmailProvider` — a `MessagingProvider` over `EmailUtils`, so
  email joins the WhatsApp/Telegram/SMS contract.
- **auth**: MFA at login. With an `MfaService` wired into `UserAuthService`,
  `login` returns `{ mfaRequired, mfaToken }` for enrolled users; complete it via
  `verifyMfaChallenge` / `POST /auth/mfa/challenge`.

## [0.9.0] — 2026-07-02

### Added

- **metrics**: optional GPU metrics via `nvidia-smi` (`MetricsUtils.gpus`, GPU
  gauges in `toPrometheus`) and `makeMetricsRouter` — a guardable `/metrics`
  Prometheus endpoint.

## [0.8.0] — 2026-07-02

### Added

- **sessions**: `RedisSessionStore` — a Redis-backed `SessionStore` (per-user
  index, TTL, lazy prune) for multi-replica deployments.
- **sse**: `RedisSSEBroker` — cross-replica SSE fan-out over Redis pub/sub
  (injected publisher + dedicated subscriber connection).

### Changed

- Bumped the `tempest-db-js` peer to `>=0.3.0` (track the latest).

## [0.7.0] — 2026-07-02

### Added

- **auth flows**: `MfaService` (TOTP enroll/confirm/verify/disable),
  `ActivationService` (email activation) and `PasswordResetService` (reset with
  anti-enumeration), each over a dedicated store port. `makeAuthRouter` now
  mounts `POST /auth/activate`, `/auth/password-reset/{request,confirm}` and
  guarded `/auth/mfa/{enroll,confirm,disable}` when the services are provided.

## [0.6.0] — 2026-07-02

### Added

- **integrations**: `TelegramProvider` (Bot API — send + `getUpdates`
  long-polling inbound) and `TwilioSmsProvider` (SMS send) +
  `makeTwilioWebhookRouter` with `X-Twilio-Signature` validation
  (`validateTwilioSignature`). `MessagingProvider.onMessage`/`checkNumber` are
  now optional so channels without a live subscription fit the contract.

## [0.5.0] — 2026-07-02

### Added

- **admin**: a JSON admin API — `AdminSite` resource registry + `makeAdminRouter`
  with auto-derived CRUD (`list`/`get`/`create`/`update`/`remove`), `_meta` field
  introspection, Zod validation and a pluggable `guard` for auth. Callback-based
  resources wire to any service/store; the UI stays decoupled.

## [0.4.0] — 2026-07-02

### Added

- **integrations**: a channel-agnostic `MessagingProvider` contract and
  `WhatsAppProvider` — a typed client for the `zap-api` service (REST send +
  session control, `/ws` inbound subscription over the optional `ws` peer),
  plus `makeWhatsAppWebhookRouter` for the inbound webhook and the
  `InboundMessage` schema.

## [0.3.0] — 2026-07-02

### Added

- **utils**: `getClientIp` (trusted-header resolution), `TOTPHelper` (native
  RFC 6238 MFA — no external dep), `HTTPClient` + `RetryPolicy` +
  `CircuitOpenError` (resilient `fetch`), `MetricsUtils` (CPU/memory/uptime +
  Prometheus exporter), `EmailUtils` (optional `nodemailer` peer).
- **webpush**: `WebPushDispatcher` (optional `web-push` peer), `WebPushError` /
  `WebPushGoneError`, and subscription/payload Zod schemas.
- **docs**: recipe "MFA, HTTP client, Web Push and more" (PT + EN) and a Roadmap
  page describing the planned `integrations/` module (WhatsApp via `zap-api`).

## [0.2.0] — 2026-06-29

### Added

- **cache**: `CacheManager` interface, `MemoryCacheManager`, `RedisCacheManager`
  (node-redis compatible) and the `cached` read-through memoization helper.
- **sessions**: `Session` model, `SessionStore` + `MemorySessionStore`,
  `SessionService` (opaque cookie hashed at rest) and `makeSessionMiddleware`.
- **sse**: `ServerSentEvent`, `EventStream` (heartbeat), `SSEBroker` and the
  `sseResponse` Express helper.
- **websockets**: transport-agnostic `WebSocketHub` (per-user delivery, topics,
  broadcast, per-user cap), `WSEnvelope`, and `attachWebSocketHub` over the
  optional `ws` peer.
- **queue**: `BrokerManager` interface, `MemoryBroker` and `RabbitBroker`
  (optional `amqplib` peer).
- **tasks**: `TaskManager` — register/enqueue/worker background jobs riding on
  any `BrokerManager`.
- **flags**: `FeatureFlags` with `Memory`/`Env`/`Composite` backends, `coerceFlag`
  and the `makeFlagGuard` route guard.
- **storage**: `UploadStorage` interface, `LocalUploadStorage` (filesystem) and
  `buildContentDisposition`.

## [0.1.0] — 2026-06-29

### Added

- **Foundation**: strict TypeScript tooling, `@` alias (no `.js`), dual
  ESM + CJS + `.d.ts` build (tsup), Biome and Vitest.
- **core**: `JSONLogger`, request-id context (`AsyncLocalStorage`), `defineEnum`.
- **exceptions**: `AppException` + HTTP subclasses (`Conflict`, `NotFound`,
  `Unauthorized`, `Forbidden`, `Validation`, `TooManyRequests`, `InvalidToken`,
  `ExpiredToken`), `MessageCatalog` (i18n) and `registerExceptionHandlers`.
- **schemas**: OpenAPI-augmented `z`, `baseResponseSchema`, offset + cursor pagination.
- **settings**: `loadSettings`, `baseAppSettingsShape`.
- **db**: re-exports `tempest-db-js`, `BaseModel` and column helpers.
- **services / controllers**: `BaseService`, `BaseController`.
- **utils**: CPF/CNPJ/CEP/phone/UF + cities, datetime, dict, opaque tokens,
  `AttemptThrottle`, `PasswordUtils` (bcrypt), `JWTUtils`.
- **auth**: schemas, `UserAuthService`, JWT middleware, role guards,
  `makeAuthRouter`.
- **api**: `createApp`, `runServer`, native Swagger UI + Redoc, health.
- **CLI**: `new`, `generate`, `secret`, `docker-compose`, `db`.

### Pending

Not yet ported from `tempest-fastapi-sdk`: sessions, cache (Redis), queue
(RabbitMQ), tasks, webpush, websockets, feature flags, object storage, metrics,
admin, SSE, and the MFA / email / password-reset flows.
