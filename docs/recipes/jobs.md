# Cache, fila e tarefas

## Cache

`MemoryCacheManager` (in-process) ou `RedisCacheManager` (cliente node-redis
injetado). O helper `cached` faz memoization read-through.

```ts
import { MemoryCacheManager, cached } from "tempest-express-sdk";

const cache = new MemoryCacheManager();

const getUser = cached(fetchUserFromDb, {
  manager: cache,
  key: (id: string) => `user:${id}`,
  ttlSeconds: 60,
});

await getUser("123"); // miss → executa fetchUserFromDb e armazena
await getUser("123"); // hit → vem do cache
```

Para Redis, passe um cliente conectado:

```ts
import { RedisCacheManager } from "tempest-express-sdk";
import { createClient } from "redis";

const client = createClient({ url: "redis://localhost" });
await client.connect();
const cache = new RedisCacheManager(client, "myapp:");
```

## Fila (broker)

`MemoryBroker` para dev/testes; `RabbitBroker` para produção (peer `amqplib`).

!!! info "Peer opcional"
    ```bash
    npm install amqplib
    ```

```ts
import { RabbitBroker } from "tempest-express-sdk";

const broker = new RabbitBroker({ url: "amqp://localhost" });
const unsub = await broker.subscribe("emails", async (msg) => {
  console.log("enviar email", msg);
});
await broker.publish("emails", { to: "ana@example.com" });
```

## Tarefas em background

`TaskManager` registra handlers por nome e processa o que for enfileirado.
Roda sobre qualquer `BrokerManager` (default `MemoryBroker`).

```ts
import { RabbitBroker, TaskManager } from "tempest-express-sdk";

const tasks = new TaskManager({ broker: new RabbitBroker({ url: "amqp://localhost" }) });

tasks.register<{ userId: string }>("welcome-email", async (p) => {
  await sendWelcome(p.userId);
});

await tasks.start();              // inicia o worker (consome a fila)
await tasks.enqueue("welcome-email", { userId: "123" });
```

!!! tip "Mesmo processo ou worker dedicado"
    Use `MemoryBroker` para rodar tudo no mesmo processo (dev); aponte
    `RabbitBroker` e suba `tasks.start()` num processo worker separado em produção.

## Recapitulando

Cache read-through (memory/redis), broker de mensagens (memory/rabbit) e fila de
tarefas que reaproveita o broker — tudo com a mesma interface trocável.
