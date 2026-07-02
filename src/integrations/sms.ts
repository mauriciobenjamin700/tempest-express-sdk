/**
 * SMS provider — a Twilio client + inbound-webhook receiver.
 *
 * Implements {@link MessagingProvider} over the built-in {@link HTTPClient}
 * (no `twilio` SDK). SMS has no persistent subscription, so `onMessage` is
 * absent — inbound arrives via {@link makeTwilioWebhookRouter}, which validates
 * the `X-Twilio-Signature` HMAC.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { UnauthorizedException } from "@/exceptions/http";
import type {
  InboundHandler,
  MessagingProvider,
  OutboundMedia,
  OutboundResult,
} from "@/integrations/provider";
import { HTTPClient } from "@/utils/httpClient";
import { type Router, Router as createRouter } from "express";

/** Options for {@link TwilioSmsProvider}. */
export interface TwilioSmsProviderOptions {
  /** Twilio Account SID. */
  accountSid: string;
  /** Twilio Auth Token. */
  authToken: string;
  /** Default `From` number (E.164), e.g. `+15551234567`. */
  from: string;
  /** API base. Default `https://api.twilio.com`. */
  apiBase?: string;
}

/** A Twilio SMS client. */
export class TwilioSmsProvider implements MessagingProvider {
  private readonly http: HTTPClient;
  private readonly from: string;
  private readonly messagesPath: string;
  private readonly accountPath: string;

  /**
   * @param options - Account SID, auth token and default sender.
   */
  constructor(options: TwilioSmsProviderOptions) {
    this.from = options.from;
    this.messagesPath = `/2010-04-01/Accounts/${options.accountSid}/Messages.json`;
    this.accountPath = `/2010-04-01/Accounts/${options.accountSid}.json`;
    const basic = Buffer.from(`${options.accountSid}:${options.authToken}`).toString(
      "base64",
    );
    this.http = new HTTPClient({
      baseUrl: options.apiBase ?? "https://api.twilio.com",
      defaultHeaders: {
        Authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded",
      },
    });
  }

  /** POST a form body to Twilio and parse the JSON, throwing on non-2xx. */
  private async postForm(params: Record<string, string>): Promise<OutboundResult> {
    const res = await this.http.post(this.messagesPath, {
      body: new URLSearchParams(params).toString(),
    });
    const data = (await res.json().catch(() => ({}))) as {
      sid?: string;
      status?: string;
      message?: string;
    };
    if (!res.ok) {
      throw new Error(
        `Twilio send failed (${res.status}): ${data.message ?? res.statusText}`,
      );
    }
    return {
      status: data.status ?? "queued",
      ...(data.sid ? { id: data.sid } : {}),
    };
  }

  async sendText(to: string, text: string): Promise<OutboundResult> {
    return this.postForm({ To: to, From: this.from, Body: text });
  }

  async sendMedia(to: string, media: OutboundMedia): Promise<OutboundResult> {
    return this.postForm({
      To: to,
      From: this.from,
      MediaUrl: media.media,
      ...(media.caption !== undefined ? { Body: media.caption } : {}),
    });
  }

  async status(): Promise<string> {
    const res = await this.http.get(this.accountPath);
    const data = (await res.json().catch(() => ({}))) as { status?: string };
    return data.status ?? (res.ok ? "connected" : "disconnected");
  }
}

/**
 * Validate a Twilio request signature (`X-Twilio-Signature`).
 *
 * @param authToken - The Twilio auth token.
 * @param url - The full public URL Twilio posted to (scheme + host + path).
 * @param params - The POST form parameters.
 * @param signature - The `X-Twilio-Signature` header value.
 * @returns `true` when the signature matches.
 */
export function validateTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string,
): boolean {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((key) => key + params[key])
      .join("");
  const expected = createHmac("sha1", authToken).update(data, "utf8").digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Options for {@link makeTwilioWebhookRouter}. */
export interface TwilioWebhookOptions {
  /** Handler invoked for each inbound SMS. */
  onMessage: InboundHandler;
  /** Route path. Default `/sms/inbound`. */
  path?: string;
  /** Auth token; when set, `X-Twilio-Signature` is validated. */
  authToken?: string;
  /** Public URL Twilio posts to (needed for signature validation behind a proxy). */
  publicUrl?: string;
}

/**
 * Build the Twilio inbound-SMS webhook router.
 *
 * Twilio posts `application/x-www-form-urlencoded` (`From`, `Body`,
 * `MessageSid`, …). Mount after `express.urlencoded()` (included by `createApp`).
 *
 * @param options - Handler, path and signature-validation settings.
 * @returns An Express router with the webhook endpoint mounted.
 */
export function makeTwilioWebhookRouter(options: TwilioWebhookOptions): Router {
  const path = options.path ?? "/sms/inbound";
  const router = createRouter();

  router.post(path, async (req, res) => {
    const body = (req.body ?? {}) as Record<string, string>;
    if (options.authToken) {
      const url =
        options.publicUrl ?? `${req.protocol}://${req.get("host")}${req.originalUrl}`;
      const signature = req.header("x-twilio-signature") ?? "";
      if (!validateTwilioSignature(options.authToken, url, body, signature)) {
        throw new UnauthorizedException({ message: "Invalid Twilio signature" });
      }
    }
    await options.onMessage({
      from: String(body.From ?? ""),
      messageId: String(body.MessageSid ?? ""),
      ...(body.Body ? { text: body.Body } : {}),
      mediaType: null,
      timestamp: new Date().toISOString(),
      direction: "incoming",
    });
    res.type("text/xml").send("<Response></Response>");
  });

  return router;
}
