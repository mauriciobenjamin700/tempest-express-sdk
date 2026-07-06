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

## Goal: full parity with `tempest-fastapi-sdk`

The target is **feature parity** with `tempest-fastapi-sdk`, with the
`integrations/` module (WhatsApp/Telegram/SMS/Email + `MessagingHub`/broadcast)
kept as the **Node-only differential** — a first-class messaging layer the Python
SDK does not have. The core, data, auth, real-time, cache/queue/tasks, flags,
metrics and CLI surfaces are already at parity or close; the items below close
the remaining gaps.

### HTTP hardening middlewares

- CSRF protection, rate limiting (memory + Redis), idempotency keys, body-size
  limit, graceful shutdown, standalone request-id middleware, request tracing.
- `PrometheusMiddleware` (per-request histogram) to complement the existing
  system `/metrics` router.

### OAuth, webhooks & meta routers

- OAuth clients (Google, GitHub) + `OIDCProvider`.
- Webhook signature verifier (HMAC/RSA), `tool-spec` router, logs router.
- Auth locale negotiation + optional HTML page renderer.

### Advanced DB

- Transactional outbox (`OutboxRelay`), audit log model + `AuditMixin`,
  `SoftDeleteMixin`/`MFAMixin`, tenant-scoped repository, slow-query logger,
  database backup, `BaseUserModel` + token models, snapshot/diff helpers.

### Schemas, storage, utils, CLI

- Delta-sync pagination (`SyncFilterSchema`/`SyncPaginationSchema`), pagination
  link headers, `LogEntrySchema`.
- MinIO/S3 `UploadStorage` backend (alongside `LocalUploadStorage`).
- Field types (`CentsField`/`PriceField`/`HexColorField`/… as Zod), full
  `DownloadUtils`, `LogUtils` with `500.log` routing.
- CLI: `user`, `lint`, `config`, and real DB-migration wiring over `tempest-db-js`.

### Testing helpers

- In-memory DB/test fixtures (mirrors the Python `testing` module).

### Out of scope

- `vision` (ort-vision) — belongs to `ort-vision-sdk`, not this SDK.
- The server-rendered (jinja) HTML admin — superseded by the JSON `admin` API +
  a decoupled frontend.

`1.0.0` is cut once these close and the API settles in real use.
