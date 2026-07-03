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
- **0.8.0** — stores Redis: `RedisSessionStore` e `RedisSSEBroker` (pub/sub) para
  deploys multi-réplica. Veja [Tempo real](recipes/realtime.md).
- **0.9.0** — métricas: GPU opcional (`nvidia-smi`) + `makeMetricsRouter`
  (endpoint `/metrics` Prometheus). Veja [MFA, HTTP client…](recipes/server-utils.md).
- **0.10.0** — `EmailProvider` (email como `MessagingProvider`) e MFA no login
  (challenge no `UserAuthService` + `POST /auth/mfa/challenge`).
- **0.11.0** — helpers de broadcast: `broadcastText` (fan-out com concorrência)
  e `MessagingHub` (canais nomeados com `send`/`broadcast`).

## Meta: paridade total com o `tempest-fastapi-sdk`

O objetivo é **paridade de features** com o `tempest-fastapi-sdk`, mantendo o
módulo `integrations/` (WhatsApp/Telegram/SMS/Email + `MessagingHub`/broadcast)
como o **diferencial exclusivo do Node** — uma camada de mensageria de primeira
classe que o SDK Python não tem. O núcleo, dados, auth, tempo real,
cache/fila/tarefas, flags, métricas e CLI já estão em paridade ou perto; os itens
abaixo fecham as lacunas restantes.

### Middlewares de hardening HTTP

- CSRF, rate limiting (memória + Redis), idempotency keys, limite de body,
  graceful shutdown, middleware de request-id independente, tracing.
- `PrometheusMiddleware` (histograma por-request), complementando o router
  `/metrics` de sistema já existente.

### OAuth, webhooks & routers meta

- Clientes OAuth (Google, GitHub) + `OIDCProvider`.
- Verificador de assinatura de webhook (HMAC/RSA), router `tool-spec`, router de logs.
- Negociação de locale no auth + page-renderer HTML opcional.

### DB avançado

- Outbox transacional (`OutboxRelay`), audit log model + `AuditMixin`,
  `SoftDeleteMixin`/`MFAMixin`, repositório com escopo de tenant, slow-query
  logger, backup, `BaseUserModel` + token models, snapshot/diff.

### Settings tipados

- Fragmentos/classes de settings de domínio: `AuthSettings`, `JWTSettings`,
  `EmailSettings`, `RedisSettings`, `RabbitMQSettings`, `SessionSettings`,
  `UploadSettings`, etc. (compostos sobre `baseAppSettingsShape`).

### Schemas, storage, utils, CLI

- Paginação delta-sync (`SyncFilterSchema`/`SyncPaginationSchema`), link headers
  de paginação, `LogEntrySchema`.
- Backend `UploadStorage` MinIO/S3 (ao lado do `LocalUploadStorage`).
- Field types (`CentsField`/`PriceField`/`HexColorField`/… em Zod),
  `DownloadUtils` completo, `LogUtils` com roteamento `500.log`.
- CLI: `user`, `lint`, `config` e wiring real de migrations via `tempest-db-js`.

### Helpers de teste

- Fixtures de DB em memória (espelha o módulo `testing` do Python).

### Fora de escopo

- `vision` (ort-vision) — pertence ao `ort-vision-sdk`, não a este SDK.
- Admin HTML server-rendered (jinja) — substituído pela API `admin` JSON +
  frontend desacoplado.

A `1.0.0` sai quando esses itens fecharem e a API estabilizar no uso real.
