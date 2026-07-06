# Seu primeiro app

Hora de rodar uma API de verdade — do zero, um comando de cada vez. No fim desta
página você vai ter um servidor no ar com **documentação interativa** gerada
sozinha. 🚀

!!! info "Pré-requisitos"
    Você precisa do Node.js **≥ 20** instalado. Se ainda não tem, volte em
    [Instalando o Node.js](node.md). Um pouco de familiaridade com
    [JavaScript/TypeScript](javascript.md) ajuda, mas vamos explicar cada linha.

---

## 1. Crie a pasta do projeto

No terminal, crie uma pasta e entre nela:

```bash
mkdir meu-primeiro-app
cd meu-primeiro-app
```

Depois inicie um projeto Node. O `-y` aceita todas as respostas padrão:

```bash
npm init -y
```

Isso cria um arquivo `package.json` — o **manifesto** do seu projeto.

---

## 2. Ative os módulos modernos

Abra o `package.json` e adicione a linha `"type": "module"`. Ela liga o
`import`/`export` (ES modules) que o SDK usa:

```json hl_lines="5"
{
  "name": "meu-primeiro-app",
  "version": "1.0.0",
  "main": "index.js",
  "type": "module"
}
```

!!! note "Por que isso?"
    Sem `"type": "module"`, o Node usa o formato antigo (`require`). Os exemplos
    do SDK usam `import`, então essa linha evita um erro logo de cara.

---

## 3. Instale o SDK e as dependências

```bash
npm install tempest-express-sdk tempest-db-js express zod
```

- **tempest-express-sdk** — o SDK (o que este guia ensina).
- **tempest-db-js** — a camada de banco (dependência obrigatória do SDK).
- **express** — o servidor HTTP por baixo.
- **zod** — validação de dados.

Agora as ferramentas para rodar TypeScript direto, sem etapa de build:

```bash
npm install --save-dev tsx typescript @types/node @types/express
```

!!! tip "O que é o `tsx`?"
    `tsx` roda um arquivo `.ts` **direto**, sem você precisar compilar antes.
    Perfeito pra aprender. Em produção você compila (o SDK cuida disso pra você
    mais tarde).

---

## 4. Escreva o app

Crie um arquivo chamado `app.ts` com este conteúdo — é um programa **completo**,
pode copiar inteiro:

```ts title="app.ts"
import { createApp, createOpenApiRegistry, runServer, z } from "tempest-express-sdk";

// 1. Um "registro" guarda os schemas que viram documentação OpenAPI.
const registry = createOpenApiRegistry();

// 2. Descreva o formato de um "item" UMA vez, com Zod.
const itemSchema = registry.register(
  "Item",
  z.object({
    id: z.string().uuid(),
    name: z.string(),
  }),
);

// 3. Monte o app. `createApp` já liga JSON, CORS, health check e os erros.
const app = await createApp({
  corsOrigins: "*",
  openapi: { registry, info: { title: "Meu primeiro app", version: "1.0.0" } },
  configure: (app) => {
    // 4. Uma rota que responde uma lista (vazia, por enquanto).
    app.get("/api/items", (_req, res) => {
      res.json([]);
    });
  },
});

// 5. Suba o servidor.
await runServer(app, { host: "127.0.0.1", port: 8000 });
```

Cada bloco tem um papel: registrar o schema, montar o app, declarar uma rota,
subir o servidor. Vamos rodar. ✅

---

## 5. Rode

```bash
npx tsx app.ts
```

Você deve ver algo como:

```json
{"level":"info","logger":"tempest_express_sdk.api.server","message":"Server listening","requestId":null,"host":"127.0.0.1","port":8000}
```

O servidor está no ar. 🎉

---

## 6. Veja a mágica

Abra no navegador:

- **[http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)** — Swagger UI, a
  documentação **interativa** (dá pra testar as rotas ali mesmo).
- **[http://127.0.0.1:8000/redoc](http://127.0.0.1:8000/redoc)** — Redoc, uma
  versão mais "leitura".
- **[http://127.0.0.1:8000/openapi.json](http://127.0.0.1:8000/openapi.json)** — a
  especificação OpenAPI crua.
- **[http://127.0.0.1:8000/health](http://127.0.0.1:8000/health)** — o health
  check (`{"status":"ok","checks":{}}`).

!!! check "Você definiu o schema uma vez"
    …e ganhou validação, tipos **e** documentação de graça. Esse é o ponto
    central do SDK.

Pra parar o servidor, volte ao terminal e aperte ++ctrl+c++.

---

## Atalho: o gerador

Fazer tudo à mão foi ótimo pra entender as peças. Da próxima vez, o SDK monta um
projeto completo pra você:

```bash
npx tempest-express new meu-servico
cd meu-servico
npm install
npm run dev
```

Isso gera a estrutura em camadas inteira (model → repository → service →
controller → router → app) já pronta.

---

## Recapitulando

- `npm init` + `"type": "module"` + `npm install` prepararam o projeto.
- `npx tsx app.ts` roda TypeScript sem build.
- `createApp` te deu Swagger, Redoc, health e tratamento de erro sem esforço.
- Um schema Zod virou documentação interativa automaticamente.

Agora que a base roda, siga para o [Tutorial](../tutorial.md) — ele adiciona
**um** conceito de cada vez sobre esse começo. Se esbarrar num termo que não
conhece, o [Glossário](glossary.md) explica. 💡
