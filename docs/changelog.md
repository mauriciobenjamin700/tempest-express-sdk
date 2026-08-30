# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui. O formato segue
[Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto adota
[SemVer](https://semver.org/lang/pt-BR/).

!!! info "Histórico completo"
    Esta página lista os destaques recentes. O histórico versão a versão
    (0.2.0–0.11.0) vive no [`CHANGELOG.md`](https://github.com/mauriciobenjamin700/tempest-express-sdk/blob/main/CHANGELOG.md)
    do repositório.

## [0.21.0] — 2026-08-30

### Alterado

- **BREAKING — deps**: `zod` saiu de **dependency** direta e virou **peer
  dependency obrigatória** em `^4.0.0`; `@asteasolutions/zod-to-openapi` subiu de
  `^7.3.0` para `^9.1.0`. Instale o `zod@^4` junto com o SDK
  (`npm install zod@^4`) — passo a passo em
  [Migração para zod 4](migration/zod-4.md).

  Motivo: como dependency, o SDK trazia a própria cópia do zod. Um projeto em
  zod 4 acabava com **duas instâncias** no `node_modules` e, como o
  `zod-to-openapi` funciona por patch de protótipo do `ZodType`, ele patcheava o
  zod 3 do SDK — não o zod 4 do projeto. Registrar um schema do projeto falhava
  com `TypeError: zodSchema.openapi is not a function`, e patchear a instância do
  projeto à mão só empurrava o erro para
  `UnknownZodTypeError: Unknown zod object type`. Como peer, existe uma instância
  só, compartilhada, e tanto o `instanceof ZodType` quanto o patch atravessam a
  fronteira do pacote. Closes #2.

- **schemas**: schemas internos migrados para os idiomas do zod 4 — `z.uuid()`,
  `z.email()`, `z.url()` (a cadeia `z.string().uuid()` está deprecated no zod 4),
  `z.record(z.string(), z.unknown())` (o tipo da chave passou a ser obrigatório) e
  `.loose()` no lugar do `.passthrough()` deprecated. O `z.ZodTypeAny` das
  assinaturas públicas de `paginationSchema`, `cursorPaginationSchema`,
  `syncPaginationSchema`, `loadSettings` e `AdminResource` virou `z.ZodType`.
  As grafias do zod 3 continuam parseando, então schema de consumidor segue
  funcionando.

- **cli**: o template do scaffold agora fixa `zod@^4.0.0`.

### Adicionado

- **tests**: `tests/zod-instance.test.ts` — guarda de regressão provando que o `z`
  do SDK **é** a instância de `zod` do consumidor, que o `.openapi()` está nela e
  que o documento gera a partir de schemas criados com um
  `import { z } from "zod"` puro.

### Docs

- Nova página **Migração para zod 4** (bilíngue) — o breaking change, o install
  antes/depois, os renames de API e o diagnóstico das "duas instâncias".

## [0.20.1] — 2026-07-09

### Alterado

- **deps**: `tempest-db-js` para `>=0.4.0` (peer), `^0.4.0` (dev) e no template
  do CLI. Sem mudança de API; build e suíte completa verdes no 0.4.0.

### Corrigido

- **api**: o Swagger UI agora carrega os assets ao ser acessado em `/docs` (sem
  barra final), não só em `/docs/`. O HTML referenciava os assets por caminho
  relativo (`./assets/…`), que o navegador resolvia contra `/docs` para
  `/assets/…` — um 404 que deixava a página em branco/sem estilo. As URLs dos
  assets agora são **absolutas** (`/docs/assets/…`) e resolvem nos dois caminhos.

### Docs

- Nova receita **[Schemas (base, resposta e paginação)](recipes/schemas.md)** —
  `toDict`, `baseResponseSchema`, o padrão Create/Update/Response e paginação por
  offset vs. cursor.
- Nova receita **[API: `createApp`, OpenAPI, Swagger e Redoc](recipes/api.md)** —
  referência completa das opções do `createApp`, o hook `configure` e a cablagem
  de OpenAPI em 3 passos.

## [0.20.0] — 2026-07-06

### Adicionado

- **db**: `wrapWithSlowQueryLog` (log de queries lentas via wrap de driver) e
  `backupDatabase` (backup por dialeto: `pg_dump`/cópia SQLite). **auth**:
  `renderAuthResultPage` / `renderPasswordResetFormPage` (páginas HTML opcionais).

## [0.19.0] — 2026-07-06

### Adicionado

- **storage**: `S3UploadStorage` (mesma interface `UploadStorage` sobre MinIO/S3,
  peer `minio` opcional). **cli**: `lint`, `config` e `user`.

## [0.18.0] — 2026-07-06

### Adicionado

- **utils**: `sendFileDownload` (Range/206), `sendBytesDownload`,
  `resolveDownloadPath` (anti-traversal) e `configureFileLogging` (arquivos por
  nível + `500.log`); **core** `addLogSink`; **api** `makeLogsRouter`.

## [0.17.0] — 2026-07-06

### Adicionado

- **schemas**: tipos de campo validados (`centsField`, `priceField`, `slugField`,
  `hexColorField`, `percentField`, `latitudeField`, …), paginação delta-sync
  (`syncFilterSchema` / `syncPaginationSchema`), `buildPaginationLinkHeader`
  (RFC-5988) e `logEntrySchema`.

## [0.16.0] — 2026-07-06

### Adicionado

- **api**: clientes OAuth2/OIDC (`GoogleOAuthClient`, `GitHubOAuthClient`,
  `OIDCProvider`) + `generateOAuthState`, `WebhookSignatureVerifier` (HMAC em
  tempo constante sobre o corpo cru) e `makeToolSpecRouter` (manifesto em
  `/tool-spec`).

## [0.15.0] — 2026-07-06

### Adicionado

- **db**: camada avançada — `TenantScopedRepository` (isolamento multi-tenant),
  `BaseOutboxModel` + `OutboxRelay` (outbox transacional), `BaseAuditLogModel` +
  `snapshot`/`diffSnapshots` (trilha de auditoria) e modelos base opt-in
  `BaseUserModel` / `BaseUserTokenModel` / `BaseUserRefreshTokenModel`.

## [0.14.0] — 2026-07-06

### Adicionado

- **testing**: helpers de banco em memória agnósticos de framework —
  `createTestDatabase(models)` sobe um engine `tempest-db-js` sobre SQLite em
  memória com as tabelas refletidas dos models; `withTestDatabase(models, fn)`
  escopa a um bloco e sempre fecha.

## [0.13.0] — 2026-07-06

### Adicionado

- **api/middlewares**: middlewares de endurecimento HTTP — `rateLimitMiddleware`
  (janela deslizante; store memória + Redis; chaves por IP/header/JWT),
  `bodySizeLimitMiddleware` (413), `csrfMiddleware` + `generateCsrfToken`,
  `idempotencyMiddleware` (store memória + Redis), `GracefulShutdown`,
  `requestTracingMiddleware` e `prometheusMiddleware` / `HttpMetrics`.

### Alterado

- **api**: `requestIdMiddleware` valida o `X-Request-ID` de entrada contra uma
  whitelist ASCII antes de reusá-lo (evita CRLF/log injection).

## [0.12.0] — 2026-07-06

### Adicionado

- **settings**: fragmentos de settings por domínio, espelhando os mixins do
  `tempest-fastapi-sdk` — `authSettingsShape`, `jwtSettingsShape`,
  `emailSettingsShape`, `redisSettingsShape`, `rabbitmqSettingsShape`,
  `sessionSettingsShape`, `uploadSettingsShape`, `minioSettingsShape`,
  `webPushSettingsShape`, `webSocketSettingsShape`, `logSettingsShape`,
  `tokenSettingsShape` (mesmos nomes de env + defaults). Mais os helpers
  `envBoolean` (parseia `"false"` como `false`) e `envList` (CSV → `string[]`).

### Documentação

- **recipes/settings**: novo guia bilíngue de settings tipados.
- **recipes/database**: novo guia bilíngue (models + repositories).

## [0.1.0] — 2026-06-29

### Adicionado

- **Fundação**: tooling TypeScript rígido, alias `@` (sem `.js`), build dual
  ESM + CJS + `.d.ts` (tsup), Biome e Vitest.
- **core**: `JSONLogger`, contexto de request-id (`AsyncLocalStorage`),
  `defineEnum`.
- **exceptions**: `AppException` + subclasses HTTP (`Conflict`, `NotFound`,
  `Unauthorized`, `Forbidden`, `Validation`, `TooManyRequests`, `InvalidToken`,
  `ExpiredToken`), `MessageCatalog` (i18n) e `registerExceptionHandlers`.
- **schemas**: `z` com OpenAPI, `baseResponseSchema`, paginação offset e cursor.
- **settings**: `loadSettings`, `baseAppSettingsShape`.
- **db**: re-export do `tempest-db-js`, `BaseModel` e helpers de coluna.
- **services / controllers**: `BaseService`, `BaseController`.
- **utils**: CPF/CNPJ/CEP/telefone/UF + cidades, datetime, dict, tokens opacos,
  `AttemptThrottle`, `PasswordUtils` (bcrypt), `JWTUtils`.
- **auth**: schemas, `UserAuthService`, middleware JWT, guardas de role,
  `makeAuthRouter`.
- **api**: `createApp`, `runServer`, Swagger UI + Redoc nativos, health.
- **CLI**: `new`, `generate`, `secret`, `docker-compose`, `db`.

### Pendente

Ainda não portado do `tempest-fastapi-sdk`: sessions, cache (Redis),
queue (RabbitMQ), tasks, webpush, websockets, feature flags, storage, metrics,
admin, SSE, e os fluxos de MFA / email / reset de senha.
