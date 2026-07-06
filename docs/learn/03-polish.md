# Capítulo 3 — Polimento: erros e filtros

No [Capítulo 2](02-crud.md) sua API já cria e lista tarefas. 🚀 Falta o acabamento: **buscar uma tarefa** pelo id (e responder 404 quando ela não existe), **marcar como concluída** e **filtrar** a lista. É o que fecha um CRUD de verdade.

Tudo o que segue vai **dentro** do `configure` do seu `app.ts`, junto das rotas que você já tem.

## Adicione as três rotas

Cole estas três rotas dentro do `configure`, logo depois do `POST`:

```ts
// Buscar UMA tarefa por id — 404 se não existir.
app.get("/api/tasks/:id", async (req, res) => {
  res.json(await controllerFor().getById(req.params.id));
});

// Marcar como concluída.
app.patch("/api/tasks/:id/done", async (req, res) => {
  const repo = new TaskRepository(engine.session());
  await repo.update({ id: req.params.id }, { done: true });
  res.json(await controllerFor().getById(req.params.id));
});

// Listar só as pendentes: GET /api/tasks?done=false
app.get("/api/tasks/pending", async (_req, res) => {
  res.json(await controllerFor().list({ done: false }));
});
```

Vamos por partes.

### Buscar uma tarefa (com 404 de graça)

```ts
app.get("/api/tasks/:id", async (req, res) => {
  res.json(await controllerFor().getById(req.params.id));
});
```

O `:id` na rota é um **parâmetro de rota** — o Express captura o pedaço da URL e o entrega em `req.params.id`. Então `getById(req.params.id)` pede ao controller a tarefa com aquele id.

E se o id não existir? `getById` lança `RecordNotFound`, e o SDK traduz isso para uma resposta **404** automaticamente — você não escreve nenhum tratamento. O corpo do erro se parece com:

```json
{ "detail": "...", "code": "NOT_FOUND", "details": {} }
```

!!! note "A mensagem exata pode variar"
    O `detail` acima é ilustrativo — o texto exato pode ser diferente na sua versão. O que importa é o **status 404** e o `code` `NOT_FOUND`.

### Marcar como concluída

```ts
app.patch("/api/tasks/:id/done", async (req, res) => {
  const repo = new TaskRepository(engine.session());
  await repo.update({ id: req.params.id }, { done: true });
  res.json(await controllerFor().getById(req.params.id));
});
```

Um `PATCH` é o verbo certo para uma **atualização parcial** — você muda só o campo `done`, não a tarefa inteira.

Aqui a gente vai direto ao repository: `repo.update({ id: req.params.id }, { done: true })`. O primeiro argumento é o **filtro** (quais linhas atualizar: as que têm este `id`); o segundo são os **campos a mudar** (`done: true`). Depois, um `getById` **re-busca** a tarefa já atualizada para devolvê-la na resposta.

!!! note "`update` recebe um filtro, não uma instância"
    Repare no formato: `update(filtro, campos)`. Você **não** passa um objeto de tarefa inteiro — passa um filtro (quais linhas) e o conjunto de campos a alterar. O método devolve **quantas linhas** foram afetadas. Para o CRUD completo do repository — criar, buscar, atualizar, deletar e paginar — veja a receita de [Banco de dados](../recipes/database.md).

### Filtrar a lista

```ts
app.get("/api/tasks/pending", async (_req, res) => {
  res.json(await controllerFor().list({ done: false }));
});
```

`list({ done: false })` usa o **objeto de filtro por convenção**: passe um objeto com `campo: valor` e você recebe só as linhas que batem. Aqui, só as tarefas onde `done` é `false` — ou seja, as pendentes. ✅

## Experimente

Primeiro, pegue o `id` de uma tarefa real (crie uma no Capítulo 2 e copie o `id`, ou liste com `GET /api/tasks`). Depois busque por ele:

```bash
curl http://127.0.0.1:8000/api/tasks/3f8c2b6e-0a1d-4e7a-9c11-2b3c4d5e6f70
```

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

Agora peça um id que **não existe** e veja o 404 automático:

```bash
curl -i http://127.0.0.1:8000/api/tasks/nao-existe
```

```text
HTTP/1.1 404 Not Found
content-type: application/json

{"detail":"...","code":"NOT_FOUND","details":{}}
```

Marque a tarefa como concluída com o `PATCH`:

```bash
curl -X PATCH http://127.0.0.1:8000/api/tasks/3f8c2b6e-0a1d-4e7a-9c11-2b3c4d5e6f70/done
```

```json
{
  "id": "3f8c2b6e-0a1d-4e7a-9c11-2b3c4d5e6f70",
  "isActive": true,
  "createdAt": "2026-07-06T12:00:00.000Z",
  "updatedAt": "2026-07-06T12:05:00.000Z",
  "title": "Comprar pão",
  "done": true
}
```

Repare que `done` virou `true`. 💡 Por fim, liste só as pendentes:

```bash
curl http://127.0.0.1:8000/api/tasks/pending
```

Como a única tarefa já foi concluída, a lista de pendentes vem vazia:

```json
[]
```

!!! tip "Sempre pode conferir no Swagger"
    Todas essas rotas aparecem em `http://127.0.0.1:8000/docs`, prontas para testar no navegador. 🚀

## Onde ir agora

Parabéns — você tem uma API de Lista de Tarefas **completa**: criar, listar, buscar, concluir e filtrar, com validação, tipos, docs e 404 automático. 🎉

Daqui, cada receita leva você um passo adiante num serviço de verdade:

- **[Autenticação (JWT)](../recipes/auth.md)** — exigir login e proteger rotas.
- **[Banco de dados](../recipes/database.md)** — paginação, migrations e um banco de produção.
- **[Testes](../recipes/testing.md)** — testar tudo isso com um banco em memória.
- **[Configuração](../recipes/settings.md)** e **[Endurecimento HTTP](../recipes/hardening.md)** — settings tipados e uma camada HTTP mais segura.

## Recapitulando

Neste capítulo você:

- Adicionou `GET /api/tasks/:id` com `getById`, ganhando **404 automático** via `RecordNotFound`.
- Marcou tarefas como concluídas com `repo.update(filtro, { done: true })` e re-buscou o resultado.
- Filtrou a lista com `list({ done: false })` usando o objeto de filtro por convenção.
- Testou cada rota por `curl` e conheceu os próximos passos.

Você saiu de uma pasta vazia e chegou a uma API completa, camada por camada. Agora é escolher a próxima receita e seguir construindo. ✅
