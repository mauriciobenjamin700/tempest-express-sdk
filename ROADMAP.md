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

## Goal: full parity with `tempest-fastapi-sdk`

The target is **feature parity** with `tempest-fastapi-sdk`, with the
`integrations/` module (WhatsApp/Telegram/SMS/Email + `MessagingHub`/broadcast)
kept as the **Node-only differential** — a first-class messaging layer the Python
SDK does not have. The core, data, auth, real-time, cache/queue/tasks, flags,
metrics and CLI surfaces are already at parity or close; the items below close
the remaining gaps.

### Meta routers (remaining)

- Logs router (ships with the `LogUtils` / `500.log` routing work below).
- Optional HTML page renderer for the auth flows (auth locale negotiation is
  already covered by `MessageCatalog.negotiate`).

### Advanced DB (remaining)

- Slow-query logger and database backup helper. (The transactional outbox,
  audit log model + snapshot/diff, tenant-scoped repository and base
  user/token models shipped in 0.15.0; soft-delete/audit "mixins" ship as the
  `deletedAtColumn`/`createdByColumn`/`updatedByColumn` factories.)

### Storage & CLI (remaining)

- MinIO/S3 `UploadStorage` backend (alongside `LocalUploadStorage`) — needs a
  peer-dep decision (`minio` / AWS SDK).
- CLI: `user`, `lint`, `config`.
  (Delta-sync pagination, link headers, `logEntrySchema`, the Zod field types,
  the range-aware downloads and the file-log routing + logs router shipped in
  0.17.0–0.18.0.)

### Out of scope

- `vision` (ort-vision) — belongs to `ort-vision-sdk`, not this SDK.
- The server-rendered (jinja) HTML admin — superseded by the JSON `admin` API +
  a decoupled frontend.

`1.0.0` is cut once these close and the API settles in real use.
