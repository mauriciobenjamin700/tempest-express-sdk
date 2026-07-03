# Tempo real (WebSocket + SSE)

Dois caminhos para enviar dados ao cliente em tempo real: **WebSocket**
(bidirecional) e **SSE** (unidirecional, sobre HTTP).

## WebSocket

O `WebSocketHub` é agnóstico de transporte; `attachWebSocketHub` o liga ao
servidor HTTP usando a peer opcional `ws`.

!!! info "Peer opcional"
    ```bash
    npm install ws
    ```

```ts
import { WebSocketHub, attachWebSocketHub, createApp, runServer } from "tempest-express-sdk";

const hub = new WebSocketHub({ maxPerUser: 5 });
const app = await createApp();
const server = await runServer(app, { port: 8000 });

await attachWebSocketHub(server, hub, {
  path: "/ws",
  // Autentica no handshake (ex.: ?token=…). Retorne null para rejeitar (1008).
  authenticate: (info) => (info.url.includes("token=") ? "user-1" : null),
  onMessage: (conn, raw) => {
    if (raw === "subscribe:news") hub.subscribe(conn.id, "news");
  },
});

// Em qualquer lugar do app:
hub.sendTo("user-1", { type: "notification", data: { unread: 3 } });
hub.broadcast({ type: "news", data: { id: 1 } }, "news"); // só assinantes do tópico
```

`hub` oferece `sendTo(userId, envelope)`, `broadcast(envelope, topic?)`,
`subscribe`/`unsubscribe`, `onlineUsers()`, `connectionCount()`.

## SSE

Sem dependências extras. O `SSEBroker` distribui eventos por canal; `sseResponse`
faz o streaming na resposta Express.

```ts
import { SSEBroker, sseResponse } from "tempest-express-sdk";

const broker = new SSEBroker();

app.get("/api/feed", (req, res) => {
  const stream = broker.register("feed");
  req.on("close", () => broker.unregister("feed", stream));
  void sseResponse(req, res, stream);
});

// Publica para todos os assinantes do canal:
broker.publish("feed", { price: 42 }, "tick");
```

!!! tip "Heartbeat"
    `EventStream` envia um comentário `: ping` periódico (15s por padrão) pra
    manter a conexão viva. Configure com `new SSEBroker({ heartbeatSeconds })`.

## Multi-réplica com Redis

O `SSEBroker` em memória só alcança clientes do **mesmo processo**. Para várias
réplicas, use `RedisSSEBroker` (pub/sub) — um `publish` em qualquer nó chega aos
clientes SSE de todos. Passe o client principal + uma conexão dedicada de
subscriber (`client.duplicate()`), regra do pub/sub do Redis.

```ts
import { RedisSSEBroker } from "tempest-express-sdk";
import { createClient } from "redis";

const pub = createClient({ url: "redis://localhost" });
const sub = pub.duplicate();
await pub.connect();
await sub.connect();

const broker = new RedisSSEBroker(pub, sub);

app.get("/api/feed", async (req, res) => {
  const stream = await broker.register("feed");
  req.on("close", () => void broker.unregister("feed", stream));
  void sseResponse(req, res, stream);
});

await broker.publish("feed", { price: 42 }, "tick"); // alcança todas as réplicas
```

Sessões também têm store Redis para multi-réplica — `RedisSessionStore` (mesmo
`SessionService`, só troca o store):

```ts
import { RedisSessionStore, SessionService } from "tempest-express-sdk";

const sessions = new SessionService({ store: new RedisSessionStore(pub) });
```

## Recapitulando

WebSocket para bidirecional com tópicos e entrega por usuário; SSE para push
unidirecional sobre HTTP; `RedisSSEBroker` + `RedisSessionStore` para escalar em
várias réplicas — todos injetando o client `redis` (peer opcional).
