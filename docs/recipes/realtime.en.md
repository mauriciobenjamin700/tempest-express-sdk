# Real-time (WebSocket + SSE)

Two ways to push data to clients in real time: **WebSocket** (bidirectional) and
**SSE** (one-way, over HTTP).

## WebSocket

`WebSocketHub` is transport-agnostic; `attachWebSocketHub` wires it to the HTTP
server using the optional `ws` peer.

!!! info "Optional peer"
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
  // Authenticate at the handshake (e.g. ?token=…). Return null to reject (1008).
  authenticate: (info) => (info.url.includes("token=") ? "user-1" : null),
  onMessage: (conn, raw) => {
    if (raw === "subscribe:news") hub.subscribe(conn.id, "news");
  },
});

// Anywhere in the app:
hub.sendTo("user-1", { type: "notification", data: { unread: 3 } });
hub.broadcast({ type: "news", data: { id: 1 } }, "news"); // only topic subscribers
```

`hub` offers `sendTo(userId, envelope)`, `broadcast(envelope, topic?)`,
`subscribe`/`unsubscribe`, `onlineUsers()`, `connectionCount()`.

## SSE

No extra dependencies. `SSEBroker` fans events out per channel; `sseResponse`
streams them into an Express response.

```ts
import { SSEBroker, sseResponse } from "tempest-express-sdk";

const broker = new SSEBroker();

app.get("/api/feed", (req, res) => {
  const stream = broker.register("feed");
  req.on("close", () => broker.unregister("feed", stream));
  void sseResponse(req, res, stream);
});

// Publish to every subscriber of the channel:
broker.publish("feed", { price: 42 }, "tick");
```

!!! tip "Heartbeat"
    `EventStream` sends a periodic `: ping` comment (15s by default) to keep the
    connection alive. Configure with `new SSEBroker({ heartbeatSeconds })`.

## Multi-replica with Redis

The in-memory `SSEBroker` only reaches clients on the **same process**. For
multiple replicas, use `RedisSSEBroker` (pub/sub) — a `publish` on any node
reaches SSE clients on all of them. Pass the main client + a dedicated
subscriber connection (`client.duplicate()`), per Redis pub/sub rules.

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

await broker.publish("feed", { price: 42 }, "tick"); // reaches every replica
```

Sessions also have a Redis store for multi-replica — `RedisSessionStore` (same
`SessionService`, just swap the store):

```ts
import { RedisSessionStore, SessionService } from "tempest-express-sdk";

const sessions = new SessionService({ store: new RedisSessionStore(pub) });
```

## Recap

WebSocket for bidirectional with topics and per-user delivery; SSE for one-way
push over HTTP; `RedisSSEBroker` + `RedisSessionStore` to scale across replicas —
all injecting the `redis` client (optional peer).
