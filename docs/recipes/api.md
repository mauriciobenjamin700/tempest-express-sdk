# API: `createApp`, OpenAPI, Swagger e Redoc

`createApp` é a fábrica que monta uma aplicação Express **já cabeada**: parse de
JSON, request-id, CORS opcional, `/health`, seus routers, a documentação
(Swagger + Redoc a partir de schemas Zod) e, por último, o stack de tratamento
de erros. É o porte de `api.app` + `api.server` do `tempest-fastapi-sdk`.

Você quase nunca configura essas peças na mão — passa opções para `createApp` e
sobe com `runServer`.

---

## 1. O mínimo que sobe

```ts
import { createApp, runServer } from "tempest-express-sdk";

const app = await createApp();
await runServer(app, { host: "127.0.0.1", port: 8000 });
```

Isso já te dá:

- Body JSON parseado (limite `100kb`) + `urlencoded`.
- `X-Request-ID` em toda resposta (gerado se o cliente não mandar).
- `GET /health` respondendo `{ "status": "ok", "checks": {} }`.
- O envelope canônico de erro para qualquer `AppException` ou rota não-casada.

!!! note "`createApp` é assíncrono"
    Ele é `async` porque o hook `configure` pode ser assíncrono (abrir conexão,
    carregar chaves…). Sempre use `await`.

---

## 2. Registrando seus routers: o hook `configure`

Routers e paths de OpenAPI entram pelo hook `configure`, que roda **depois** dos
middlewares e **antes** do stack de erro — a ordem certa para o Express.

```ts hl_lines="5 6 7 8"
import { createApp, runServer } from "tempest-express-sdk";
import { usersRouter } from "@/api/routers/users";

const app = await createApp({
  configure: (app) => {
    app.use(usersRouter);
    // qualquer app.use / app.get vai aqui
  },
});

await runServer(app, { port: 8000 });
```

!!! warning "Não registre erro handler na mão"
    Não chame `registerExceptionHandlers` dentro do `configure` — o `createApp`
    já o registra **por último**, que é onde o Express exige que fique. Adicionar
    antes faz o handler não capturar as rotas registradas depois.

---

## 3. Opções do `createApp`

Todas opcionais. As mais usadas:

| Opção | Tipo | Default | Para |
| --- | --- | --- | --- |
| `corsOrigins` | `string \| string[] \| false` | `false` (sem CORS) | Libera origens. `"*"` ou lista. |
| `health` | `HealthRouterOptions \| false` | monta `/health` | Health check; `false` remove. |
| `configure` | `(app) => void \| Promise` | — | Monta routers e paths OpenAPI. |
| `openapi` | `CreateAppOpenApi` | — | Liga Swagger/Redoc (seção 4). |
| `catalog` | `MessageCatalog` | — | Mensagens de erro localizadas. |
| `errorHandling` | opções | — | Repassado ao handler de exceções. |
| `jsonLimit` | `string` | `"100kb"` | Tamanho máximo do body JSON. |

Exemplo cabeado:

```ts
const app = await createApp({
  corsOrigins: ["https://app.exemplo.com", "http://localhost:5173"],
  jsonLimit: "1mb",
  health: {
    checks: [
      {
        name: "db",
        check: async () => {
          await db.raw("SELECT 1");
          return true;
        },
      },
    ],
  },
  configure: (app) => {
    app.use(usersRouter);
  },
});
```

!!! tip "Bind: `127.0.0.1` vs `0.0.0.0`"
    O default de `runServer` é `127.0.0.1` (só local). Use `host: "0.0.0.0"`
    apenas quando outro host precisa alcançar o serviço (ex.: um front num
    container separado).

!!! note "`checks` é uma lista de `{ name, check }`"
    Cada probe é `{ name: string, check: () => Promise<boolean> | boolean }`. O
    `/health` roda todas, expõe o resultado em `checks` (`{ [name]: boolean }`) e
    **degrada para 503** com `status: "degraded"` se qualquer uma falhar (ou
    lançar). Sem checks, responde `200` com `{ status: "ok", checks: {} }`.

---

## 4. Documentação automática (OpenAPI → Swagger + Redoc)

Aqui está o pulo do gato: como cada schema Zod do SDK carrega `.openapi()`,
descrições e exemplos fluem direto para a documentação. O fluxo tem 3 passos.

### Passo 1 — crie um registry

```ts
import { createOpenApiRegistry, z } from "tempest-express-sdk";

const registry = createOpenApiRegistry();
```

### Passo 2 — registre schemas e paths

`registry.register(nome, schema)` publica um schema como **componente**
reutilizável; `registry.registerPath({...})` descreve uma rota.

```ts
const Item = registry.register(
  "Item",
  z.object({
    id: z.uuid().openapi({ description: "ID do item." }),
    name: z.string().openapi({ description: "Nome do item." }),
  }),
);

registry.registerPath({
  method: "get",
  path: "/api/items/{id}",
  summary: "Busca um item",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: { description: "ok", content: { "application/json": { schema: Item } } },
  },
});
```

### Passo 3 — passe o registry para o `createApp`

```ts hl_lines="4 5 6 7 8"
const app = await createApp({
  configure: (app) => {
    app.use(itemsRouter);
  },
  openapi: {
    registry,
    info: { title: "Minha API", version: "1.0.0", description: "Demo." },
    servers: [{ url: "http://127.0.0.1:8000" }],
  },
});
```

Com isso o app passa a servir:

| Rota | O quê |
| --- | --- |
| `GET /openapi.json` | O documento OpenAPI 3.0 gerado. |
| `GET /docs` | Swagger UI (interativo, servido **offline**). |
| `GET /redoc` | Redoc (referência de leitura). |

Opções do bloco `openapi` (`CreateAppOpenApi`):

| Campo | Default | Para |
| --- | --- | --- |
| `registry` | — (obrigatório) | O registry populado. |
| `info` | — (obrigatório) | `{ title, version, description? }`. |
| `servers` | — | Lista `{ url, description? }`. |
| `v31` | `false` | Emite OpenAPI 3.1 no lugar de 3.0. |
| `jsonPath` | `/openapi.json` | Rota do JSON. |
| `swaggerPath` | `/docs` | Mount do Swagger; `false` desliga. |
| `redocPath` | `/redoc` | Mount do Redoc; `false` desliga. |
| `swagger` | — | `{ title?, favicon?, ui? }` da página do Swagger. |
| `redoc` | — | `{ title?, favicon?, bundle?, bundlePath?, scriptUrl? }` da página do Redoc. |

### Favicon: as duas páginas já trazem um

Sem `<link rel="icon">`, o browser pede `/favicon.ico` **na raiz da origem**. Num
serviço que só serve API, essa raiz não tem favicon: o pedido dá 404, ou 401 se
estiver atrás do middleware de auth, ou cai numa rota SPA. Resultado — um erro
vermelho no console em toda visita a `/docs`:

```
[ERROR] Failed to load resource: the server responded with a status of 401
        (Unauthorized) @ http://127.0.0.1:3111/favicon.ico
```

As duas páginas declaram um ícone SVG inline (`data:` URI), então o pedido nunca
sai. Para trocar pelo seu:

```ts
const app = await createApp({
  openapi: {
    registry,
    info: { title: "Minha API", version: "1.0.0" },
    swagger: { favicon: "/static/icon.svg" },
    redoc: { favicon: "/static/icon.svg" },
  },
});
```

`favicon: false` omite a tag — aí o browser volta a pedir `/favicon.ico`, que é o
que você quer se a raiz **tem** um favicon de verdade para servir.

### Configurando o Swagger UI: a opção `ui`

O `SwaggerOptions.ui` é repassado direto para o construtor do `SwaggerUIBundle`,
depois dos defaults do SDK e antes dos `presets`. Qualquer opção que o Swagger UI
aceite e que o JSON consiga carregar passa por aí.

Três defaults que o SDK escolhe, diferentes do que o Swagger UI faz sozinho:

| Opção | Swagger UI | Aqui | Por quê |
| --- | --- | --- | --- |
| `layout` | `StandaloneLayout` | `BaseLayout` | Sem a topbar **Explore** |
| `deepLinking` | `false` | `true` | Operação vira link compartilhável |
| `persistAuthorization` | `false` | `true` | Credencial sobrevive ao reload |

!!! warning "Por que sair do `StandaloneLayout`"
    O standalone renderiza a topbar **Explore**: um campo de URL editável que
    carrega **qualquer spec de qualquer origem**. Ele existe para o editor/demo
    do Swagger, onde escolher a spec é o ponto. Numa página que documenta *um*
    serviço, é superfície que ninguém pediu — o leitor troca a sua spec por
    outra e a sua URL passa a documentar outra API. Nada do servidor vaza, mas
    também não há motivo para oferecer isso.

    Quer de volta? `ui: { layout: "StandaloneLayout" }` — o SDK reinclui o
    script do standalone preset junto.

#### Desligue o "Try it out" quando o efeito é irreversível

O Swagger UI liga **Try it out** em todos os verbos. Num gateway de mensagem,
`POST /message/send-text` pela página de docs **manda mensagem de verdade**:

```ts
mountSwaggerUi(app, "/docs", "/openapi.json", {
  ui: { supportedSubmitMethods: ["get"] },   // só leitura pode ser executada
});

mountSwaggerUi(app, "/docs", "/openapi.json", {
  ui: { supportedSubmitMethods: [] },        // documenta, não executa
});
```

O default continua sendo o do Swagger UI (todos os verbos) — é a escolha certa
para a maioria das APIs, e agora é uma escolha.

!!! danger "Função em `ui` lança no mount"
    As opções são serializadas em JSON dentro do `<script>` da página, e o
    `JSON.stringify` **descarta função em silêncio**. Um `requestInterceptor`
    passado aqui simplesmente nunca rodaria, sem nada indicando o porquê — então
    o `mountSwaggerUi` lança na hora, dizendo qual chave é a culpada. Opção do
    Swagger UI que recebe callback tem que ser ligada no browser.

### Redoc offline: instale o `redoc` ao lado do serviço

O Swagger UI é offline por construção — os assets vêm do `swagger-ui-dist`,
servidos em `${swaggerPath}/assets`. O renderer do Redoc tem ~1 MB e **não** é
embutido: o pacote `redoc` traz 22 dependências e peers em `react`, `react-dom`,
`styled-components`, `mobx` e `core-js`, bounds que nenhum serviço backend
deveria herdar só para renderizar uma página de referência.

Ele é **peer dependency opcional**. Instale e a página passa a servir o bundle
do próprio serviço, sem tocar em CDN:

```bash
npm install redoc
```

| `bundle` | O que faz |
| --- | --- |
| `"auto"` (default) | Serve o bundle do `redoc` quando ele está instalado; cai para a CDN quando não está. |
| `"local"` | Serve do disco e **lança no mount** se o `redoc` não estiver instalado. |
| `"cdn"` | Sempre carrega da jsDelivr. |

```ts
redoc: { bundle: "local" }                              // falha alto, nunca degrada
redoc: { bundlePath: "/opt/app/redoc.standalone.js" }   // cópia sua, servida pelo SDK
redoc: { scriptUrl: "/vendor/redoc.standalone.js" }     // URL que você já serve
```

!!! warning "Rede fechada: `"local"`, não `"auto"`"
    Em deploy air-gapped ou com CSP restritiva, `"auto"` cai silenciosamente
    para a CDN se alguém esquecer de instalar o `redoc` — e a página falha **em
    branco**, porque o `<script>` não carrega e o `Redoc.init` nunca roda.
    `"local"` transforma esse esquecimento num erro no boot.

!!! note "Quando o bundle não carrega, a página explica"
    Em vez da tela branca, ela mostra qual URL falhou, confirma que o
    `/openapi.json` continua de pé e diz como resolver. Vale para a CDN
    bloqueada e para um `scriptUrl` errado.

!!! info "O Redoc ainda busca a marca d'água dele"
    Mesmo com o bundle local, o Redoc pede
    `https://cdn.redoc.ly/redoc/logo-mini.svg` — é o logo "API docs by Redocly"
    embutido no bundle deles, fora do controle do SDK. Sem rede, some a
    imagenzinha; a página renderiza normal.

!!! check "Sem barra final também funciona"
    A partir da v0.20.1 os assets do Swagger usam caminho **absoluto**
    (`/docs/assets/...`), então `GET /docs` **e** `GET /docs/` renderizam a UI
    completa. Antes, visitar `/docs` sem a barra buscava `/assets/...` e a página
    subia sem estilo (assets 404). Se você fixou uma versão anterior, atualize.

---

## 5. Montando a doc manualmente (avançado)

Se você não usa `createApp` (app Express legado, por exemplo), monte as peças na
mão:

```ts
import express from "express";
import {
  createOpenApiRegistry,
  generateOpenApiDocument,
  mountOpenApiJson,
  mountSwaggerUi,
  mountRedoc,
} from "tempest-express-sdk";

const app = express();
const registry = createOpenApiRegistry();
// ... registry.register / registerPath ...

const document = generateOpenApiDocument(registry, {
  info: { title: "Minha API", version: "1.0.0" },
});

mountOpenApiJson(app, "/openapi.json", document);
mountSwaggerUi(app, "/docs", "/openapi.json", { title: "Minha API" });
mountRedoc(app, "/redoc", "/openapi.json");
```

`generateOpenApiDocument` devolve um objeto JSON puro — dá para salvá-lo num
arquivo, versioná-lo ou servi-lo de onde quiser.

---

## Recapitulando

- `createApp(options)` monta middlewares → routers (`configure`) → docs → erro,
  nessa ordem; `runServer(app, { host, port })` sobe.
- Registre routers dentro de `configure`; **não** registre o error handler à mão.
- Documentação em 3 passos: `createOpenApiRegistry()` → `register`/`registerPath`
  → passe o registry em `openapi`. Ganha `/openapi.json`, `/docs` e `/redoc`.
- `swagger: { ui: {...} }` repassa opção para o `SwaggerUIBundle`; os defaults
  daqui são `BaseLayout` (sem topbar Explore), `deepLinking` e
  `persistAuthorization`.
- Swagger é offline; o Redoc também, uma vez instalado o `redoc`
  (`bundle: "local"` para recusar o fallback de CDN). As duas páginas trazem
  favicon, então nenhum pedido a `/favicon.ico` bate na raiz da sua API.
- `/docs` e `/docs/` funcionam igual — assets em caminho absoluto. 🚀
