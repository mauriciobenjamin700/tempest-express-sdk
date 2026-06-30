/**
 * Server-Sent Events primitives, mirroring `sse.event_stream`.
 *
 * {@link ServerSentEvent} encodes the SSE wire format; {@link EventStream} is a
 * per-subscriber push queue exposed as an async iterator with an optional
 * heartbeat; {@link sseResponse} wires a stream to an Express response.
 */

import type { Request, Response } from "express";

/** A single Server-Sent Event. */
export interface ServerSentEventInit {
  /** The event payload (serialized to one or more `data:` lines). */
  data: string;
  /** Optional event name (`event:` line). */
  event?: string;
  /** Optional event id (`id:` line). */
  id?: string;
  /** Optional reconnection hint in ms (`retry:` line). */
  retry?: number;
}

/** An SSE event that can encode itself to the wire format. */
export class ServerSentEvent {
  constructor(private readonly init: ServerSentEventInit) {}

  /**
   * Encode to the SSE wire format (terminated by a blank line).
   *
   * @returns The encoded event block.
   */
  encode(): string {
    const lines: string[] = [];
    if (this.init.event) lines.push(`event: ${this.init.event}`);
    if (this.init.id) lines.push(`id: ${this.init.id}`);
    if (this.init.retry !== undefined) lines.push(`retry: ${this.init.retry}`);
    for (const line of this.init.data.split("\n")) lines.push(`data: ${line}`);
    return `${lines.join("\n")}\n\n`;
  }
}

/** A deferred used to wake the iterator when a new event arrives. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Options for {@link EventStream}. */
export interface EventStreamOptions {
  /** Heartbeat interval in seconds (comment ping). `null` disables. Default 15. */
  heartbeatSeconds?: number | null;
}

/** A single subscriber's event queue, consumable as an async iterator. */
export class EventStream {
  private readonly queue: string[] = [];
  private waiter: ReturnType<typeof deferred<void>> | null = null;
  private closed = false;
  private readonly heartbeatSeconds: number | null;

  /**
   * @param options - Heartbeat configuration.
   */
  constructor(options: EventStreamOptions = {}) {
    this.heartbeatSeconds = options.heartbeatSeconds ?? 15;
  }

  /** Enqueue raw SSE-encoded text and wake the iterator. */
  private push(raw: string): void {
    if (this.closed) return;
    this.queue.push(raw);
    this.waiter?.resolve();
    this.waiter = null;
  }

  /**
   * Publish a data payload as an SSE event.
   *
   * @param data - The payload; objects are JSON-encoded.
   * @param event - Optional event name.
   */
  publish(data: unknown, event?: string): void {
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    this.push(
      new ServerSentEvent({ data: payload, ...(event ? { event } : {}) }).encode(),
    );
  }

  /** Publish a pre-built {@link ServerSentEvent}. */
  publishEvent(event: ServerSentEvent): void {
    this.push(event.encode());
  }

  /** Close the stream; the iterator finishes after draining. */
  close(): void {
    this.closed = true;
    this.waiter?.resolve();
    this.waiter = null;
  }

  /**
   * Async iterator yielding encoded SSE chunks, with periodic heartbeats.
   *
   * @returns An async iterator of encoded event strings.
   */
  async *stream(): AsyncIterator<string> & AsyncIterable<string> {
    const heartbeatMs =
      this.heartbeatSeconds !== null ? this.heartbeatSeconds * 1000 : null;
    while (!this.closed || this.queue.length > 0) {
      if (this.queue.length > 0) {
        yield this.queue.shift() as string;
        continue;
      }
      if (this.closed) break;
      this.waiter = deferred<void>();
      if (heartbeatMs === null) {
        await this.waiter.promise;
      } else {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const heartbeat = new Promise<void>((resolve) => {
          timer = setTimeout(resolve, heartbeatMs);
        });
        await Promise.race([this.waiter.promise, heartbeat]);
        if (timer) clearTimeout(timer);
        if (this.queue.length === 0 && !this.closed) yield ": ping\n\n";
      }
    }
  }
}

/**
 * Stream an {@link EventStream} to an Express response as `text/event-stream`.
 *
 * Sets the SSE headers, writes each encoded chunk, and closes the stream when
 * the client disconnects.
 *
 * @param req - The Express request (used to detect disconnect).
 * @param res - The Express response to stream into.
 * @param stream - The event stream to drain.
 */
export async function sseResponse(
  req: Request,
  res: Response,
  stream: EventStream,
): Promise<void> {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  req.on("close", () => stream.close());
  for await (const chunk of stream.stream()) {
    if (res.writableEnded) break;
    res.write(chunk);
  }
  res.end();
}
