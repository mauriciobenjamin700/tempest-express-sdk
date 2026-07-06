# Capítulo 2 — CRUD completo

No [Capítulo 1](01-setup.md) você subiu o servidor com um `TaskModel`, uma `engine` SQLite, um `TaskRepository` e **uma** rota: `GET /api/tasks`. 🚀

Agora vamos deixar a API de verdade: você vai **criar tarefas** com um `POST`, validar a entrada e devolver a tarefa criada — sem perder o `GET` que já funciona.

## As camadas, uma de cada vez

Antes de escrever código, vale entender **por que** vamos adicionar três peças. Cada camada tem um único trabalho:

**Schema** — descreve o **formato** dos dados: o que entra numa requisição e o que sai numa resposta. É ele quem valida a entrada (título vazio? erro!) e quem garante que a resposta sempre tem os mesmos campos.

**Service** — é a **regra de negócio**. Ele conversa com o repository (o banco) e sabe traduzir uma linha crua da tabela no formato de resposta que o cliente espera.

**Controller** — é a **fronteira de orquestração**. A rota fala com o controller, o controller fala com o service. Numa API pequena ele é fino, mas mantê-lo deixa o desenho igual ao de um serviço Tempest de verdade.

O caminho de uma requisição, então, é sempre este:

```text
router → controller → service → repository → banco
```

!!! tip "Uma peça de cada vez"
    Não decore tudo agora. Adicione o código, rode, veja funcionar — a intuição vem com o uso. 💡

## Adicione o schema e as camadas

Abra o seu `app.ts`. Logo **depois** da classe `TaskRepository`, cole este bloco:

```ts
import { BaseController, BaseService, baseResponseSchema, z } from "tempest-express-sdk";

// Formato de entrada ao criar uma tarefa.
const taskCreateSchema = z.object({
  title: z.string().min(1),
  done: z.boolean().default(false),
});

// Formato da resposta (herda id/isActive/createdAt/updatedAt do baseResponseSchema).
const taskResponseSchema = baseResponseSchema.extend({
  title: z.string(),
  done: z.boolean(),
});

type TaskResponse = z.infer<typeof taskResponseSchema>;

class TaskService extends BaseService<typeof TaskModel, TaskResponse> {
  constructor(repository: TaskRepository) {
    super(repository, (row) => ({
      id: row.id,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      title: row.title,
      done: row.done,
    }));
  }
}

class TaskController extends BaseController<typeof TaskModel, TaskResponse> {
  constructor(service: TaskService) {
    super(service);
  }
}
```

!!! note "Junte os imports no topo"
    Você já importava algumas coisas no topo do `app.ts` (no Capítulo 1). Em vez de repetir a linha `import`, adicione os novos nomes — `BaseController`, `BaseService`, `baseResponseSchema` e `z` — ao import que já existe. Um único `import { ... } from "tempest-express-sdk";` no topo é o suficiente.

Vamos ler o bloco linha a linha:

- `taskCreateSchema` descreve **o que o cliente envia** ao criar uma tarefa: um `title` que é uma string com no mínimo 1 caractere (`z.string().min(1)`) e um `done` opcional que, se ausente, vira `false` (`z.boolean().default(false)`).
- `taskResponseSchema` descreve **o que a API devolve**. Ele parte de `baseResponseSchema` (que já traz `id`, `isActive`, `createdAt` e `updatedAt`) e acrescenta (`.extend(...)`) os campos do seu domínio: `title` e `done`.
- `type TaskResponse = z.infer<typeof taskResponseSchema>;` cria o **tipo TypeScript** a partir do schema. Você escreve o formato **uma vez** (no schema) e o TypeScript deriva o tipo sozinho — nada de manter duas definições em sincronia.
- `TaskService` estende `BaseService`. No `super(...)` você passa dois argumentos: o `repository` (quem fala com o banco) e uma **função de mapeamento** que recebe uma linha crua (`row`) e devolve o objeto de resposta. É aqui que a linha do banco vira uma `TaskResponse`.
- `TaskController` estende `BaseController` e só recebe o `service`. Fino de propósito — é a fronteira que a rota chama.

## Ligue as rotas

Agora **substitua** o bloco `createApp` inteiro por este:

```ts
const app = await createApp({
  configure: (app) => {
    const controllerFor = () =>
      new TaskController(new TaskService(new TaskRepository(engine.session())));

    app.get("/api/tasks", async (_req, res) => {
      res.json(await controllerFor().list());
    });

    app.post("/api/tasks", async (req, res) => {
      const data = taskCreateSchema.parse(req.body); // inválido → 422 automático
      res.status(201).json(await controllerFor().create(data));
    });
  },
});
```

O que mudou:

- `controllerFor()` é um pequeno ajudante que **monta a pilha** a cada requisição: cria um `TaskRepository` com uma sessão nova (`engine.session()`), embrulha num `TaskService` e, por fim, num `TaskController`. Uma sessão fresca por requisição é o padrão correto.
- A rota `GET /api/tasks` continua igual: chama `controllerFor().list()`, que devolve todas as tarefas já mapeadas para `TaskResponse`, e responde com `res.json(...)`.
- A rota `POST /api/tasks` é a novidade. Primeiro `taskCreateSchema.parse(req.body)` **valida** o corpo da requisição. Se o corpo for inválido (por exemplo, `title` vazio), o SDK responde **422** automaticamente — você não escreve nenhum `if`. Se for válido, `controllerFor().create(data)` **insere** a tarefa e devolve a resposta já mapeada, com um `id` gerado. O `res.status(201)` marca o clássico "Created". ✅

## Experimente

Suba o servidor (como no Capítulo 1) e crie uma tarefa com `curl`:

```bash
curl -X POST http://127.0.0.1:8000/api/tasks \
  -H "content-type: application/json" \
  -d '{"title":"Comprar pão"}'
```

A resposta será parecida com esta (os valores de `id` e datas serão diferentes na sua máquina):

```json
{
  "id": "3f8c2b6e-0a1d-4e7a-9c11-2b3c4d5e6f70",
  "isActive": true,
  "createdAt": "2026-07-06T12:00:00.000Z",
  "updatedAt": "2026-07-06T12:00:00.000Z",
  "title": "Comprar pão",
  "done": false
}
```

Repare: você só enviou `title`, mas a resposta veio completa — `done` virou `false` (o padrão do schema) e o `id`, `isActive`, `createdAt` e `updatedAt` foram preenchidos pelo banco. 💡

Agora liste as tarefas:

```bash
curl http://127.0.0.1:8000/api/tasks
```

E a tarefa que você acabou de criar aparece na lista:

```json
[
  {
    "id": "3f8c2b6e-0a1d-4e7a-9c11-2b3c4d5e6f70",
    "isActive": true,
    "createdAt": "2026-07-06T12:00:00.000Z",
    "updatedAt": "2026-07-06T12:00:00.000Z",
    "title": "Comprar pão",
    "done": false
  }
]
```

!!! tip "Prefere clicar a digitar?"
    Abra `http://127.0.0.1:8000/docs` no navegador. O **Swagger UI** mostra as duas rotas, com um botão **Try it out** para criar e listar tarefas sem sair do browser. É a mesma API — só que interativa. 🚀

!!! info "Você definiu o Task uma vez"
    Note o que ganhou de graça: um **único** schema (`taskCreateSchema` + `taskResponseSchema`) deu **validação** da entrada, **tipos** TypeScript (via `z.infer`) e **documentação** no Swagger — tudo a partir da mesma fonte. Definiu uma vez, usou em três lugares. ✅

## Recapitulando

Neste capítulo você:

- Entendeu o papel de cada camada — **schema** (formato), **service** (regra de negócio + mapeamento) e **controller** (fronteira).
- Escreveu `taskCreateSchema` e `taskResponseSchema`, e derivou o tipo `TaskResponse` com `z.infer`.
- Adicionou o `POST /api/tasks`, que **valida** com `parse` (422 automático) e **cria** com `create`.
- Testou criando e listando tarefas, por `curl` e pelo Swagger.

Sua API já cria e lista. Falta tratar os casos "e se não existir?" e filtrar as tarefas. Bora polir. 👉

👉 Continue no **[Capítulo 3 — Polimento: erros e filtros](03-polish.md)**.
