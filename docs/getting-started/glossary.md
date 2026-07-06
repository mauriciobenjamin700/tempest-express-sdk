# Glossário

Um dicionário rápido dos termos que aparecem na documentação. Não precisa
decorar — volte aqui sempre que esbarrar numa palavra nova. 💡

## Node e JavaScript

**Node.js** — o programa que roda JavaScript fora do navegador (no servidor).
Veja [Instalando o Node.js](node.md).

**npm** — o gerenciador de pacotes do Node. Instala bibliotecas (`npm install`) e
roda scripts (`npm run`).

**Pacote** — um pedaço de código reutilizável publicado no npm (o
`tempest-express-sdk` é um). Listado no `package.json`, baixado para
`node_modules/`.

**Módulo** — um arquivo de código. `import`/`export` movem coisas entre módulos.

**Promise / `async` / `await`** — uma Promise é "um valor que chega depois" (uma
consulta ao banco, uma requisição HTTP). `await` espera ela; `async` marca a
função que pode esperar. Veja [Essenciais de JS/TS](javascript.md).

**TypeScript (TS)** — JavaScript com tipos. Pega erros antes de rodar e dá
autocomplete. O SDK é escrito em TS.

## Web e HTTP

**HTTP** — o protocolo da web. Um cliente faz uma **requisição** (request), o
servidor devolve uma **resposta** (response).

**Método HTTP** — o verbo da requisição: `GET` (ler), `POST` (criar), `PUT`/`PATCH`
(atualizar), `DELETE` (remover).

**Rota (route) / endpoint** — um caminho que o servidor atende, tipo
`GET /api/items`. "Endpoint" = método + caminho.

**Handler** — a função que responde uma rota (`(req, res) => { ... }`).

**Status code** — o número que resume o resultado: `200` ok, `201` criado, `401`
não autenticado, `403` proibido, `404` não encontrado, `422` dados inválidos,
`429` requisições demais, `500` erro do servidor.

**Middleware** — uma função que roda **antes** dos handlers, na ordem em que é
registrada — para logar, autenticar, limitar taxa, etc. Veja
[Endurecimento HTTP](../recipes/hardening.md).

**CORS** — a regra que decide quais sites (origens) podem chamar sua API pelo
navegador.

**JSON** — o formato de texto em que dados trafegam na API (`{"nome":"Ana"}`).

## Camadas do SDK

**Model (modelo)** — a classe que descreve uma tabela do banco. Veja
[Banco de dados](../recipes/database.md).

**Repository** — a camada de **acesso a dados**: cria, lê, atualiza e apaga linhas.

**Service** — a camada de **regra de negócio**; chama repositories e mapeia a
linha crua para a resposta.

**Controller** — a fronteira de **orquestração** entre a rota e os services.

**Router** — agrupa rotas de um domínio e as registra no app.

**Schema / DTO** — o formato validado de entrada ou saída de dados. No SDK são
schemas **Zod**. "DTO" = *Data Transfer Object*, o objeto que entra/sai da API.

**Zod** — a biblioteca de validação. Você descreve o formato uma vez e ganha
validação **e** tipos.

## Banco de dados

**ORM** — *Object-Relational Mapping*: falar com o banco via objetos/classes em
vez de SQL cru. Aqui é o `tempest-db-js`.

**Migration (migração)** — um passo versionado que evolui o schema do banco (criar
tabela, adicionar coluna). Veja a seção de migrações em
[Banco de dados](../recipes/database.md).

**Paginação** — devolver resultados em páginas. **Offset** = "página 3 de 12";
**cursor** = "os próximos 20 depois deste" (melhor pra tabelas grandes).

**Soft delete** — marcar uma linha como inativa (`isActive: false` ou `deletedAt`)
em vez de apagá-la de verdade.

**Multi-tenant** — vários clientes ("tenants") compartilhando as mesmas tabelas,
separados por um `tenantId`. Veja [Banco avançado](../recipes/database-advanced.md).

## Autenticação e segurança

**Autenticação** — provar **quem** você é (login). **Autorização** — decidir o que
você **pode** fazer (roles).

**JWT** — *JSON Web Token*: um token assinado que carrega a identidade do usuário
entre requisições. Veja [Autenticação](../recipes/auth.md).

**Hash** — transformação de mão única de uma senha; guarda-se o hash, nunca a
senha em texto. O SDK usa bcrypt.

**MFA / TOTP** — segundo fator de autenticação; TOTP é o código de 6 dígitos que
muda a cada 30s (Google Authenticator).

**Rate limit** — limitar quantas requisições uma chave (IP/usuário) pode fazer por
janela de tempo.

**CSRF** — ataque que usa o navegador da vítima pra disparar ações autenticadas; a
defesa é o *double-submit cookie*.

**Idempotência** — reenviar a mesma requisição (mesma `Idempotency-Key`) sem
duplicar o efeito (uma segunda cobrança, um segundo pedido).

**Webhook** — quando outro serviço chama **a sua** API pra avisar de um evento; a
assinatura HMAC prova que veio de quem diz. Veja
[OAuth e webhooks](../recipes/oauth-webhooks.md).

**OAuth / OIDC** — login social ("entrar com Google/GitHub").

## Infra e tempo real

**Cache** — guardar resultados caros pra responder rápido depois (Redis).

**Fila (queue) / broker** — mensagens processadas de forma assíncrona; o *broker*
(RabbitMQ) entrega. Veja [Cache, fila e tarefas](../recipes/jobs.md).

**SSE / WebSocket** — canais de tempo real: SSE é servidor→cliente; WebSocket é
nos dois sentidos. Veja [Tempo real](../recipes/realtime.md).

**Feature flag** — uma chave liga/desliga um recurso sem novo deploy.

**Storage / upload** — onde arquivos enviados são guardados (disco local, S3/MinIO).

**Variável de ambiente / settings** — configuração vinda do ambiente
(`process.env`), não do código. Veja [Configuração](../recipes/settings.md).

**OpenAPI / Swagger / Redoc** — OpenAPI é a **especificação** da sua API; Swagger
UI e Redoc são páginas que a exibem (uma interativa, outra pra leitura).

**Health check** — um endpoint (`/health`) que responde se o serviço está de pé.

---

Não achou um termo? Abra uma issue no
[repositório](https://github.com/mauriciobenjamin700/tempest-express-sdk) — a
gente adiciona. 🙌
