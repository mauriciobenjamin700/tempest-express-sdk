# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui. O formato segue
[Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto adota
[SemVer](https://semver.org/lang/pt-BR/).

!!! info "Histórico completo"
    Esta página lista os destaques recentes. O histórico versão a versão
    (0.2.0–0.11.0) vive no [`CHANGELOG.md`](https://github.com/mauriciobenjamin700/tempest-express-sdk/blob/main/CHANGELOG.md)
    do repositório.

## [0.26.0] — 2026-09-05

### Adicionado

- **admin**: **controle de acesso por papel**. `makeAdminRouter({ accessPolicy })`
  recebe um predicado `(principal, admin, action)` consultado em toda ação de
  model. Ele **compõe** com as flags `canCreate` / `canEdit` / `canDelete` — não
  as substitui — e o painel esconde o que recusa: model sem `VIEW` some da
  sidebar e do dashboard, ação recusada sai do dropdown de massa, e os botões
  **+ New** / **Edit** / **Delete** só aparecem quando a política deixa. Flag
  desligada responde `404` (a view não existe); política recusando responde
  `403` (existe, e você não pode usá-la) — juntar os dois esconderia
  configuração errada atrás de um "sem permissão".

- **admin**: **trilha de auditoria**. Create e edit carimbam `createdBy` /
  `updatedBy` com o operador quando o model declara essas colunas, e o detail
  ganha um painel **Audit** com os timestamps e os atores já resolvidos para
  nome pelo auth backend. Passando `AdminModel({ auditModel })`, o painel também
  renderiza a timeline de mudanças do registro lida daquela tabela
  `BaseAuditLogModel` — ação, ator, o diff campo a campo e o contexto gravado,
  cada entrada num `<details>` recolhido para histórico longo continuar
  escaneável sem JavaScript. O painel só lê a trilha; quem escreve continua
  sendo o service.

- **admin**: **cards de métrica no dashboard**. `new AdminSite({ dashboardCards })`
  recebe entradas `metricCard(label, compute, helpText?)` calculadas do banco no
  carregamento, em três formatos: `value`, `trend` (▲/▼ com a variação
  percentual) e `partition` (uma barra por segmento). Card cujo `compute`
  levanta é logado e renderiza como card de erro, em vez de derrubar o
  dashboard. `trendPercent` devolve `null` contra base zero — porcentagem contra
  zero é indefinida, não infinita.

- **admin**: **lenses** — presets salvos de listagem. Entradas
  `adminLens({ name, filters, orderBy })` passadas em `AdminModel({ lenses })`
  viram abas acima da tabela e aplicam via `?lens=<slug>`. Os filtros da lens
  são ANDados com o que o operador digitou, a ordenação dela vale até alguém
  clicar num cabeçalho de coluna, e a lens ativa viaja nos links de paginação,
  ordenação e export.

### Alterado

- **admin**: o detail move `createdAt` / `updatedAt` / `createdBy` / `updatedBy`
  da lista de campos para o novo painel de auditoria, onde "quem e quando" lê
  melhor ao lado do histórico do que espalhado entre os campos de domínio.
  `AdminModel.detailFieldNames()` não os devolve mais; o novo
  `auditFieldNames()` devolve.

## [0.25.0] — 2026-09-05

### Adicionado

- **admin**: **ações em massa** na list view. Cada linha ganha um checkbox mais
  um "selecionar tudo", e a barra de ação aplica **Activate** / **Deactivate**
  (condicionadas a `canEdit` e à coluna `isActive`) ou **Delete** (condicionada a
  `canDelete`) às linhas marcadas, informando quantas mudaram. Toda submissão
  carrega o token CSRF da sessão.

- **admin**: **ações customizadas** com `adminAction({ label }, handler)`,
  passadas em `AdminModel({ actions: [...] })`. Cada uma entra no dropdown com o
  namespace `custom:<nome>`, então nunca colide com uma ação embutida. O handler
  recebe os `ids` marcados, um repository na sessão do request, a sessão de
  banco, o request, a sessão do admin e o operador que disparou, e devolve
  `{ message, category }` para exibir um banner (ou `null` para nenhum). Handler
  que levanta é registrado no log e volta como banner de erro, não como `500`.

  Onde o SDK Python usa o decorator `@admin_action`, aqui `adminAction` devolve o
  descritor: o handler continua uma função comum, chamável e testável
  (`action.handler(ctx)`), sem sintaxe de decorator para ligar no build de quem
  consome.

- **admin**: **export CSV / JSON** em `GET {prefix}/m/{slug}/export.csv|json`,
  respeitando busca, filtros, ordenação e as colunas do `listDisplay` do request
  — list view e export agora resolvem a query por um caminho de código só, porque
  export que discorda em silêncio da página de onde saiu é pior que export
  nenhum. O CSV segue a RFC 4180; `Date` vira ISO, `bigint` vira string decimal,
  binário vira base64. `makeAdminRouter({ exportMaxRows })` limita as linhas
  (default `5000`), para um clique numa tabela grande não virar incidente.

- **admin**: **select de chave estrangeira**. Coluna FK cujo model de destino
  está registrado no mesmo site vira `<select>` das linhas relacionadas, no
  formulário e no filtro da listagem, com label do primeiro `searchFields` do
  admin referenciado (caindo para `name`/`title`/`email`/`label`/`reference` e,
  por último, a identidade). FK para tabela não registrada continua input de
  texto — dropdown vazio seria pior que o campo cru. Opções limitadas a 1000
  linhas. Os helpers `foreignKeyFields`, `foreignKeyLabel` e `foreignKeyTable`
  passam a ser exportados para quem monta as próprias telas.

## [0.24.0] — 2026-09-05

### Adicionado

- **admin**: um **painel admin server-rendered** — a UI de operador no estilo
  Django que o SDK FastAPI entrega, agora neste SDK. `AdminSite` guarda o
  registro, `AdminModel` configura um model, e `makeAdminRouter(site, { engine,
  authBackend, secretKey })` monta login, dashboard, list views (busca, filtros
  por tipo de coluna, colunas ordenáveis, paginação) e formulários de
  criar/editar/excluir auto-derivados sob `/admin`.

  Widget, filtro e validação saem da metadata de coluna do `tempest-db-js`
  (`columnsOf`), não de um segundo schema que o projeto teria de manter em
  sincronia: coluna `enum` vira `<select>` com os membros, coluna `datetime`
  vira input `datetime-local` mais um par de filtros de/até, `varchar(>255)`
  vira textarea. `AdminSite.automap` registra o barrel de models inteiro de uma
  vez e pula as bases abstratas.

  Nada novo é instalado: o HTML e a folha de estilo de ~32 KB (portada verbatim
  do `tempest-fastapi-sdk`) são strings deste pacote, a sessão é assinada com
  `node:crypto`, e a senha passa pelo `PasswordUtils` que já existia. Não há
  template engine nem JavaScript de framework — a sidebar off-canvas responsiva
  é CSS puro.

- **admin**: `UserModelAuthBackend` autentica contra uma subclasse de
  `BaseUserModel`, admitindo só linhas `isActive` **e** `isAdmin`. Passando um
  `AdminMfaVerifier`, o principal que habilitou TOTP passa por `/admin/mfa`
  depois da senha — assim o painel nunca vira a porta mais fraca de uma conta
  protegida por MFA.

- **admin**: `AdminSessionStore` emite sessão stateless em cookie assinado
  (HMAC-SHA256, `HttpOnly`, `SameSite=Lax`, `Secure` por default) carregando o
  token CSRF que todo formulário de escrita devolve. Segredo com menos de 32
  caracteres é recusado na construção. `AdminTheme` re-estiliza o painel por
  campos tipados injetados como custom properties CSS, recusando valor que
  escaparia do bloco `<style>` injetado.

### Alterado

- **BREAKING — admin**: o admin JSON foi renomeado para o painel HTML poder
  assumir os nomes que ele tem no `tempest-fastapi-sdk`. `AdminSite` →
  `AdminJsonSite`, `makeAdminRouter` → `makeAdminJsonRouter`, e os tipos
  ganharam o mesmo infixo (`AdminResource` → `AdminJsonResource`, `AdminField` →
  `AdminJsonField`, `AdminListQuery`/`AdminListResult` →
  `AdminJsonListQuery`/`AdminJsonListResult`, `AdminRouterOptions` →
  `AdminJsonRouterOptions`).

  Não cabe alias deprecado aqui: o significado antigo e o novo colidem no mesmo
  identificador. Atualize o import e a chamada do construtor — comportamento,
  rotas e o prefixo padrão `/admin` continuam iguais. Montar o painel e o admin
  JSON na mesma aplicação agora exige dar um `prefix` diferente para um deles.

- **deps**: o piso do peer `tempest-db-js` sobe para `>=0.8.0` (dev dependency e
  scaffold do CLI para `^0.8.0`), mantendo o consumidor na fundação de banco
  atual.

### Corrigido

- **admin**: o formulário de criação em branco agora pré-preenche o default
  literal de cada coluna, então submetê-lo intocado grava o que o banco teria
  gravado. Sem isso, um flag `default(true)` chegava como `false` — o painel
  desativava silenciosamente toda linha que criava. Pego em browser real, não
  pelo type-checker.

- **admin**: o detail view renderiza **todas** as colunas, sem ser mais
  estreitado pelo `listDisplay`. A listagem é um resumo escaneável; cortar o
  detail do mesmo jeito escondia dado sem nenhum outro lugar para lê-lo.

## [0.23.0] — 2026-08-30

### Adicionado

- **api**: `mountSwaggerUi` e `mountRedoc` passam a emitir `<link rel="icon">`,
  com default `DEFAULT_DOCS_FAVICON` — um SVG inline em `data:` URI. Sem ele o
  browser pede `/favicon.ico` **na raiz da origem**, que num serviço só de API é
  404, 401 atrás do middleware de auth, ou cai numa rota SPA: um erro vermelho no
  console a cada visita a `/docs`. `SwaggerOptions` e `RedocOptions` aceitam
  `favicon?: string | false`; `false` omite a tag. Closes #7.

- **api**: `mountRedoc` serve o renderer **do próprio serviço** quando a nova
  peer opcional `redoc` está instalada, então a página de referência funciona em
  rede fechada. Novo `RedocOptions.bundle`: `"auto"` (default — local quando
  disponível, CDN quando não), `"local"` (lança no mount se o `redoc` faltar,
  para deploy air-gapped não degradar em silêncio para um pedido à CDN) e
  `"cdn"`. `RedocOptions.bundlePath` serve uma cópia vendorizada; `scriptUrl`
  continua ganhando dos dois.

  `redoc` é **peer opcional**, não dependency: o pacote traz 22 dependências e
  peers em `react`, `react-dom`, `styled-components`, `mobx` e `core-js` —
  bounds que nenhum serviço backend deveria herdar só para renderizar uma página
  de referência. Quem quer Redoc offline opta com `npm install redoc`; o resto
  não paga nada.

- **api**: `SwaggerOptions.ui` — passthrough mesclado no construtor do
  `SwaggerUIBundle`, então qualquer opção do Swagger UI que o JSON carregue fica
  alcançável sem o SDK modelar uma a uma. Três defaults passam a diferir do
  Swagger UI: `layout` é `"BaseLayout"` no lugar de `"StandaloneLayout"` (o
  standalone renderiza a topbar **Explore**, um campo de URL editável que carrega
  qualquer spec de qualquer origem — o ponto do editor do Swagger, superfície
  errada para uma página que documenta um serviço), e `deepLinking` e
  `persistAuthorization` viram `true` (operação linkável, e credencial que
  sobrevive ao reload). `ui: { layout: "StandaloneLayout" }` traz a página antiga
  de volta, com o script do standalone preset junto. `supportedSubmitMethods`
  mantém o default do Swagger UI, então o **Try it out** continua executando todo
  verbo até alguém restringir — o que agora é possível para API cujas chamadas
  são irreversíveis. Função passada em `ui` lança no mount em vez de ser
  descartada em silêncio pela serialização JSON. Closes #8.

- **api**: exports novos `DEFAULT_DOCS_FAVICON`, `REDOC_CDN_URL`,
  `resolveRedocBundle` e o tipo `RedocBundleSource`.

### Corrigido

- **api**: a página do Redoc não renderiza mais **em branco** quando o bundle
  falha ao carregar. CDN bloqueada, CSP restritiva ou `scriptUrl` errado faziam
  o `Redoc.init` nunca rodar e a página subia vazia, o que lê como serviço
  quebrado. Agora ela diz qual URL falhou, confirma que o documento OpenAPI
  continua servido, e explica como resolver.

- **api**: título de página e URL de favicon passam por escape de HTML, e valor
  embutido em `<script>` escapa `<`. Antes, título vindo de configuração podia
  fechar o elemento `<title>` e injetar markup.

### Docs

- A receita de API ganha as seções **Favicon**, **Configurando o Swagger UI** e
  **Redoc offline** (bilíngue),
  com a tabela do `bundle`, o aviso de rede fechada e a nota honesta de que o
  Redoc ainda busca a marca d'água dele em `cdn.redoc.ly`, de dentro do bundle.

## [0.22.0] — 2026-08-30

### Corrigido

- **BREAKING (comportamento) — schemas**: `?ascending=false` agora realmente
  ordena descendente. `paginationFilterSchema.ascending`,
  `cursorPaginationFilterSchema.ascending` e `syncFilterSchema.includeDeleted`
  eram construídos com `z.coerce.boolean()`, que é `Boolean(input)` — toda string
  não-vazia vira `true`, `"false"` e `"0"` inclusive — então **não havia como
  mandar `false` pela URL**. Passaram a usar o novo `looseBoolean`. Closes #4.

- **BREAKING (comportamento) — settings**: `DEBUG=false` agora desliga o debug. O
  campo `DEBUG` do `serverSettingsShape` tinha o mesmo defeito de
  `z.coerce.boolean()`, então qualquer valor não-vazio — `"false"` incluído —
  ligava o debug.

### Adicionado

- **schemas**: `looseBoolean(defaultValue)` — o campo booleano para valores que
  chegam como texto (query string, variável de ambiente). Lê
  `true`/`1`/`yes`/`on`/`y`/`enabled` e `false`/`0`/`no`/`off`/`n`/`disabled`,
  sem diferenciar maiúsculas e com trim; trata valor vazio ou só com espaço como
  ausente (então entrada não preenchida no `.env` cai no default); repassa
  booleanos de verdade; e **recusa** qualquer outra coisa, para um typo virar
  erro de validação em vez de um `false` silencioso. Construído sobre o
  `z.stringbool()` do zod 4. A metadata OpenAPI é fixada em `type: boolean` com o
  default, então o documento descreve o que o cliente manda, e não a união usada
  para parsear.

### Alterado

- **BREAKING (comportamento) — settings**: `envBoolean` passa a ser o
  `looseBoolean` sob o nome do domínio de settings — uma implementação só,
  compartilhada com os filtros de query, em vez de duas listas de token que
  divergem. Mesma assinatura, e todo token aceito antes continua parseando igual.
  Duas coisas mudam: **token não reconhecido agora é `ZodError`** em vez de um
  `false` silencioso, e **variável vazia** (`SMTP_USE_TLS=`) agora cai no default
  do campo em vez de ser lida como `false`. As duas fazem config de ambiente
  errada falhar no boot em vez de degradar em silêncio. Afeta todo campo booleano
  de settings: `LOG_JSON`, `SMTP_USE_TLS`, `SMTP_USE_SSL`, `MINIO_SECURE`,
  `SESSION_*`, `AUTH_*`.

### Docs

- Seção nova **`looseBoolean` — o booleano que chega como texto** na receita de
  campos validados (bilíngue), com a tabela de tokens e a nota de OpenAPI.
- A seção `envBoolean` da receita de configuração documenta a recusa de token
  desconhecido e a regra da variável vazia, e linka o `looseBoolean`.

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
