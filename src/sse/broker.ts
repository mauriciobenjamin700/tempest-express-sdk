/**
 * In-process SSE broker, mirroring `sse.broker.SSEBroker`.
 *
 * Tracks subscribers per channel and fans published events out to every live
 * {@link EventStream} on that channel. Single-process (no cross-replica
 * transport yet — a Redis pub/sub backend is a planned follow-up).
 */

import { EventStream, type EventStreamOptions } from "@/sse/eventStream";

/** Fan-out hub mapping channels to subscriber streams. */
export class SSEBroker {
  private readonly channels = new Map<string, Set<EventStream>>();

  /**
   * @param streamOptions - Options applied to every {@link EventStream} created
   *   by {@link register} (e.g. heartbeat interval).
   */
  constructor(private readonly streamOptions: EventStreamOptions = {}) {}

  /**
   * Register a new subscriber stream on `channel`.
   *
   * @param channel - The channel name.
   * @returns A fresh {@link EventStream} to serve to the subscriber.
   */
  register(channel: string): EventStream {
    const stream = new EventStream(this.streamOptions);
    const set = this.channels.get(channel) ?? new Set<EventStream>();
    set.add(stream);
    this.channels.set(channel, set);
    return stream;
  }

  /**
   * Remove a subscriber stream from `channel` and close it.
   *
   * @param channel - The channel name.
   * @param stream - The stream to remove.
   */
  unregister(channel: string, stream: EventStream): void {
    const set = this.channels.get(channel);
    if (!set) return;
    set.delete(stream);
    stream.close();
    if (set.size === 0) this.channels.delete(channel);
  }

  /**
   * Number of live subscribers on `channel`.
   *
   * @param channel - The channel name.
   * @returns The subscriber count.
   */
  localSubscribers(channel: string): number {
    return this.channels.get(channel)?.size ?? 0;
  }

  /**
   * Publish an event to every subscriber on `channel`.
   *
   * @param channel - The channel name.
   * @param data - The payload (objects are JSON-encoded).
   * @param event - Optional event name.
   * @returns The number of subscribers the event was delivered to.
   */
  publish(channel: string, data: unknown, event?: string): number {
    const set = this.channels.get(channel);
    if (!set) return 0;
    for (const stream of set) stream.publish(data, event);
    return set.size;
  }
}
