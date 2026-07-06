# Roadmap

## Shipped

- **0.1.0** — foundation: core, exceptions (+i18n), schemas, pagination,
  settings, `BaseModel`, repository/service/controller, `createApp` +
  Swagger/Redoc, health, CLI (`new`), bilingual docs.
- **0.2.0** — cache, sessions, SSE, WebSockets, queue (RabbitMQ), background
  tasks, feature flags, object storage.
- **0.3.0** — client-IP resolution, TOTP (MFA), resilient HTTP client
  (retry + circuit breaker), system metrics (+ Prometheus), Web Push, email.
- **0.4.0** — `integrations/`: `MessagingProvider` contract + `WhatsAppProvider`
  (typed `zap-api` client, REST + `/ws`) + `makeWhatsAppWebhookRouter`.
- **0.5.0** — `admin/`: JSON admin API (`AdminSite` + `makeAdminRouter`) with
  auto-derived CRUD, `_meta` introspection, Zod validation and a pluggable guard.
- **0.6.0** — `integrations/`: `TelegramProvider` (Bot API, send + polling) and
  `TwilioSmsProvider` (SMS) + `makeTwilioWebhookRouter` (signature-validated).
- **0.7.0** — auth flows: `MfaService` (TOTP), `ActivationService` (email) and
  `PasswordResetService`, wired into `makeAuthRouter`.
- **0.8.0** — Redis stores: `RedisSessionStore` and `RedisSSEBroker` (pub/sub)
  for multi-replica deployments.
- **0.9.0** — metrics: optional GPU metrics (`nvidia-smi`) + `makeMetricsRouter`
  (`/metrics` Prometheus endpoint).
- **0.10.0** — `EmailProvider` (email as a `MessagingProvider`) and MFA at login
  (challenge flow in `UserAuthService` + `POST /auth/mfa/challenge`).
- **0.11.0** — broadcast helpers: `broadcastText` (bounded-concurrency fan-out)
  and `MessagingHub` (named channels with `send`/`broadcast`).
- **0.12.0** — typed settings fragments: domain shapes (`authSettingsShape`,
  `jwtSettingsShape`, `emailSettingsShape`, `redisSettingsShape`,
  `rabbitmqSettingsShape`, `sessionSettingsShape`, `uploadSettingsShape`,
  `minioSettingsShape`, `webPushSettingsShape`, `webSocketSettingsShape`,
  `logSettingsShape`, `tokenSettingsShape`) + `envBoolean`/`envList` helpers.
- **0.13.0** — HTTP hardening middlewares: `rateLimitMiddleware` (memory + Redis
  stores, IP/header/JWT keys), `bodySizeLimitMiddleware`, `csrfMiddleware`,
  `idempotencyMiddleware` (memory + Redis), `GracefulShutdown`,
  `requestTracingMiddleware`, `prometheusMiddleware`/`HttpMetrics`.
- **0.14.0** — testing helpers: `createTestDatabase(models)` +
  `withTestDatabase` — in-memory SQLite engine with tables reflected from models.
- **0.15.0** — advanced DB: `TenantScopedRepository`, `BaseOutboxModel` +
  `OutboxRelay`, `BaseAuditLogModel` + `snapshot`/`diffSnapshots`, and base
  `BaseUserModel` / `BaseUserTokenModel` / `BaseUserRefreshTokenModel` models.
- **0.16.0** — OAuth2/OIDC clients (`GoogleOAuthClient`, `GitHubOAuthClient`,
  `OIDCProvider`), `WebhookSignatureVerifier`, and `makeToolSpecRouter`.
- **0.17.0** — schema extras: validated field types (`centsField`/`priceField`/
  `slugField`/…), delta-sync pagination (`syncFilterSchema`/`syncPaginationSchema`),
  `buildPaginationLinkHeader` (RFC-5988), `logEntrySchema`.
- **0.18.0** — downloads + file logs: `sendFileDownload` (Range/206),
  `sendBytesDownload`, `resolveDownloadPath`, `configureFileLogging` (per-level +
  `500.log`), `addLogSink`, `makeLogsRouter`.
- **0.19.0** — `S3UploadStorage` (MinIO/S3 backend) and CLI `lint` / `config` /
  `user`.
- **0.20.0** — `wrapWithSlowQueryLog` (driver-level slow-query logging),
  `backupDatabase` (`pg_dump`/SQLite copy), and optional auth HTML pages
  (`renderAuthResultPage` / `renderPasswordResetFormPage`). Parity reached.

## Goal: full parity with `tempest-fastapi-sdk`

The target is **feature parity** with `tempest-fastapi-sdk`, with the
`integrations/` module (WhatsApp/Telegram/SMS/Email + `MessagingHub`/broadcast)
kept as the **Node-only differential** — a first-class messaging layer the Python
SDK does not have. The core, data, auth, real-time, cache/queue/tasks, flags,
metrics, storage, CLI and advanced-DB surfaces are at parity (0.12.0–0.20.0).

### Status: parity reached ✅

Every item from the original parity target has shipped. The one caveat:
`wrapWithSlowQueryLog` times at the driver boundary and so applies to engines
built from an explicit driver — a per-statement timing hook on `createEngine`
itself is an upstream `tempest-db-js` enhancement. `1.0.0` is cut once the API
settles in real use.

### Out of scope

- `vision` (ort-vision) — belongs to `ort-vision-sdk`, not this SDK.
- The server-rendered (jinja) HTML admin — superseded by the JSON `admin` API +
  a decoupled frontend. (The optional `renderAuthResultPage` /
  `renderPasswordResetFormPage` helpers cover only email-link landings, not a
  full server-rendered admin.)
