# AsyncAPI: documenting the WebSocket

OpenAPI describes one request and its response. A WebSocket has no such shape:
the connection stays open, messages travel both ways, and the server speaks
without anyone asking. There is nowhere to put that in an OpenAPI document — so
a socket route usually becomes **a paragraph of prose**, and prose generates no
client at all.

`createAsyncApiRegistry` solves it the way the OpenAPI registry solves the HTTP
side: you register what the connection carries, and the SDK emits an
**AsyncAPI 3.0** document served next to `/openapi.json`.

## The complete example

```typescript
import {
  createApp,
  createAsyncApiRegistry,
  runServer,
  z,
} from "tempest-express-sdk";

const subscribeFrame = z.object({
  action: z.literal("subscribe"),
  room: z.string().min(1).max(128),
});

const messageFrame = z.object({
  type: z.literal("message"),
  payload: z.object({
    remoteJid: z.string(),
    text: z.string().nullable(),
  }),
});

const handshakeHeaders = z.object({
  "x-api-key": z.string().describe("Consumer key, required on the upgrade"),
});

const asyncapi = createAsyncApiRegistry()
  .registerChannel({
    name: "socket",
    address: "/ws",
    title: "Realtime connection",
    handshakeHeaders,
  })
  .registerMessage({
    name: "SubscribeFrame",
    schema: subscribeFrame,
    summary: "Join a room",
  })
  .registerMessage({
    name: "MessageFrame",
    schema: messageFrame,
    summary: "A message arrived",
  })
  .registerOperation({
    name: "subscribe",
    channel: "socket",
    direction: "clientToServer",
    messages: ["SubscribeFrame"],
  })
  .registerOperation({
    name: "onMessage",
    channel: "socket",
    direction: "serverToClient",
    messages: ["MessageFrame"],
  });

const app = await createApp({
  asyncapi: { registry: asyncapi, info: { title: "Gateway", version: "1.0.0" } },
});

await runServer(app, { port: 3000 });
```

Hitting `http://127.0.0.1:3000/asyncapi.json`:

```json
{
  "asyncapi": "3.0.0",
  "x-tempest-perspective": "server",
  "info": { "title": "Gateway", "version": "1.0.0" },
  "defaultContentType": "application/json",
  "channels": {
    "socket": {
      "address": "/ws",
      "title": "Realtime connection",
      "messages": {
        "SubscribeFrame": { "$ref": "#/components/messages/SubscribeFrame" },
        "MessageFrame": { "$ref": "#/components/messages/MessageFrame" }
      },
      "bindings": {
        "ws": {
          "bindingVersion": "0.1.0",
          "method": "GET",
          "headers": {
            "type": "object",
            "properties": { "x-api-key": { "type": "string" } },
            "required": ["x-api-key"]
          }
        }
      }
    }
  },
  "operations": {
    "subscribe": {
      "action": "receive",
      "channel": { "$ref": "#/channels/socket" },
      "messages": [{ "$ref": "#/channels/socket/messages/SubscribeFrame" }]
    },
    "onMessage": {
      "action": "send",
      "channel": { "$ref": "#/channels/socket" },
      "messages": [{ "$ref": "#/channels/socket/messages/MessageFrame" }]
    }
  }
}
```

## Piece by piece

### The channel is the connection

WebSocket has **no virtual channels**. The specification says so: *"the channel
represents the connection [...] there's only one channel"*. Unlike Kafka or
MQTT, where a channel is a topic, here you register **one** channel — the path
the socket is served at — and rooms are a detail of your own protocol, not of
the document.

`handshakeHeaders` becomes the channel's `ws` binding, which is where the
specification keeps what the HTTP upgrade requires. That is where the API key
gets documented.

!!! note "The handshake schema is inlined, not referenced"
    The specification types `bindings.ws.headers` as
    `oneOf: [Schema, Reference]`, and a bare `{"$ref": ...}` satisfies
    **both** branches — so `oneOf` sees two matches and the document fails
    AsyncAPI's own JSON Schema. Measured both ways against the official
    meta-schema.

### `direction` is from the client's point of view

This is the part that most often goes wrong, and it is why the registry does
**not** accept `action`.

AsyncAPI's `action` is relative to **whoever published the document**. Since the
publisher is the server, a frame the client sends appears in the document as
`action: "receive"` — the server is the one receiving.

| You write | The document says | Meaning |
| --- | --- | --- |
| `direction: "clientToServer"` | `action: "receive"` | the server receives |
| `direction: "serverToClient"` | `action: "send"` | the server sends |

!!! danger "Reading `action` as your own produces a backwards client"
    A client generator has to **invert** every `action` in the document.
    Getting the sign wrong breaks nothing visible: the client compiles, passes
    the type-check, and does exactly the opposite of what it should.

    That is why `direction` carries those two names: `clientToServer` cannot be
    read backwards. And it is why the document carries
    `x-tempest-perspective: "server"` — a consumer checks it and **refuses** a
    document without it, rather than assuming.

### Payloads are the same schemas that validate

Each message's `payload` comes from your Zod object, through the same path that
feeds OpenAPI. It is not a copy of the schema: it is the schema. The document
cannot describe a shape the server would reject, because they are one object.

!!! tip "Use a discriminated union, not a loose envelope"
    A generic envelope (`{ type: string, data: unknown }`) passes the
    type-check and documents **nothing** — `unknown` generates no type, and the
    generated client gets an opaque field.

    Register one frame per variant, each with its literal discriminant
    (`z.literal("subscribe")`). The consumer builds a tagged union and the
    `switch` is exhaustive.

!!! note "`z.literal()` becomes a single-value enum"
    In the generated JSON Schema, `z.literal("subscribe")` comes out as
    `{ "type": "string", "enum": ["subscribe"] }`, **not** as
    `{ "const": "subscribe" }`. Whoever reads the document to build the union
    looks for the discriminant in that shape.

## A dangling reference fails immediately

An operation pointing at a channel or message nobody registered throws at
generation, naming what it could not resolve:

```typescript
createAsyncApiRegistry()
  .registerChannel({ name: "socket", address: "/ws" })
  .registerOperation({
    name: "subscribe",
    channel: "socket",
    direction: "clientToServer",
    messages: ["NotRegistered"],
  })
  .generate({ info: { title: "T", version: "1" } });
// Error: AsyncAPI operation "subscribe" refers to message "NotRegistered",
// which is not registered.
```

Without that check the document would come out structurally valid, with a
`$ref` pointing at nothing — and a client generated from it would simply not
have that frame.

Registration order, on the other hand, does not matter: references resolve at
generation, so an operation may be registered before its channel.

## Mounting outside `createApp`

`mountAsyncApiJson` is there for callers who assemble the app by hand:

```typescript
import { generateAsyncApiDocument, mountAsyncApiJson } from "tempest-express-sdk";

const document = generateAsyncApiDocument(asyncapi, {
  info: { title: "Gateway", version: "1.0.0" },
});
mountAsyncApiJson(app, "/asyncapi.json", document);
```

!!! warning "Mounting **after** `createApp` answers 404"
    `createApp` installs the 404 handler last. A route added to the app it
    returned sits behind that handler and is never reached.

    Use `createApp`'s `asyncapi` option, or mount inside `configure`.

## Recap

- OpenAPI does not describe sockets; AsyncAPI does, and both documents coexist.
- **One** channel per connection — WebSocket has no virtual channels.
- `direction` is from the client's point of view; the document's `action` is the
  server's, and the consumer inverts it.
- `x-tempest-perspective` states whose point of view it is, so nobody assumes.
- Payloads come from the Zod that already validates, so document and runtime
  cannot drift.
- One discriminated frame per variant, never an envelope with `data: unknown`.
- A dangling reference fails at generation, not in the consumer.
