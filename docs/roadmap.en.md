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

## Planned

### More channels under `MessagingProvider`

The `integrations/` module shipped in 0.4.0 with WhatsApp. Next channels reuse
the same contract (`sendText`, `sendMedia`, `onMessage`, `status`): SMS
(e.g. Twilio), Telegram, and transactional email providers.

### Other candidates

- **admin** — auto-generated admin UI over models.
- **auth flows** — MFA enrollment, email activation, password reset.
- **Redis stores** — first-party Redis `SessionStore` and a Redis `SSEBroker`
  transport for multi-replica deployments.
- **metrics** — optional GPU metrics and a `/metrics` Prometheus router.
