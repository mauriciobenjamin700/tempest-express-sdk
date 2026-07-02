# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres
to [SemVer](https://semver.org/).

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
