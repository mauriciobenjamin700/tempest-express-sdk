# tempest-express-sdk

> Shared **Express + Zod + tempest-db-js** building blocks — a Node.js/TypeScript
> port of the conventions in [`tempest-fastapi-sdk`](https://pypi.org/project/tempest-fastapi-sdk/).

📖 **Documentation:** [Português (BR)](https://mauriciobenjamin700.github.io/tempest-express-sdk/) · [English (US)](https://mauriciobenjamin700.github.io/tempest-express-sdk/en/)

Strict TypeScript, `@`-alias imports (no `.js` suffixes), native **Swagger UI +
Redoc** generated straight from your Zod schemas, and a layered
router → controller → service → repository → model stack built on
[`tempest-db-js`](https://www.npmjs.com/package/tempest-db-js).

> ⚠️ **Status: pre-alpha (v0.1.0).** Foundation layer is built and tested; many
> `tempest-fastapi-sdk` feature modules are not yet ported (see Roadmap).

## Install

```bash
npm install tempest-express-sdk tempest-db-js express zod
```

`tempest-db-js` is a required peer dependency.

## What's inside

| Area | Exports |
| --- | --- |
| **core** | `JSONLogger`, `configureLogging`, request-id context (`getRequestId`, `runWithRequestContext`), `defineEnum` |
| **exceptions** | `AppException` + `ConflictException` / `NotFoundException` / `UnauthorizedException` / `ForbiddenException` / `ValidationException` / `TooManyRequestsException` / `InvalidTokenException` / `ExpiredTokenException`, `MessageCatalog` (i18n) |
| **schemas** | `z` (OpenAPI-augmented), `baseResponseSchema`, `toDict`, `paginationFilterSchema` / `paginationSchema`, cursor + delta-sync pagination, `buildPaginationLinkHeader`, validated field types (`centsField`/`priceField`/`slugField`/…), `logEntrySchema` |
| **settings** | `loadSettings`, `baseAppSettingsShape` (server / database / CORS) + domain fragments (`jwtSettingsShape`, `authSettingsShape`, `emailSettingsShape`, `redisSettingsShape`, `sessionSettingsShape`, `uploadSettingsShape`, `minioSettingsShape`, …), `envBoolean` / `envList` |
| **db** | re-exports `tempest-db-js` + `BaseModel`, `tableNameFor`, soft-delete / audit column helpers; `TenantScopedRepository`, `BaseOutboxModel` + `OutboxRelay`, `BaseAuditLogModel` + `snapshot`/`diffSnapshots`, `BaseUserModel` / `BaseUserTokenModel` / `BaseUserRefreshTokenModel` |
| **services / controllers** | `BaseService`, `BaseController` over a typed repository |
| **utils** | CPF/CNPJ/CEP/phone/UF + cities, `PasswordUtils`, `JWTUtils`, opaque tokens, `AttemptThrottle`, `sendFileDownload`/`sendBytesDownload` (Range), `configureFileLogging` (per-level + `500.log`) |
| **auth** | `UserAuthService`, JWT middleware + role guards, `makeAuthRouter`; MFA (`MfaService`), email activation, password reset |
| **cache / queue / tasks** | `CacheManager` (+`cached`), `BrokerManager` (memory/RabbitMQ), `TaskManager` |
| **sse / websockets** | `SSEBroker`/`sseResponse` (+ `RedisSSEBroker`), transport-agnostic `WebSocketHub` + `attachWebSocketHub` |
| **flags / storage** | `FeatureFlags` (+ guard), `UploadStorage`/`LocalUploadStorage`/`S3UploadStorage` (MinIO/S3) |
| **webpush / email** | `WebPushDispatcher` (VAPID), `EmailUtils` (SMTP) |
| **server utils** | `TOTPHelper` (MFA), `HTTPClient` (retry + circuit breaker), `MetricsUtils` (+ Prometheus, GPU), `makeMetricsRouter`, `getClientIp` |
| **integrations** | `MessagingProvider` contract; `WhatsAppProvider` (zap-api), `TelegramProvider` (Bot API), `TwilioSmsProvider` (SMS), `EmailProvider`, `MessagingHub` + `broadcastText`, webhook receivers |
| **admin** | `AdminSite` + `makeAdminRouter` — JSON admin with auto-derived CRUD + introspection |
| **api** | `createApp`, `runServer`, `registerExceptionHandlers`, `createOpenApiRegistry`, `generateOpenApiDocument`, `mountSwaggerUi`, `mountRedoc`, `makeHealthRouter` |
| **api/middlewares** | `rateLimitMiddleware` (memory/Redis stores, IP/header/JWT keys), `bodySizeLimitMiddleware`, `csrfMiddleware`, `idempotencyMiddleware` (memory/Redis), `GracefulShutdown`, `requestTracingMiddleware`, `prometheusMiddleware` / `HttpMetrics` |
| **api/oauth** | `GoogleOAuthClient`, `GitHubOAuthClient`, `OIDCProvider`, `generateOAuthState`; `WebhookSignatureVerifier`; `makeToolSpecRouter` |
| **testing** | `createTestDatabase`, `withTestDatabase` — in-memory SQLite engine with tables reflected from your models |

## Quick start

```ts
import { createApp, createOpenApiRegistry, runServer, z } from "tempest-express-sdk";

const registry = createOpenApiRegistry();
const Item = registry.register("Item", z.object({ id: z.string().uuid(), name: z.string() }));

const app = await createApp({
  corsOrigins: "*",
  openapi: { registry, info: { title: "My API", version: "1.0.0" } },
  configure: (app) => {
    app.get("/api/items", (_req, res) => res.json([]));
  },
});

await runServer(app, { host: "127.0.0.1", port: 8000 });
// Swagger UI → /docs   ·   Redoc → /redoc   ·   spec → /openapi.json   ·   health → /health
```

## CLI

```bash
npx tempest-express new my-service   # scaffold a runnable layered service
cd my-service && npm install && npm run dev
```

The generated project is a complete vertical slice (model → repository → service
→ controller → router → app) pre-wired with `createApp`, Swagger/Redoc and Zod.

## Develop

```bash
npm install
npm run test:types   # tsc --noEmit
npm test             # vitest
npm run build        # tsup → dual ESM + CJS + .d.ts (+ CLI bin)
npm run lint         # biome
```

## Roadmap

Ported: core, exceptions (+ i18n), schemas, pagination, settings, `BaseModel`,
`BaseRepository`/`BaseService`/`BaseController`, `createApp` + Swagger/Redoc,
health, CLI `new`.

Also ported: BR utils (CPF/CNPJ/CEP/phone/UF + cities), `PasswordUtils`,
`JWTUtils`, opaque tokens, `AttemptThrottle`, the `auth` module (signup/login/
refresh + JWT guards), cache, sessions, queue (RabbitMQ), background tasks, SSE,
WebSockets, feature flags, object storage, CLI `generate`/`secret`/`docker-compose`,
and the bilingual MkDocs docs site.

Also shipped: the `integrations/` module — a typed WhatsApp client over
[`zap-api`](https://github.com/mauriciobenjamin700) behind a shared
`MessagingProvider` contract.

Planned (see [ROADMAP.md](./ROADMAP.md)): additional `MessagingProvider`
channels (more SMS vendors, a transactional-email provider) under the shared
contract.

## License

MIT
