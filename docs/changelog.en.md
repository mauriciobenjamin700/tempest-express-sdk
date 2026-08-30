# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres
to [SemVer](https://semver.org/).

!!! info "Full history"
    This page lists recent highlights. The full version-by-version history
    (0.2.0–0.11.0) lives in the repository's
    [`CHANGELOG.md`](https://github.com/mauriciobenjamin700/tempest-express-sdk/blob/main/CHANGELOG.md).

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
  (`npm install zod@^4`) — step by step in
  [Migrating to zod 4](migration/zod-4.md).

  Why: as a direct dependency the SDK shipped its own copy of zod. A project on
  zod 4 ended up with **two instances** in `node_modules`, and since
  `zod-to-openapi` works by patching the `ZodType` prototype, it patched the
  SDK's zod 3 — not the project's zod 4. Registering a project schema then failed
  with `TypeError: zodSchema.openapi is not a function`, and patching the project
  instance by hand only moved the failure to
  `UnknownZodTypeError: Unknown zod object type`. As a peer dependency there is
  exactly one instance, shared, so `instanceof ZodType` and the prototype patch
  both cross the package boundary. Closes #2.

- **schemas**: internal schemas migrated to zod 4 idioms — `z.uuid()`,
  `z.email()`, `z.url()` (the `z.string().uuid()` chain is deprecated in zod 4),
  `z.record(z.string(), z.unknown())` (the key type is now required) and
  `.loose()` in place of the deprecated `.passthrough()`. `z.ZodTypeAny` in the
  public signatures of `paginationSchema`, `cursorPaginationSchema`,
  `syncPaginationSchema`, `loadSettings` and `AdminResource` is now `z.ZodType`.
  The zod 3 spellings still parse, so consumer schemas keep working.

- **cli**: the scaffold template now pins `zod@^4.0.0`.

### Added

- **tests**: `tests/zod-instance.test.ts` — a regression guard proving the SDK's
  `z` **is** the consumer's `zod` instance, that `.openapi()` is present on it,
  and that a document generates from schemas built with a bare
  `import { z } from "zod"`.

### Docs

- New page **Migrating to zod 4** (bilingual) — the breaking change, the
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
  **absolute** (`/docs/assets/…`) and resolve at both paths.

### Docs

- New recipe **[Schemas (base, response and pagination)](recipes/schemas.md)** —
  `toDict`, `baseResponseSchema`, the Create/Update/Response pattern, and offset
  vs. cursor pagination.
- New recipe **[API: `createApp`, OpenAPI, Swagger and Redoc](recipes/api.md)** —
  full `createApp` option reference, the `configure` hook, and the 3-step OpenAPI
  wiring.

## [0.20.0] — 2026-07-06

### Added

- **db**: `wrapWithSlowQueryLog` (slow-query logging via a driver wrap) and
  `backupDatabase` (dialect-aware: `pg_dump` / SQLite copy). **auth**:
  `renderAuthResultPage` / `renderPasswordResetFormPage` (optional HTML pages).

## [0.19.0] — 2026-07-06

### Added

- **storage**: `S3UploadStorage` (same `UploadStorage` interface over MinIO/S3,
  optional `minio` peer). **cli**: `lint`, `config` and `user`.

## [0.18.0] — 2026-07-06

### Added

- **utils**: `sendFileDownload` (Range/206), `sendBytesDownload`,
  `resolveDownloadPath` (traversal-safe) and `configureFileLogging` (per-level
  files + `500.log`); **core** `addLogSink`; **api** `makeLogsRouter`.

## [0.17.0] — 2026-07-06

### Added

- **schemas**: validated field types (`centsField`, `priceField`, `slugField`,
  `hexColorField`, `percentField`, `latitudeField`, …), delta-sync pagination
  (`syncFilterSchema` / `syncPaginationSchema`), `buildPaginationLinkHeader`
  (RFC-5988) and `logEntrySchema`.

## [0.16.0] — 2026-07-06

### Added

- **api**: OAuth2/OIDC clients (`GoogleOAuthClient`, `GitHubOAuthClient`,
  `OIDCProvider`) + `generateOAuthState`, `WebhookSignatureVerifier`
  (constant-time HMAC over the raw body) and `makeToolSpecRouter` (a `/tool-spec`
  manifest endpoint).

## [0.15.0] — 2026-07-06

### Added

- **db**: advanced layer — `TenantScopedRepository` (multi-tenant isolation),
  `BaseOutboxModel` + `OutboxRelay` (transactional outbox), `BaseAuditLogModel` +
  `snapshot`/`diffSnapshots` (audit trail) and opt-in base models `BaseUserModel`
  / `BaseUserTokenModel` / `BaseUserRefreshTokenModel`.

## [0.14.0] — 2026-07-06

### Added

- **testing**: framework-agnostic in-memory test-database helpers —
  `createTestDatabase(models)` stands up a `tempest-db-js` engine over in-memory
  SQLite with tables reflected from the models; `withTestDatabase(models, fn)`
  scopes it to a block and always disposes.

## [0.13.0] — 2026-07-06

### Added

- **api/middlewares**: HTTP hardening middlewares — `rateLimitMiddleware`
  (sliding window; memory + Redis stores; key by IP/header/JWT),
  `bodySizeLimitMiddleware` (413), `csrfMiddleware` + `generateCsrfToken`,
  `idempotencyMiddleware` (memory + Redis stores), `GracefulShutdown`,
  `requestTracingMiddleware` and `prometheusMiddleware` / `HttpMetrics`.

### Changed

- **api**: `requestIdMiddleware` validates the inbound `X-Request-ID` against an
  ASCII whitelist before reusing it (prevents CRLF/log injection).

## [0.12.0] — 2026-07-06

### Added

- **settings**: composable domain settings fragments mirroring the
  `tempest-fastapi-sdk` mixins — `authSettingsShape`, `jwtSettingsShape`,
  `emailSettingsShape`, `redisSettingsShape`, `rabbitmqSettingsShape`,
  `sessionSettingsShape`, `uploadSettingsShape`, `minioSettingsShape`,
  `webPushSettingsShape`, `webSocketSettingsShape`, `logSettingsShape`,
  `tokenSettingsShape` (same env var names + defaults). Plus `envBoolean`
  (parses `"false"` as `false`) and `envList` (CSV → `string[]`) helpers.

### Docs

- **recipes/settings**: new bilingual guide for typed settings.
- **recipes/database**: new bilingual guide (models + repositories).

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

Not yet ported from `tempest-fastapi-sdk`: sessions, cache (Redis),
queue (RabbitMQ), tasks, webpush, websockets, feature flags, storage, metrics,
admin, SSE, and the MFA / email / password-reset flows.
