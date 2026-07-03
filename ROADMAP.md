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

## Planned

### More channels under `MessagingProvider`

WhatsApp (0.4.0), Telegram + SMS (0.6.0) ship under the shared contract. Future
candidates reuse it too: additional SMS vendors, and transactional-email
providers exposed as a `MessagingProvider`.

### Other candidates

- More `MessagingProvider` channels (additional SMS vendors, a
  transactional-email provider) under the shared contract.
- A `MessagingProvider`-based email channel unifying `EmailUtils` with the
  integrations surface.
