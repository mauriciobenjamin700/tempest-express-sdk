# Cache, queue and tasks

## Cache

`MemoryCacheManager` (in-process) or `RedisCacheManager` (injected node-redis
client). The `cached` helper does read-through memoization.

```ts
import { MemoryCacheManager, cached } from "tempest-express-sdk";

const cache = new MemoryCacheManager();

const getUser = cached(fetchUserFromDb, {
  manager: cache,
  key: (id: string) => `user:${id}`,
  ttlSeconds: 60,
});

await getUser("123"); // miss → runs fetchUserFromDb and stores
await getUser("123"); // hit → served from cache
```

For Redis, pass a connected client:

```ts
import { RedisCacheManager } from "tempest-express-sdk";
import { createClient } from "redis";

const client = createClient({ url: "redis://localhost" });
await client.connect();
const cache = new RedisCacheManager(client, "myapp:");
```

## Queue (broker)

`MemoryBroker` for dev/tests; `RabbitBroker` for production (the `amqplib` peer).

!!! info "Optional peer"
    ```bash
    npm install amqplib
    ```

```ts
import { RabbitBroker } from "tempest-express-sdk";

const broker = new RabbitBroker({ url: "amqp://localhost" });
const unsub = await broker.subscribe("emails", async (msg) => {
  console.log("send email", msg);
});
await broker.publish("emails", { to: "ana@example.com" });
```

## Background tasks

`TaskManager` registers handlers by name and processes whatever is enqueued.
It rides on any `BrokerManager` (defaults to `MemoryBroker`).

```ts
import { RabbitBroker, TaskManager } from "tempest-express-sdk";

const tasks = new TaskManager({ broker: new RabbitBroker({ url: "amqp://localhost" }) });

tasks.register<{ userId: string }>("welcome-email", async (p) => {
  await sendWelcome(p.userId);
});

await tasks.start();              // start the worker (consumes the queue)
await tasks.enqueue("welcome-email", { userId: "123" });
```

!!! tip "Same process or dedicated worker"
    Use `MemoryBroker` to run everything in one process (dev); point a
    `RabbitBroker` and run `tasks.start()` in a separate worker process in production.

## Recap

Read-through cache (memory/redis), message broker (memory/rabbit) and a task
queue that reuses the broker — all behind the same swappable interface.
