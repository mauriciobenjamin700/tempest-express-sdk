/**
 * Message broker, mirroring `queue.manager.AsyncBrokerManager`.
 *
 * A narrow async pub/sub surface ({@link BrokerManager}) with two backends: an
 * in-process {@link MemoryBroker} (dev/tests) and a {@link RabbitBroker} over the
 * optional `amqplib` peer (lazily imported). Messages are JSON-serialized.
 */

/** A handler invoked for each delivered message. */
export type MessageHandler = (message: unknown) => Promise<void> | void;

/** Narrow async pub/sub surface every backend implements. */
export interface BrokerManager {
  /** Publish a message to a named queue. */
  publish(queue: string, message: unknown): Promise<void>;
  /** Subscribe to a queue; resolves to an unsubscribe function. */
  subscribe(queue: string, handler: MessageHandler): Promise<() => Promise<void>>;
  /** Close the broker and release resources. */
  close(): Promise<void>;
}

/** In-process {@link BrokerManager} backed by handler sets. */
export class MemoryBroker implements BrokerManager {
  private readonly handlers = new Map<string, Set<MessageHandler>>();

  async publish(queue: string, message: unknown): Promise<void> {
    const set = this.handlers.get(queue);
    if (!set) return;
    // Clone the payload so handlers cannot mutate a shared reference.
    const payload = JSON.parse(JSON.stringify(message)) as unknown;
    for (const handler of [...set]) await handler(payload);
  }

  async subscribe(queue: string, handler: MessageHandler): Promise<() => Promise<void>> {
    const set = this.handlers.get(queue) ?? new Set<MessageHandler>();
    set.add(handler);
    this.handlers.set(queue, set);
    return async () => {
      set.delete(handler);
      if (set.size === 0) this.handlers.delete(queue);
    };
  }

  async close(): Promise<void> {
    this.handlers.clear();
  }
}

/** Options for {@link RabbitBroker}. */
export interface RabbitBrokerOptions {
  /** AMQP connection URL, e.g. `amqp://localhost`. */
  url: string;
  /** Whether queues are declared durable. Default `true`. */
  durable?: boolean;
}

type AmqpModule = typeof import("amqplib");
type AmqpConnection = Awaited<ReturnType<AmqpModule["connect"]>>;
type AmqpChannel = Awaited<ReturnType<AmqpConnection["createChannel"]>>;

/** RabbitMQ-backed {@link BrokerManager} over the optional `amqplib` peer. */
export class RabbitBroker implements BrokerManager {
  private connection: AmqpConnection | null = null;
  private channel: AmqpChannel | null = null;
  private readonly durable: boolean;

  /**
   * @param options - Connection URL and queue durability.
   */
  constructor(private readonly options: RabbitBrokerOptions) {
    this.durable = options.durable ?? true;
  }

  /** Lazily connect and open a channel. */
  private async ready(): Promise<AmqpChannel> {
    if (this.channel) return this.channel;
    let amqp: AmqpModule;
    try {
      amqp = await import("amqplib");
    } catch (cause) {
      throw new Error(
        "RabbitBroker requires the 'amqplib' peer dependency. Install with `npm i amqplib`.",
        { cause },
      );
    }
    this.connection = await amqp.connect(this.options.url);
    this.channel = await this.connection.createChannel();
    return this.channel;
  }

  async publish(queue: string, message: unknown): Promise<void> {
    const channel = await this.ready();
    await channel.assertQueue(queue, { durable: this.durable });
    channel.sendToQueue(queue, Buffer.from(JSON.stringify(message)), {
      persistent: this.durable,
    });
  }

  async subscribe(queue: string, handler: MessageHandler): Promise<() => Promise<void>> {
    const channel = await this.ready();
    await channel.assertQueue(queue, { durable: this.durable });
    const { consumerTag } = await channel.consume(queue, (msg) => {
      if (!msg) return;
      void Promise.resolve(handler(JSON.parse(msg.content.toString()) as unknown))
        .then(() => channel.ack(msg))
        .catch(() => channel.nack(msg, false, false));
    });
    return async () => {
      await channel.cancel(consumerTag);
    };
  }

  async close(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
    this.channel = null;
    this.connection = null;
  }
}
