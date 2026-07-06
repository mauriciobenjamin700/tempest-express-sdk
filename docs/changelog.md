# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui. O formato segue
[Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto adota
[SemVer](https://semver.org/lang/pt-BR/).

!!! info "Histórico completo"
    Esta página lista os destaques recentes. O histórico versão a versão
    (0.2.0–0.11.0) vive no [`CHANGELOG.md`](https://github.com/mauriciobenjamin700/tempest-express-sdk/blob/main/CHANGELOG.md)
    do repositório.

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
