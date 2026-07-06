# Tutorial

Vamos construir uma API passo a passo. Cada passo adiciona **um** conceito sobre
o anterior — e explica o porquê, não só o como. 💡

!!! info "Antes de começar"
    Se você ainda não rodou um app, faça primeiro [Seu primeiro app](getting-started/first-app.md)
    — ele monta a pasta, instala tudo e mostra como rodar com `npx tsx`. Aqui a
    gente assume que você consegue criar um arquivo `.ts` e rodá-lo. Termo
    estranho pela frente? O [Glossário](getting-started/glossary.md) explica.

Coloque cada exemplo num arquivo (ex. `app.ts`) e rode com `npx tsx app.ts`.

---

## 1. O primeiro app

`createApp` monta o "esqueleto" convencional de um serviço — parsing de JSON, um
id por requisição, CORS, um health check e o tratamento de erros — e devolve um
app [Express](getting-started/glossary.md) pronto. `runServer` sobe ele.

```ts title="app.ts"
import { createApp, runServer } from "tempest-express-sdk";

const app = await createApp();
await runServer(app, { port: 8000 });
```

Rode (`npx tsx app.ts`) e acesse
[http://127.0.0.1:8000/health](http://127.0.0.1:8000/health) →
`{"status":"ok","checks":{}}`. ✅

!!! note "O que é `await`?"
    `createApp` e `runServer` são **assíncronos** (devolvem uma Promise), por isso
    o `await`. Se isso é novo, dê uma olhada em
    [async/await](getting-started/javascript.md).

**Recap:** `createApp()` + `runServer()` = um servidor no ar, com `/health` de
graça.

---

## 2. Um schema Zod com OpenAPI

Um **schema** descreve o formato de um dado. Importe o `z` do SDK (é o
[Zod](getting-started/glossary.md) já com `.openapi()`) e registre o schema num
"registro" — ele vira documentação depois:

```ts
import { createApp, createOpenApiRegistry, runServer, z } from "tempest-express-sdk";

const registry = createOpenApiRegistry();

const itemSchema = registry.register(
  "Item",
  z.object({
    id: z.string().uuid().openapi({ description: "Identificador do item." }),
    name: z.string().openapi({ description: "Nome do item." }),
  }),
);
```

`z.object({...})` diz "um objeto com estes campos"; `z.string().uuid()` diz "uma
string que é um UUID". O `.openapi({ description })` anexa a descrição que aparece
na documentação.

**Recap:** você descreveu o `Item` **uma vez**. Já já isso vira validação **e**
documentação.

---

## 3. Rotas + documentação nativa

Uma **rota** liga um caminho (`/api/items`) a uma função que responde. Passe
`openapi` para o `createApp` e registre rotas dentro de `configure`:

```ts hl_lines="4 5 6 7 8 9 10 11"
const app = await createApp({
  openapi: { registry, info: { title: "Catálogo", version: "1.0.0" } },
  configure: (app) => {
    registry.registerPath({
      method: "get",
      path: "/api/items",
      summary: "Lista itens",
      responses: {
        200: { description: "OK", content: { "application/json": { schema: itemSchema.array() } } },
      },
    });
    app.get("/api/items", (_req, res) => res.json([]));
  },
});

await runServer(app, { port: 8000 });
```

Duas coisas acontecem: `registry.registerPath({...})` **documenta** a rota, e
`app.get(...)` **implementa** ela. A função `(_req, res) => res.json([])` é o
**handler** — recebe a requisição (`req`) e a resposta (`res`), e devolve uma
lista vazia por enquanto.

!!! tip "Docs de graça"
    Abra [`/docs`](http://127.0.0.1:8000/docs) (Swagger UI) e
    [`/redoc`](http://127.0.0.1:8000/redoc) — ambos gerados do registry, sem você
    escrever documentação à mão.

!!! note "Por que `_req` com underline?"
    Uma convenção: o `_` no começo avisa "não uso esse parâmetro". Aqui o handler
    ignora a requisição e sempre devolve `[]`.

**Recap:** `registerPath` documenta, `app.get/post/...` implementa. Swagger e
Redoc saem prontos.

---

## 4. Validação de entrada

Quando o cliente **envia** dados (um `POST`), você valida com o schema. Um dado
inválido vira **422** no envelope padrão, automaticamente:

```ts
const createSchema = z.object({ name: z.string().min(1) });

app.post("/api/items", (req, res) => {
  const data = createSchema.parse(req.body); // lança ZodError → 422
  res.status(201).json({ id: crypto.randomUUID(), ...data });
});
```

`createSchema.parse(req.body)` confere o corpo da requisição. Se `name` estiver
faltando ou vazio, o `.parse` **lança** um erro que o SDK transforma nesta
resposta:

```json
{ "detail": "Validation error", "code": "VALIDATION_ERROR", "details": { "issues": [ ] } }
```

Se passar, você responde **201 Created** com o item novo (`crypto.randomUUID()`
gera um id).

!!! info "Você não escreve o `try/catch`"
    O handler de erros que o `createApp` instalou pega o `ZodError` e monta o
    422. Você só valida e segue.

**Recap:** `schema.parse(req.body)` valida a entrada; erro vira 422 sozinho;
sucesso responde 201.

---

## 5. Erros de domínio

Quando **a sua regra** falha (item não existe, e-mail duplicado), lance uma
subclasse de `AppException` — o handler serializa pro mesmo envelope, com o
status certo:

```ts
import { NotFoundException } from "tempest-express-sdk";

app.get("/api/items/:id", (req) => {
  throw new NotFoundException({
    message: "Item não encontrado",
    details: { id: req.params.id },
  });
});
```

→ HTTP **404**,
`{"detail":"Item não encontrado","code":"NOT_FOUND","details":{"id":"…"}}`.

`:id` na rota é um **parâmetro**: em `/api/items/42`, `req.params.id` é `"42"`.
Existem subclasses prontas para os casos comuns — `NotFoundException` (404),
`ConflictException` (409), `UnauthorizedException` (401), etc.

**Recap:** lance `AppException` (ou subclasse) e o envelope + status saem
consistentes em toda a API.

---

## 6. Persistência em camadas

Até aqui os dados eram inventados na hora. Para **guardar** de verdade, você
define um **model** (o formato de uma tabela) e ganha um repository tipado sobre o
[`tempest-db-js`](getting-started/glossary.md):

```ts
import { BaseModel, column, tableNameFor } from "tempest-express-sdk";

class ItemModel extends BaseModel {
  static tablename = tableNameFor("ItemModel"); // "item"
  name = column.text().notNull();
}
```

`BaseModel` já traz `id` (UUID), `isActive`, `createdAt` e `updatedAt` — você só
declara as colunas do seu domínio (aqui, `name`). Sobre esse model, o SDK oferece
a pilha completa **repository → service → controller → router**:

- **repository** — lê e escreve linhas.
- **service** — regra de negócio; mapeia a linha para a resposta.
- **controller** — orquestra.
- **router** — expõe as rotas.

Rode `npx tempest-express generate Item` e **tudo isso é gerado para você**.

!!! tip "O guia completo do banco"
    Modelar tabelas, conectar a engine, filtrar, paginar e migrar está em
    [Banco de dados (models + repositories)](recipes/database.md). Para testar sem
    banco de verdade, veja [Testes](recipes/testing.md).

**Recap:** herde `BaseModel`, declare suas colunas, e ganhe a pilha tipada — ou
gere ela com um comando.

---

## Recapitulando

Você montou um app, descreveu um schema com OpenAPI, serviu Swagger/Redoc
nativos, validou entradas (422), lançou erros de domínio (com status certo) e
conheceu a camada de dados. Esse é o esqueleto de **qualquer** serviço Tempest. 🎉

**Continue por:**

- [Banco de dados](recipes/database.md) — modele e persista de verdade.
- [Autenticação (JWT)](recipes/auth.md) — proteja rotas por usuário e role.
- [Configuração](recipes/settings.md) — settings tipados via variáveis de ambiente.
- Perdido num termo? [Glossário](getting-started/glossary.md).
