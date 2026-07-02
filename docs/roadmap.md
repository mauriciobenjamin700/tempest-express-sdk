# Roadmap

## Entregue

- **0.1.0** — fundação: core, exceptions (+i18n), schemas, paginação, settings,
  `BaseModel`, repository/service/controller, `createApp` + Swagger/Redoc,
  health, CLI (`new`), docs bilíngue.
- **0.2.0** — cache, sessions, SSE, WebSockets, fila (RabbitMQ), tarefas em
  background, feature flags, storage.
- **0.3.0** — client-IP, TOTP (MFA), HTTP client resiliente (retry + circuit
  breaker), métricas de sistema (+ Prometheus), Web Push, email.
- **0.4.0** — `integrations/`: contrato `MessagingProvider` + `WhatsAppProvider`
  (cliente tipado do `zap-api`, REST + `/ws`) + `makeWhatsAppWebhookRouter`.
  Veja a receita [Integrações: WhatsApp](recipes/whatsapp.md).
- **0.5.0** — `admin/`: admin JSON (`AdminSite` + `makeAdminRouter`) com CRUD
  auto-derivado, introspecção `_meta`, validação Zod e guard plugável.
  Veja a receita [Admin (API JSON)](recipes/admin.md).
- **0.6.0** — `integrations/`: `TelegramProvider` (Bot API, envio + polling) e
  `TwilioSmsProvider` (SMS) + `makeTwilioWebhookRouter` (assinatura validada).
  Veja a receita [SMS e Telegram](recipes/sms-telegram.md).
- **0.7.0** — fluxos de auth: `MfaService` (TOTP), `ActivationService` (email) e
  `PasswordResetService`, montados no `makeAuthRouter`. Veja
  [Autenticação (JWT)](recipes/auth.md).

## Planejado

### Mais canais sob `MessagingProvider`

WhatsApp (0.4.0), Telegram + SMS (0.6.0) já rodam sob o contrato compartilhado.
Candidatos futuros o reusam: outros provedores de SMS e email transacional
exposto como `MessagingProvider`.

### Outros candidatos

- **stores Redis** — `SessionStore` e transporte de `SSEBroker` em Redis para
  deploys multi-réplica.
- **metrics** — métricas de GPU opcionais e um router Prometheus `/metrics`.
