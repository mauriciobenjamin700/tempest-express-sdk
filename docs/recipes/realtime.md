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

## Recapitulando

WebSocket para bidirecional com tópicos e entrega por usuário; SSE para push
unidirecional simples sobre HTTP, sem dependências.
