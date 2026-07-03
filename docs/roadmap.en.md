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
  See the [Integrations: WhatsApp](recipes/whatsapp.md) recipe.
- **0.5.0** — `admin/`: JSON admin (`AdminSite` + `makeAdminRouter`) with
  auto-derived CRUD, `_meta` introspection, Zod validation and a pluggable guard.
  See the [Admin (JSON API)](recipes/admin.md) recipe.
- **0.6.0** — `integrations/`: `TelegramProvider` (Bot API, send + polling) and
  `TwilioSmsProvider` (SMS) + `makeTwilioWebhookRouter` (signature-validated).
  See the [SMS and Telegram](recipes/sms-telegram.md) recipe.
- **0.7.0** — auth flows: `MfaService` (TOTP), `ActivationService` (email) and
  `PasswordResetService`, wired into `makeAuthRouter`. See
  [Authentication (JWT)](recipes/auth.md).
- **0.8.0** — Redis stores: `RedisSessionStore` and `RedisSSEBroker` (pub/sub)
  for multi-replica deployments. See [Real-time](recipes/realtime.md).

## Planned

### More channels under `MessagingProvider`

WhatsApp (0.4.0), Telegram + SMS (0.6.0) ship under the shared contract. Future
candidates reuse it too: additional SMS vendors and a transactional-email
provider exposed as a `MessagingProvider`.

### Other candidates

- **metrics** — optional GPU metrics and a `/metrics` Prometheus router.
