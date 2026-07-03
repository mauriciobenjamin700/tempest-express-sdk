/**
 * Redis pub/sub SSE broker for multi-replica deployments.
 *
 * The in-process {@link SSEBroker} only reaches subscribers on the same node.
 * {@link RedisSSEBroker} publishes to a Redis channel; every replica's
 * subscriber connection receives it and fans out to its local {@link EventStream}s
 * — so a publish on any node reaches SSE clients on all nodes. Takes injected
 * node-redis v4 clients (a dedicated subscriber connection, per Redis pub/sub
 * rules) so the SDK never hard-depends on `redis`.
 */

import { EventStream, type EventStreamOptions } from "@/sse/eventStream";

/** Publisher side (the main client). */
export interface RedisPublisherLike {
  publish(channel: string, message: string): Promise<unknown>;
}

/** Subscriber side (a dedicated connection — `client.duplicate()`). */
export interface RedisSubscriberLike {
  subscribe(channel: string, listener: (message: string) => void): Promise<unknown>;
  unsubscribe(channel: string): Promise<unknown>;
}

/** Options for {@link RedisSSEBroker}. */
export interface RedisSSEBrokerOptions extends EventStreamOptions {
  /** Redis channel prefix. Default `sse:`. */
  prefix?: string;
}

/** Cross-replica SSE fan-out over Redis pub/sub. */
export class RedisSSEBroker {
  private readonly local = new Map<string, Set<EventStream>>();
  private readonly prefix: string;
  private readonly streamOptions: EventStreamOptions;

  /**
   * @param publisher - The main Redis client (used to `publish`).
   * @param subscriber - A dedicated subscriber connection (`client.duplicate()`).
   * @param options - Channel prefix + per-stream options.
   */
  constructor(
    private readonly publisher: RedisPublisherLike,
    private readonly subscriber: RedisSubscriberLike,
    options: RedisSSEBrokerOptions = {},
  ) {
    this.prefix = options.prefix ?? "sse:";
    const { prefix: _p, ...streamOptions } = options;
    this.streamOptions = streamOptions;
  }

  private channelKey(channel: string): string {
    return `${this.prefix}${channel}`;
  }

  /** Emit a decoded payload to every local stream on a channel. */
  private emitLocal(channel: string, data: unknown, event?: string): void {
    const set = this.local.get(channel);
    if (!set) return;
    for (const stream of set) stream.publish(data, event);
  }

  /**
   * Register a subscriber stream, subscribing to the Redis channel on first use.
   *
   * @param channel - The channel name.
   * @returns A fresh {@link EventStream} to serve to the client.
   */
  async register(channel: string): Promise<EventStream> {
    const stream = new EventStream(this.streamOptions);
    let set = this.local.get(channel);
    if (!set) {
      set = new Set<EventStream>();
      this.local.set(channel, set);
      await this.subscriber.subscribe(this.channelKey(channel), (raw) => {
        try {
          const { data, event } = JSON.parse(raw) as { data: unknown; event?: string };
          this.emitLocal(channel, data, event);
        } catch {
          // ignore malformed frames
        }
      });
    }
    set.add(stream);
    return stream;
  }

  /**
   * Remove a subscriber stream; unsubscribe from Redis when the last leaves.
   *
   * @param channel - The channel name.
   * @param stream - The stream to remove.
   */
  async unregister(channel: string, stream: EventStream): Promise<void> {
    const set = this.local.get(channel);
    if (!set) return;
    set.delete(stream);
    stream.close();
    if (set.size === 0) {
      this.local.delete(channel);
      await this.subscriber.unsubscribe(this.channelKey(channel));
    }
  }

  /** Local subscriber count on `channel` (this replica only). */
  localSubscribers(channel: string): number {
    return this.local.get(channel)?.size ?? 0;
  }

  /**
   * Publish to every subscriber across all replicas.
   *
   * @param channel - The channel name.
   * @param data - The payload (JSON-encoded).
   * @param event - Optional event name.
   */
  async publish(channel: string, data: unknown, event?: string): Promise<void> {
    await this.publisher.publish(
      this.channelKey(channel),
      JSON.stringify({ data, ...(event ? { event } : {}) }),
    );
  }
}
