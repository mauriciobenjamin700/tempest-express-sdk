/**
 * Messaging integration contracts.
 *
 * A channel-agnostic {@link MessagingProvider} so WhatsApp, SMS and future
 * channels share one shape and are swappable in tests. The first implementation
 * is {@link WhatsAppProvider} (a client for the `zap-api` service).
 */

import { z } from "@/schemas/base";

/** Supported media kinds for {@link MessagingProvider.sendMedia}. */
export type MediaKind = "image" | "video" | "audio" | "document";

/** A media message to send. */
export interface OutboundMedia {
  /** The media kind (selects the underlying route). */
  kind: MediaKind;
  /** A public `http(s)://` URL or a `data:` URI. */
  media: string;
  /** Optional caption (image/video). */
  caption?: string;
  /** File name with extension (required for `document`). */
  fileName?: string;
}

/** The result of enqueuing an outbound message. */
export interface OutboundResult {
  /** Provider message id, when returned. */
  id?: string;
  /** Provider status string (e.g. `"queued"`, `"sent"`). */
  status: string;
  /** Whether the send was de-duplicated by an idempotency key. */
  deduped?: boolean;
}

/** Options accepted by send operations. */
export interface SendOptions {
  /** Idempotency key to de-duplicate retries on the provider side. */
  idempotencyKey?: string;
}

/** A normalized inbound (or echoed outbound) message. */
export const inboundMessageSchema = z
  .object({
    /** Conversation JID / sender (e.g. `5511999999999@s.whatsapp.net`). */
    from: z.string().openapi({ description: "Conversation JID / sender." }),
    /** Provider message id. */
    messageId: z.string().openapi({ description: "Provider message id." }),
    /** Text body, when present. */
    text: z.string().optional().openapi({ description: "Text body." }),
    /** Media kind, or `null` for plain text. */
    mediaType: z
      .enum(["image", "video", "audio", "document", "sticker"])
      .nullable()
      .openapi({ description: "Media kind, or null for text." }),
    /** ISO-8601 timestamp. */
    timestamp: z.string().openapi({ description: "ISO-8601 timestamp." }),
    /** Delivery direction. */
    direction: z.enum(["incoming", "outgoing"]).optional(),
  })
  .openapi("InboundMessage");

/** A normalized inbound message. */
export type InboundMessage = z.infer<typeof inboundMessageSchema>;

/** Handler invoked for each inbound message. */
export type InboundHandler = (message: InboundMessage) => Promise<void> | void;

/**
 * A channel-agnostic messaging provider. `sendText`/`sendMedia`/`status` are
 * universal; `checkNumber` and `onMessage` are optional because not every
 * channel supports them (e.g. SMS has no persistent subscription — its inbound
 * arrives via a webhook receiver instead).
 */
export interface MessagingProvider {
  /** Send a text message. */
  sendText(to: string, text: string, options?: SendOptions): Promise<OutboundResult>;
  /** Send a media message. */
  sendMedia(
    to: string,
    media: OutboundMedia,
    options?: SendOptions,
  ): Promise<OutboundResult>;
  /** The current session/connection status. */
  status(): Promise<string>;
  /** Whether a number/handle exists on the channel (when supported). */
  checkNumber?(number: string): Promise<boolean>;
  /**
   * Subscribe to inbound messages; resolves to an unsubscribe function.
   * Present only on channels with a live subscription (WhatsApp `/ws`,
   * Telegram long-polling).
   *
   * @param handler - Invoked for each inbound message.
   * @param room - Conversation to scope to; `"*"` for all. Default `"*"`.
   */
  onMessage?(handler: InboundHandler, room?: string): Promise<() => Promise<void>>;
}
