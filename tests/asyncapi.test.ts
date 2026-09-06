import {
  ASYNCAPI_VERSION,
  PERSPECTIVE_EXTENSION,
  createApp,
  createAsyncApiRegistry,
  generateAsyncApiDocument,
  runServer,
  z,
} from "@/index";
import { describe, expect, it } from "vitest";

/** Client -> server: join a room. */
const subscribeFrame = z.object({
  action: z.literal("subscribe"),
  room: z.string().min(1).max(128),
});

/** Server -> client: a message arrived. */
const messageFrame = z.object({
  type: z.literal("message"),
  payload: z.object({
    remoteJid: z.string(),
    text: z.string().nullable(),
  }),
});

/** Headers the HTTP upgrade must carry. */
const handshakeHeaders = z.object({ "x-api-key": z.string() });

/**
 * Build a registry mirroring the zap gateway's socket.
 *
 * @returns A populated registry.
 */
function buildRegistry(): ReturnType<typeof createAsyncApiRegistry> {
  return createAsyncApiRegistry()
    .registerChannel({
      name: "socket",
      address: "/ws",
      title: "Realtime connection",
      handshakeHeaders,
    })
    .registerMessage({ name: "SubscribeFrame", schema: subscribeFrame })
    .registerMessage({ name: "MessageFrame", schema: messageFrame })
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
}

/**
 * Read a dotted path out of a generated document.
 *
 * The document is deliberately `Record<string, unknown>` — it is JSON, not a
 * modelled type — so assertions walk it through here instead of casting the
 * whole thing to `any`.
 *
 * @param document - The generated document.
 * @param path - Dot-separated keys, e.g. `"operations.subscribe.action"`.
 * @returns The value at that path, or `undefined`.
 */
function at(document: Record<string, unknown>, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (node, key) => (node as Record<string, unknown> | undefined)?.[key],
      document,
    );
}

/**
 * Generate the document from {@link buildRegistry}.
 *
 * @returns The rendered document.
 */
function buildDocument(): Record<string, unknown> {
  return generateAsyncApiDocument(buildRegistry(), {
    info: { title: "Zap", version: "1.0.0" },
    servers: { local: { host: "127.0.0.1:3000", protocol: "ws", pathname: "/ws" } },
  });
}

describe("AsyncAPI document shape", () => {
  it("declares the version and the required info block", () => {
    const document = buildDocument();
    expect(document.asyncapi).toBe(ASYNCAPI_VERSION);
    expect(at(document, "info.title")).toBe("Zap");
    expect(at(document, "info.version")).toBe("1.0.0");
  });

  it("records whose point of view `action` is written from", () => {
    // A consumer inverts every action to build a client. Leaving it to
    // convention is how the sign gets flipped silently.
    expect(buildDocument()[PERSPECTIVE_EXTENSION]).toBe("server");
  });

  it("keeps operations at the document root, pointing at the channel", () => {
    const document = buildDocument();
    expect(Object.keys(at(document, "operations") as object)).toEqual([
      "subscribe",
      "onMessage",
    ]);
    expect(at(document, "operations.subscribe.channel")).toEqual({
      $ref: "#/channels/socket",
    });
  });
});

describe("Direction translates to the author's point of view", () => {
  it("a client send is a server receive", () => {
    expect(at(buildDocument(), "operations.subscribe.action")).toBe("receive");
  });

  it("a client receive is a server send", () => {
    expect(at(buildDocument(), "operations.onMessage.action")).toBe("send");
  });
});

describe("Payloads come from the registered zod schemas", () => {
  it("renders each message payload as a component schema", () => {
    const document = buildDocument();
    expect(at(document, "components.schemas.SubscribeFrame.required")).toContain("room");
    expect(
      at(document, "components.schemas.SubscribeFrame.properties.room.maxLength"),
    ).toBe(128);
  });

  it("renders the discriminant as a single-value enum", () => {
    // `z.literal()` becomes `{type, enum: [value]}`, not `{const: value}`.
    // A consumer reads the discriminant from here to build a tagged union,
    // so which of the two it is decides whether the union can be built.
    const document = buildDocument();
    expect(at(document, "components.schemas.SubscribeFrame.properties.action")).toEqual({
      type: "string",
      enum: ["subscribe"],
    });
  });

  it("points the message at its payload rather than inlining it", () => {
    const document = buildDocument();
    expect(at(document, "components.messages.MessageFrame.payload")).toEqual({
      $ref: "#/components/schemas/MessageFrame",
    });
  });

  it("keeps a nested object typed instead of collapsing it", () => {
    const document = buildDocument();
    expect(
      at(
        document,
        "components.schemas.MessageFrame.properties.payload.properties.remoteJid.type",
      ),
    ).toBe("string");
  });
});

describe("The WebSocket handshake is documented", () => {
  it("declares the ws channel binding with its method", () => {
    const document = buildDocument();
    expect(at(document, "channels.socket.bindings.ws.bindingVersion")).toBe("0.1.0");
    expect(at(document, "channels.socket.bindings.ws.method")).toBe("GET");
  });

  it("inlines the handshake headers into the binding", () => {
    // Not a `$ref`: the specification types the binding's `headers` as
    // `oneOf: [Schema, Reference]`, and `{"$ref": ...}` satisfies both, so
    // `oneOf` sees two matches and the document fails validation against
    // AsyncAPI's own JSON Schema.
    const document = buildDocument();
    expect(
      at(document, "channels.socket.bindings.ws.headers.properties.x-api-key.type"),
    ).toBe("string");
    expect(at(document, "channels.socket.bindings.ws.headers.$ref")).toBeUndefined();
  });

  it("omits the query binding when the channel declares none", () => {
    expect(at(buildDocument(), "channels.socket.bindings.ws.query")).toBeUndefined();
  });
});

describe("Operation messages stay a subset of the channel's", () => {
  it("refers to messages through the channel, as the spec requires", () => {
    const document = buildDocument();
    expect(at(document, "operations.subscribe.messages")).toEqual([
      { $ref: "#/channels/socket/messages/SubscribeFrame" },
    ]);
  });

  it("lists every message on the channel", () => {
    const document = buildDocument();
    expect(
      Object.keys(at(document, "channels.socket.messages") as object).sort(),
    ).toEqual(["MessageFrame", "SubscribeFrame"]);
  });
});

describe("A dangling reference fails at generation", () => {
  it("rejects an operation naming an unregistered channel", () => {
    const registry = createAsyncApiRegistry()
      .registerMessage({ name: "F", schema: subscribeFrame })
      .registerOperation({
        name: "x",
        channel: "nope",
        direction: "clientToServer",
        messages: ["F"],
      });
    expect(() =>
      generateAsyncApiDocument(registry, { info: { title: "T", version: "1" } }),
    ).toThrow(/channel "nope"/);
  });

  it("rejects an operation naming an unregistered message", () => {
    const registry = createAsyncApiRegistry()
      .registerChannel({ name: "c", address: "/ws" })
      .registerOperation({
        name: "x",
        channel: "c",
        direction: "clientToServer",
        messages: ["Missing"],
      });
    expect(() =>
      generateAsyncApiDocument(registry, { info: { title: "T", version: "1" } }),
    ).toThrow(/message "Missing"/);
  });

  it("rejects a duplicate registration instead of overwriting it", () => {
    const registry = createAsyncApiRegistry().registerChannel({
      name: "c",
      address: "/ws",
    });
    expect(() => registry.registerChannel({ name: "c", address: "/other" })).toThrow(
      /already registered/,
    );
  });
});

describe("Registration order does not matter", () => {
  it("resolves a channel registered after the operation that uses it", () => {
    const registry = createAsyncApiRegistry()
      .registerOperation({
        name: "x",
        channel: "late",
        direction: "clientToServer",
        messages: ["F"],
      })
      .registerMessage({ name: "F", schema: subscribeFrame })
      .registerChannel({ name: "late", address: "/ws" });
    const document = generateAsyncApiDocument(registry, {
      info: { title: "T", version: "1" },
    });
    expect(at(document, "operations.x")).toBeDefined();
  });
});

describe("Serving the document", () => {
  it("answers the configured route with the document", async () => {
    // Mounted through `createApp`, not after it: `createApp` installs the
    // 404 handler last, so a route added to the returned app is shadowed by
    // it and answers 404.
    const app = await createApp({
      asyncapi: {
        registry: buildRegistry(),
        info: { title: "Zap", version: "1.0.0" },
      },
    });
    const server = await runServer(app, { port: 0 });
    try {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      const response = await fetch(`http://127.0.0.1:${port}/asyncapi.json`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.asyncapi).toBe(ASYNCAPI_VERSION);
      expect(body[PERSPECTIVE_EXTENSION]).toBe("server");
    } finally {
      server.close();
    }
  });

  it("serves it at a custom path", async () => {
    const app = await createApp({
      asyncapi: {
        registry: buildRegistry(),
        info: { title: "Zap", version: "1.0.0" },
        jsonPath: "/ws-spec.json",
      },
    });
    const server = await runServer(app, { port: 0 });
    try {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      expect((await fetch(`http://127.0.0.1:${port}/ws-spec.json`)).status).toBe(200);
      expect((await fetch(`http://127.0.0.1:${port}/asyncapi.json`)).status).toBe(404);
    } finally {
      server.close();
    }
  });

  it("mounts nothing when the service serves no socket", async () => {
    const app = await createApp({});
    const server = await runServer(app, { port: 0 });
    try {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      expect((await fetch(`http://127.0.0.1:${port}/asyncapi.json`)).status).toBe(404);
    } finally {
      server.close();
    }
  });
});
