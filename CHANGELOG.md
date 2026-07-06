# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres
to [SemVer](https://semver.org/).

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
