# Tutorial

Vamos construir uma API passo a passo. Cada passo adiciona **um** conceito sobre
o anterior. 💡

## 1. O primeiro app

`createApp` monta o stack convencional (JSON, request-id, CORS, health, handlers
de erro) e devolve um app Express pronto:

```ts
import { createApp, runServer } from "tempest-express-sdk";

const app = await createApp();
await runServer(app, { port: 8000 });
```

Acesse `http://127.0.0.1:8000/health` → `{"status":"ok","checks":{}}`. ✅

## 2. Um schema Zod com OpenAPI

Importe o `z` do SDK (já com `.openapi()`) e registre o schema:

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

## 3. Rotas + documentação nativa

Passe `openapi` e mexa nas rotas dentro de `configure`:

```ts hl_lines="3 4 5 6 7 8"
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

!!! tip "Docs grátis"
    Abra `/docs` (Swagger UI) e `/redoc` (Redoc) — ambos gerados do registry.

## 4. Validação de entrada

Valide o corpo com o schema; um erro de validação vira **422** no envelope padrão
automaticamente:

```ts
const createSchema = z.object({ name: z.string().min(1) });

app.post("/api/items", (req, res) => {
  const data = createSchema.parse(req.body); // lança ZodError → 422
  res.status(201).json({ id: crypto.randomUUID(), ...data });
});
```

Um corpo inválido responde:

```json
{ "detail": "Validation error", "code": "VALIDATION_ERROR", "details": { "issues": [ ... ] } }
```

## 5. Erros de domínio

Lance qualquer subclasse de `AppException` — o handler serializa para o envelope:

```ts
import { NotFoundException } from "tempest-express-sdk";

app.get("/api/items/:id", (req) => {
  throw new NotFoundException({ message: "Item não encontrado", details: { id: req.params.id } });
});
```

→ HTTP **404**, `{"detail":"Item não encontrado","code":"NOT_FOUND","details":{"id":"…"}}`.

## 6. Persistência em camadas

Com o `tempest-db-js` você define um model e ganha repository tipado:

```ts
import { BaseModel, BaseService, column, tableNameFor } from "tempest-express-sdk";

class ItemModel extends BaseModel {
  static tablename = tableNameFor("ItemModel"); // "item"
  name = column.text().notNull();
}
```

`BaseModel` já traz `id` (UUID), `isActive`, `createdAt` e `updatedAt`.
Use `BaseRepository` / `BaseService` / `BaseController` para a pilha completa —
ou rode `tempest-express generate Item` e tudo isso é gerado para você.

O guia completo — modelar tabelas, conectar a engine, subir o repository, filtrar,
paginar e migrar — está em [Banco de dados (models + repositories)](recipes/database.md).

## Recapitulando

Você montou um app, registrou um schema com OpenAPI, serviu Swagger/Redoc nativos,
validou entradas (422), lançou erros de domínio e conheceu a camada de dados.
Continue em [Autenticação (JWT)](recipes/auth.md). 🎉
