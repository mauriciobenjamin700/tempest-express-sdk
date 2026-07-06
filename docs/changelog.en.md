# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres
to [SemVer](https://semver.org/).

!!! info "Full history"
    This page lists recent highlights. The full version-by-version history
    (0.2.0–0.11.0) lives in the repository's
    [`CHANGELOG.md`](https://github.com/mauriciobenjamin700/tempest-express-sdk/blob/main/CHANGELOG.md).

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
