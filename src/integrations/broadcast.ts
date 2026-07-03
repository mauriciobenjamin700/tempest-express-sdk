/**
 * Broadcast + multi-channel helpers over {@link MessagingProvider}.
 *
 * {@link broadcastText} fans one message out to many recipients through a single
 * provider, with bounded concurrency and a per-recipient result (one failure
 * never aborts the rest). {@link MessagingHub} keeps named providers so app code
 * sends by channel name and can broadcast across all of them.
 */

import type {
  MessagingProvider,
  OutboundResult,
  SendOptions,
} from "@/integrations/provider";

/** The outcome of a single recipient's send within a broadcast. */
export interface BroadcastResult {
  /** The recipient address/handle. */
  to: string;
  /** Whether the send succeeded. */
  ok: boolean;
  /** The provider result, when successful. */
  result?: OutboundResult;
  /** The error message, when failed. */
  error?: string;
}

/** Options for {@link broadcastText}. */
export interface BroadcastOptions extends SendOptions {
  /** Maximum concurrent sends. Default 10. */
  concurrency?: number;
}

/** Run `worker` over `items` with at most `limit` in flight, preserving order. */
async function pool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index] as T, index);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Send `text` to every recipient through `provider`, bounded by concurrency.
 *
 * A failed recipient is captured in its {@link BroadcastResult} (`ok: false`)
 * rather than aborting the batch.
 *
 * @param provider - The channel to send through.
 * @param recipients - Recipient addresses/handles.
 * @param text - The message body.
 * @param options - Concurrency + send options.
 * @returns One result per recipient, in input order.
 */
export function broadcastText(
  provider: MessagingProvider,
  recipients: string[],
  text: string,
  options: BroadcastOptions = {},
): Promise<BroadcastResult[]> {
  const { concurrency = 10, ...sendOptions } = options;
  return pool(recipients, concurrency, async (to) => {
    try {
      const result = await provider.sendText(to, text, sendOptions);
      return { to, ok: true, result };
    } catch (error) {
      return {
        to,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

/** A registry of named messaging channels. */
export class MessagingHub {
  private readonly channels = new Map<string, MessagingProvider>();

  /**
   * Register a provider under a channel name.
   *
   * @param name - The channel name (e.g. `"whatsapp"`, `"sms"`).
   * @param provider - The provider implementation.
   * @returns The hub (chainable).
   */
  register(name: string, provider: MessagingProvider): this {
    this.channels.set(name, provider);
    return this;
  }

  /**
   * Get a registered provider, throwing when the channel is unknown.
   *
   * @param name - The channel name.
   * @returns The provider.
   * @throws {Error} When no provider is registered under `name`.
   */
  get(name: string): MessagingProvider {
    const provider = this.channels.get(name);
    if (!provider) throw new Error(`Unknown messaging channel: ${name}`);
    return provider;
  }

  /** The registered channel names. */
  channelNames(): string[] {
    return [...this.channels.keys()];
  }

  /**
   * Send text through a named channel.
   *
   * @param channel - The channel name.
   * @param to - The recipient.
   * @param text - The message body.
   * @param options - Send options.
   * @returns The provider result.
   */
  send(
    channel: string,
    to: string,
    text: string,
    options?: SendOptions,
  ): Promise<OutboundResult> {
    return this.get(channel).sendText(to, text, options);
  }

  /**
   * Broadcast text to many recipients on a named channel.
   *
   * @param channel - The channel name.
   * @param recipients - Recipient addresses/handles.
   * @param text - The message body.
   * @param options - Broadcast + send options.
   * @returns One result per recipient.
   */
  broadcast(
    channel: string,
    recipients: string[],
    text: string,
    options?: BroadcastOptions,
  ): Promise<BroadcastResult[]> {
    return broadcastText(this.get(channel), recipients, text, options);
  }
}
