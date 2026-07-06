# Endurecimento HTTP (middlewares)

Um punhado de middlewares prontos para produção que fecham as brechas mais
comuns de um serviço Express: abuso (rate limit), payloads gigantes, CSRF,
retentativas duplicadas (idempotência), desligamento gracioso, correlação de
logs e métricas por request. É o porte fiel de `api.middlewares` do
`tempest-fastapi-sdk`.

Todos respeitam o mesmo envelope de erro do SDK (`{ detail, code, details }`) e
não têm dependências externas.

!!! tip "Ordem importa"
    Middlewares rodam na ordem em que você os registra. A ordem recomendada:
    request-id → tracing → body-size → rate-limit → CSRF → idempotência → suas
    rotas → handlers de erro (`registerExceptionHandlers`, sempre por último).

---

## 1. Rate limiting (janela deslizante)

Conta requests por **chave** dentro de uma janela e rejeita o excesso com
`429 Too Many Requests` + `Retry-After`. Dois eixos são plugáveis: o **store**
(onde os contadores vivem) e a **chave** (contra quem o request conta).

```ts
import { createApp, rateLimitMiddleware } from "tempest-express-sdk";

const app = await createApp({
  configure: (app) => {
    app.use(rateLimitMiddleware({ maxRequests: 60, windowSeconds: 60 }));
  },
});
```

Por padrão a chave é o IP do cliente e o store é em memória
(`MemoryRateLimitStore`) — certo para **um** worker. Cabeçalhos de resposta
`X-RateLimit-Limit` / `X-RateLimit-Remaining` acompanham cada resposta.

### Chaves: por IP, header, ou principal autenticado

```ts
import {
  JWTUtils,
  keyByHeader,
  keyByJwtSubject,
  rateLimitMiddleware,
} from "tempest-express-sdk";

// por API key (cai para IP se ausente)
app.use(rateLimitMiddleware({ keyFunc: keyByHeader("x-api-key") }));

// por usuário autenticado (claim `sub` do JWT; cai para IP se anônimo)
const jwt = new JWTUtils(process.env.JWT_SECRET ?? "dev-secret");
app.use(rateLimitMiddleware({ keyFunc: keyByJwtSubject(jwt) }));
```

!!! warning "Atrás de um proxy, resolva o IP de um header confiável"
    O IP padrão é o peer de transporte — que vira o **proxy** quando há um
    reverse proxy na frente, colapsando todo mundo num bucket só. Passe
    `trustedIpHeader: "x-real-ip"` (um header que o SEU edge define, nunca o
    `X-Forwarded-For` do cliente, que é forjável).

### Multi-réplica: store no Redis

Um único script Lua poda membros expirados, conta e adiciona o novo hit
atomicamente — sem corrida entre contar e adicionar. Em erro do backend, o
request é liberado quando `failOpen` (o padrão).

```ts
import { RedisRateLimitStore, rateLimitMiddleware } from "tempest-express-sdk";
import { createClient } from "redis";

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

app.use(
  rateLimitMiddleware({
    maxRequests: 100,
    windowSeconds: 60,
    store: new RedisRateLimitStore(redis),
  }),
);
```

---

## 2. Limite de tamanho do corpo

Sem um limite upstream, um cliente pode enviar gigabytes antes dos parsers
recusarem. `bodySizeLimitMiddleware` corta cedo: rejeita `Content-Length` acima
do teto com `413` e monitora o stream para corpos chunked.

```ts
import { bodySizeLimitMiddleware } from "tempest-express-sdk";

// registre ANTES de express.json()
app.use(bodySizeLimitMiddleware({ maxBytes: 1024 * 1024, excludePaths: ["/uploads"] }));
```

!!! note "Registre antes dos parsers"
    Coloque-o antes de `express.json()` para cortar o corpo antes de bufferizá-lo.
    O check de `Content-Length` cobre o caso comum; o monitor de stream conta os
    bytes sem roubá-los do parser (o Node entrega cada chunk a todos os
    listeners) e destrói o request no estouro.

---

## 3. CSRF (double-submit cookie)

Protege métodos mutáveis (POST/PUT/PATCH/DELETE) exigindo um cookie `csrf_token`
e um header `X-CSRF-Token` com o mesmo valor. Um site cross-origin não consegue
ler o cookie, então não forja o header.

```ts
import { csrfMiddleware, generateCsrfToken } from "tempest-express-sdk";

// rotas Bearer (Authorization) NÃO sofrem CSRF — exclua /api/
app.use(csrfMiddleware({ excludePaths: ["/api/", "/webhooks/"] }));

// emita o cookie numa rota GET (ex.: ao servir o shell HTML)
app.get("/csrf", (_req, res) => {
  const token = generateCsrfToken();
  res.cookie?.("csrf_token", token, { sameSite: "lax" });
  res.json({ csrfToken: token });
});
```

Métodos seguros (GET/HEAD/OPTIONS) sempre passam. A comparação é
`timingSafeEqual` (resistente a timing).

---

## 4. Idempotência

Um cliente que reenvia um POST com o mesmo `Idempotency-Key` recebe a **resposta
original** de volta, sem efeito colateral duplicado (uma segunda cobrança, um
segundo pedido). Só verbos mutáveis são elegíveis; a chave é escopada por
`(método, path, key)`.

```ts
import {
  MemoryIdempotencyStore,
  idempotencyMiddleware,
} from "tempest-express-sdk";

app.use(
  idempotencyMiddleware({
    store: new MemoryIdempotencyStore(), // ou RedisIdempotencyStore(client)
    ttlSeconds: 24 * 3600,
  }),
);
```

A resposta replayada carrega `Idempotent-Replayed: true`. Só respostas `2xx` são
cacheadas — erros continuam retentáveis. Em produção multi-réplica, use
`RedisIdempotencyStore(client)`.

---

## 5. Desligamento gracioso

Rastreia requests em voo e, ao iniciar o drain, responde `503` a novos requests
não-isentos enquanto espera os em andamento terminarem — para que um deploy
rolando nunca corte uma resposta no meio.

```ts
import { GracefulShutdown, createApp, runServer } from "tempest-express-sdk";

const shutdown = new GracefulShutdown({ drainTimeoutSeconds: 30, retryAfterSeconds: 5 });

const app = await createApp({
  configure: (app) => app.use(shutdown.middleware()),
});
const server = await runServer(app, { port: 8000 });

process.on("SIGTERM", async () => {
  shutdown.beginDrain();          // novos requests → 503
  await shutdown.waitDrained();   // espera os em voo (até o timeout)
  server.close();
});
```

---

## 6. Correlação de logs (request-id + tracing)

`createApp` já instala o `requestIdMiddleware`: lê/gera um `X-Request-ID` (com
validação contra CRLF injection), ecoa na resposta e o expõe via
`getRequestId()`. Some `requestTracingMiddleware` para uma linha de log
estruturada por request (método, path, status, duração, request-id):

```ts
import { requestTracingMiddleware } from "tempest-express-sdk";

app.use(requestTracingMiddleware({ exemptPaths: ["/health"] }));
```

---

## 7. Métricas por request (Prometheus)

Complementa o `/metrics` de sistema (`makeMetricsRouter`) com instrumentação
**por request**: um contador rotulado por método/status e um histograma de
latência.

```ts
import { prometheusMiddleware } from "tempest-express-sdk";

const { metrics, middleware } = prometheusMiddleware({ exemptPaths: ["/metrics"] });
app.use(middleware);
app.get("/metrics", (_req, res) => res.type("text/plain").send(metrics.render()));
```

`metrics.render()` devolve texto Prometheus: `http_requests_total{method,status}`
e `http_request_duration_seconds_{bucket,sum,count}`. Use `req.route?.path` como
rótulo mantém a cardinalidade baixa (padrão de rota, não path com ids).

---

## Recapitulando

| Middleware | Protege contra | 429/413/403/503 |
| --- | --- | --- |
| `rateLimitMiddleware` | abuso / força-bruta | `429` |
| `bodySizeLimitMiddleware` | payloads gigantes | `413` |
| `csrfMiddleware` | CSRF em auth por cookie | `403` |
| `idempotencyMiddleware` | efeitos duplicados em retry | — (replay) |
| `GracefulShutdown` | requests cortados no deploy | `503` |
| `requestTracingMiddleware` | logs sem correlação | — |
| `prometheusMiddleware` | falta de métricas por rota | — |

Memory por padrão, Redis para multi-réplica no rate-limit e na idempotência. 🚀
