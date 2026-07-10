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
    id: z.string().uuid().openapi({ description: "ID do item." }),
    name: z.string().openapi({ description: "Nome do item." }),
  }),
);

registry.registerPath({
  method: "get",
  path: "/api/items/{id}",
  summary: "Busca um item",
  request: { params: z.object({ id: z.string().uuid() }) },
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
| `swagger` | — | `{ title? }` da página do Swagger. |
| `redoc` | — | `{ title?, scriptUrl? }` da página do Redoc. |

!!! info "Swagger é 100% offline; Redoc usa CDN"
    Os assets do Swagger UI vêm do pacote `swagger-ui-dist` e são servidos
    localmente em `${swaggerPath}/assets` — nenhuma chamada externa. O Redoc
    carrega o bundle (~1 MB) da CDN jsDelivr por padrão; para self-hostar, passe
    `redoc: { scriptUrl: "/vendor/redoc.standalone.js" }`.

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
- Swagger é offline; Redoc usa CDN (self-hostável via `scriptUrl`).
- `/docs` e `/docs/` funcionam igual — assets em caminho absoluto. 🚀
