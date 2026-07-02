/**
 * WhatsApp inbound-webhook receiver.
 *
 * `zap-api` POSTs every received message to a configured webhook. This builds
 * an Express router that (optionally) validates the shared `x-api-key`, parses
 * the payload into a typed {@link InboundMessage}, and hands it to your handler.
 */

import { timingSafeEqual } from "node:crypto";
import { UnauthorizedException } from "@/exceptions/http";
import { type InboundHandler, inboundMessageSchema } from "@/integrations/provider";
import { type Router, Router as createRouter } from "express";

/** Options for {@link makeWhatsAppWebhookRouter}. */
export interface WhatsAppWebhookOptions {
  /** Handler invoked for each validated inbound message. */
  onMessage: InboundHandler;
  /** Route path. Default `/whatsapp/inbound`. */
  path?: string;
  /** Shared secret expected in `x-api-key`. Omit to skip auth (dev only). */
  apiKey?: string;
}

/** Constant-time string comparison. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * Build the inbound-webhook router.
 *
 * @param options - Handler, path and optional shared secret.
 * @returns An Express router with the webhook endpoint mounted.
 */
export function makeWhatsAppWebhookRouter(options: WhatsAppWebhookOptions): Router {
  const path = options.path ?? "/whatsapp/inbound";
  const router = createRouter();

  router.post(path, async (req, res) => {
    if (options.apiKey) {
      const provided = req.header("x-api-key") ?? "";
      if (!safeEqual(provided, options.apiKey)) {
        throw new UnauthorizedException({ message: "Invalid webhook key" });
      }
    }
    // zap-api posts `{ from, messageId, text, mediaType, timestamp }`.
    const message = inboundMessageSchema.parse(req.body);
    await options.onMessage(message);
    res.status(200).json({ ok: true });
  });

  return router;
}
