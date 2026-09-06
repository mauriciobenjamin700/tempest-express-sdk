/**
 * AsyncAPI 3.0 document generation from Zod schemas.
 *
 * The sibling of `@/api/openapi` for everything OpenAPI cannot describe: a
 * WebSocket connection, where messages travel in both directions and the
 * server speaks first as often as the client does. OpenAPI models one
 * request and its response, so a socket route documented there degrades to
 * prose — which is what happened, and prose generates no client.
 *
 * ## Direction is stated, never inferred
 *
 * AsyncAPI's `action` is relative to **the application that publishes the
 * document**: `receive` means *this* application receives, so a
 * server-authored document spells a client's send as `receive`. A generated
 * consumer has to invert every one of them, and getting the sign wrong
 * produces a client that compiles, type-checks and does the opposite.
 *
 * This registry therefore never takes `action`. It takes
 * {@link OperationDirection} — `clientToServer` or `serverToClient` — which
 * cannot be read backwards, and translates. The document also carries
 * {@link PERSPECTIVE_EXTENSION} so a reader never has to assume whose point
 * of view it encodes.
 *
 * ## Payloads come from the same schemas that validate
 *
 * Message payloads are generated from the caller's Zod schemas through
 * `zod-to-openapi`'s `generateComponents`, so the documented shape and the
 * shape the server actually accepts cannot drift: they are one object.
 */

import { createOpenApiRegistry } from "@/api/openapi";
import type { z } from "@/schemas/base";
import { OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";

/**
 * Extension key recording whose point of view `action` is written from.
 *
 * Always `"server"` for a document this registry produces: the service that
 * serves the socket is the one describing it. A consumer that reads the
 * document inverts every action, and should refuse a document where this is
 * absent rather than guess.
 */
export const PERSPECTIVE_EXTENSION: string = "x-tempest-perspective";

/** The AsyncAPI version every document this module emits declares. */
export const ASYNCAPI_VERSION: string = "3.0.0";

/**
 * Which way a message travels, from the point of view of the client.
 *
 * Deliberately not AsyncAPI's `send`/`receive`: those are relative to the
 * document's author, and the whole class of bug this names away is a
 * consumer reading them as its own.
 */
export type OperationDirection = "clientToServer" | "serverToClient";

/** A message the socket carries, in one direction. */
export interface AsyncApiMessage {
  /** Component name, and the key the operation refers to it by. */
  name: string;
  /** Zod schema for the frame. Becomes the message `payload`. */
  schema: z.ZodType;
  /** One-line summary shown by document viewers. */
  summary?: string;
  /** Longer prose. Markdown is supported by the renderers. */
  description?: string;
  /** Media type of the payload. Default `application/json`. */
  contentType?: string;
}

/** A channel — for WebSocket, the connection itself. */
export interface AsyncApiChannel {
  /** Key the channel is registered under, and referred to by. */
  name: string;
  /** Path the socket is served at, e.g. `/ws`. */
  address: string;
  /** One-line summary. */
  title?: string;
  /** Longer prose. */
  description?: string;
  /** Headers required on the HTTP upgrade, e.g. an API key. */
  handshakeHeaders?: z.ZodType;
  /** Query parameters accepted on the upgrade. */
  handshakeQuery?: z.ZodType;
}

/** An operation — a set of messages travelling one way on one channel. */
export interface AsyncApiOperation {
  /** Key the operation is registered under. */
  name: string;
  /** `name` of a channel registered on this registry. */
  channel: string;
  /** Which way the messages travel, from the client's point of view. */
  direction: OperationDirection;
  /** `name` of each message, all registered on this registry. */
  messages: string[];
  /** One-line summary. */
  summary?: string;
  /** Longer prose. */
  description?: string;
}

/** The document `info` block. */
export interface AsyncApiInfo {
  /** API title shown in the document header. */
  title: string;
  /** API version string. */
  version: string;
  /** Optional long description. */
  description?: string;
}

/** Options for {@link generateAsyncApiDocument}. */
export interface GenerateAsyncApiOptions {
  /** The document `info` block. */
  info: AsyncApiInfo;
  /** Server entries. `protocol` is the transport, e.g. `"ws"`. */
  servers?: Record<string, { host: string; protocol: string; pathname?: string }>;
  /** Media type assumed where a message does not state one. */
  defaultContentType?: string;
}

/**
 * Translate a client-relative direction into AsyncAPI's author-relative one.
 *
 * @param direction - The direction as the caller stated it.
 * @returns `"receive"` for a client send, `"send"` for a client receive.
 *
 * The inversion is the whole point: the document is authored by the server,
 * so a frame the client sends is one the server receives.
 */
function actionFor(direction: OperationDirection): "send" | "receive" {
  return direction === "clientToServer" ? "receive" : "send";
}

/**
 * Collects channels, messages and operations, then renders the document.
 *
 * Registration order does not matter — references are resolved when
 * {@link AsyncApiRegistry.generate} runs, so a channel may be registered
 * after the operation that points at it.
 */
export class AsyncApiRegistry {
  /** Channels by `name`. */
  private readonly channels: Map<string, AsyncApiChannel> = new Map();

  /** Messages by `name`. */
  private readonly messages: Map<string, AsyncApiMessage> = new Map();

  /** Operations, in registration order. */
  private readonly operations: AsyncApiOperation[] = [];

  /**
   * Register the connection a socket is served on.
   *
   * @param channel - The channel definition.
   * @returns This registry, for chaining.
   * @throws Error When `name` is already registered.
   */
  registerChannel(channel: AsyncApiChannel): this {
    if (this.channels.has(channel.name)) {
      throw new Error(`AsyncAPI channel "${channel.name}" is already registered.`);
    }
    this.channels.set(channel.name, channel);
    return this;
  }

  /**
   * Register one frame the socket carries.
   *
   * @param message - The message definition.
   * @returns This registry, for chaining.
   * @throws Error When `name` is already registered.
   */
  registerMessage(message: AsyncApiMessage): this {
    if (this.messages.has(message.name)) {
      throw new Error(`AsyncAPI message "${message.name}" is already registered.`);
    }
    this.messages.set(message.name, message);
    return this;
  }

  /**
   * Register a set of messages travelling one way on one channel.
   *
   * @param operation - The operation definition.
   * @returns This registry, for chaining.
   * @throws Error When `name` is already registered.
   */
  registerOperation(operation: AsyncApiOperation): this {
    if (this.operations.some((existing) => existing.name === operation.name)) {
      throw new Error(`AsyncAPI operation "${operation.name}" is already registered.`);
    }
    this.operations.push(operation);
    return this;
  }

  /**
   * Render the AsyncAPI document.
   *
   * @param options - The `info` block, optional servers and default content
   *   type.
   * @returns The document, JSON-serializable.
   * @throws Error When an operation names a channel or a message that was
   *   never registered. A dangling `$ref` produces a document that validates
   *   structurally and generates a client missing the frame, so it fails
   *   here instead.
   */
  generate(options: GenerateAsyncApiOptions): Record<string, unknown> {
    this.assertReferencesResolve();

    const schemas = this.renderPayloads();
    const messages = this.renderMessages();
    const channels = this.renderChannels(schemas);
    const operations = this.renderOperations();

    return {
      asyncapi: ASYNCAPI_VERSION,
      [PERSPECTIVE_EXTENSION]: "server",
      info: {
        title: options.info.title,
        version: options.info.version,
        ...(options.info.description !== undefined
          ? { description: options.info.description }
          : {}),
      },
      ...(options.servers !== undefined ? { servers: options.servers } : {}),
      defaultContentType: options.defaultContentType ?? "application/json",
      channels,
      operations,
      components: { messages, schemas },
    };
  }

  /**
   * Fail when an operation points at something that was never registered.
   *
   * @throws Error Naming the operation and what it could not resolve.
   */
  private assertReferencesResolve(): void {
    for (const operation of this.operations) {
      if (!this.channels.has(operation.channel)) {
        throw new Error(
          `AsyncAPI operation "${operation.name}" refers to channel "${operation.channel}", which is not registered.`,
        );
      }
      for (const message of operation.messages) {
        if (!this.messages.has(message)) {
          throw new Error(
            `AsyncAPI operation "${operation.name}" refers to message "${message}", which is not registered.`,
          );
        }
      }
    }
  }

  /**
   * Render every payload schema through the OpenAPI generator.
   *
   * @returns Component schemas keyed by message name, plus any handshake
   *   schema a channel declared.
   *
   * AsyncAPI 3 payloads are JSON Schema, and `generateComponents` emits
   * exactly that from the Zod objects already validating at runtime. Reusing
   * it is what keeps the document from describing a shape the server would
   * reject.
   */
  private renderPayloads(): Record<string, unknown> {
    const registry = createOpenApiRegistry();
    for (const message of this.messages.values()) {
      registry.register(message.name, message.schema);
    }
    for (const channel of this.channels.values()) {
      if (channel.handshakeHeaders !== undefined) {
        registry.register(`${channel.name}Headers`, channel.handshakeHeaders);
      }
      if (channel.handshakeQuery !== undefined) {
        registry.register(`${channel.name}Query`, channel.handshakeQuery);
      }
    }
    const components = new OpenApiGeneratorV31(registry.definitions).generateComponents();
    const schemas = (components.components?.schemas ?? {}) as Record<string, unknown>;
    return schemas;
  }

  /**
   * Render `components.messages`.
   *
   * @returns Message objects keyed by name, each pointing at its payload.
   */
  private renderMessages(): Record<string, unknown> {
    const rendered: Record<string, unknown> = {};
    for (const [name, message] of this.messages) {
      rendered[name] = {
        name,
        contentType: message.contentType ?? "application/json",
        ...(message.summary !== undefined ? { summary: message.summary } : {}),
        ...(message.description !== undefined
          ? { description: message.description }
          : {}),
        payload: { $ref: `#/components/schemas/${name}` },
      };
    }
    return rendered;
  }

  /**
   * Render `channels`, each listing every message it can carry.
   *
   * @param schemas - The rendered component schemas, to inline the
   *   handshake ones into the binding.
   * @returns Channel objects keyed by name.
   *
   * The handshake schemas are **inlined** rather than `$ref`-ed. The
   * specification types the binding's `headers` and `query` as
   * `oneOf: [Schema, Reference]`, and a bare `{"$ref": ...}` object
   * satisfies both branches — so `oneOf` sees two matches and the document
   * fails validation against AsyncAPI's own JSON Schema. Measured: the same
   * binding with the schema inlined validates clean.
   *
   * A channel lists every registered message rather than only those its own
   * operations use: the specification requires an operation's `messages` to
   * be a subset of its channel's, and with one connection per document the
   * distinction buys nothing.
   */
  private renderChannels(schemas: Record<string, unknown>): Record<string, unknown> {
    const everyMessage: Record<string, unknown> = {};
    for (const name of this.messages.keys()) {
      everyMessage[name] = { $ref: `#/components/messages/${name}` };
    }

    const rendered: Record<string, unknown> = {};
    for (const [name, channel] of this.channels) {
      const bindings: Record<string, unknown> = {
        bindingVersion: "0.1.0",
        method: "GET",
      };
      if (channel.handshakeHeaders !== undefined) {
        bindings.headers = schemas[`${name}Headers`];
      }
      if (channel.handshakeQuery !== undefined) {
        bindings.query = schemas[`${name}Query`];
      }
      rendered[name] = {
        address: channel.address,
        ...(channel.title !== undefined ? { title: channel.title } : {}),
        ...(channel.description !== undefined
          ? { description: channel.description }
          : {}),
        messages: everyMessage,
        bindings: { ws: bindings },
      };
    }
    return rendered;
  }

  /**
   * Render `operations`, translating each direction into an `action`.
   *
   * @returns Operation objects keyed by name.
   */
  private renderOperations(): Record<string, unknown> {
    const rendered: Record<string, unknown> = {};
    for (const operation of this.operations) {
      rendered[operation.name] = {
        action: actionFor(operation.direction),
        channel: { $ref: `#/channels/${operation.channel}` },
        ...(operation.summary !== undefined ? { summary: operation.summary } : {}),
        ...(operation.description !== undefined
          ? { description: operation.description }
          : {}),
        messages: operation.messages.map((message) => ({
          $ref: `#/channels/${operation.channel}/messages/${message}`,
        })),
      };
    }
    return rendered;
  }
}

/**
 * Create a fresh, empty AsyncAPI registry.
 *
 * @returns A registry to register channels, messages and operations on.
 */
export function createAsyncApiRegistry(): AsyncApiRegistry {
  return new AsyncApiRegistry();
}

/**
 * Generate an AsyncAPI document from a populated registry.
 *
 * @param registry - The registry holding channels, messages and operations.
 * @param options - The `info` block, optional servers and default content
 *   type.
 * @returns The generated document (plain object, JSON-serializable).
 * @throws Error When an operation refers to something unregistered.
 */
export function generateAsyncApiDocument(
  registry: AsyncApiRegistry,
  options: GenerateAsyncApiOptions,
): Record<string, unknown> {
  return registry.generate(options);
}
