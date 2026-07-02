/**
 * WhatsApp provider — a typed client for the `zap-api` service.
 *
 * REST for sending (`/message/send-*`, `/message/check-number`) and session
 * control (`/session/*`); the `/ws` pub/sub for receiving inbound messages in
 * real time. HTTP goes through the SDK's resilient {@link HTTPClient}; the
 * WebSocket subscription uses the optional `ws` peer (lazily imported).
 *
 * @see https://github.com/mauriciobenjamin700 (zap-api)
 */

import type {
  InboundHandler,
  MediaKind,
  MessagingProvider,
  OutboundMedia,
  OutboundResult,
  SendOptions,
} from "@/integrations/provider";
import { HTTPClient } from "@/utils/httpClient";

/** Options for {@link WhatsAppProvider}. */
export interface WhatsAppProviderOptions {
  /** Base URL of the `zap-api` instance, e.g. `https://zap.example.com`. */
  baseUrl: string;
  /** Consumer API key (sent as `x-api-key`). */
  apiKey: string;
  /** WebSocket URL. Defaults to `baseUrl` with `http(s)`→`ws(s)` + `/ws`. */
  wsUrl?: string;
  /** Per-request timeout in ms. Default 15000. */
  timeoutMs?: number;
}

/** Route suffix per media kind. */
const MEDIA_ROUTE: Record<MediaKind, string> = {
  image: "send-image",
  video: "send-video",
  audio: "send-audio",
  document: "send-document",
};

/** Derive the default `ws(s)://…/ws` URL from an http(s) base URL. */
function deriveWsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  return `${trimmed.replace(/^http/, "ws")}/ws`;
}

/** A typed client for a running `zap-api` WhatsApp gateway. */
export class WhatsAppProvider implements MessagingProvider {
  private readonly http: HTTPClient;
  private readonly apiKey: string;
  private readonly wsUrl: string;

  /**
   * @param options - Base URL, API key and optional WebSocket URL.
   */
  constructor(options: WhatsAppProviderOptions) {
    this.apiKey = options.apiKey;
    this.wsUrl = options.wsUrl ?? deriveWsUrl(options.baseUrl);
    this.http = new HTTPClient({
      baseUrl: options.baseUrl.replace(/\/$/, ""),
      defaultHeaders: { "x-api-key": options.apiKey, "content-type": "application/json" },
      timeoutMs: options.timeoutMs ?? 15000,
    });
  }

  /** POST JSON and parse the response, throwing on a non-2xx status. */
  private async postJson(
    path: string,
    body: unknown,
    options?: SendOptions,
  ): Promise<Record<string, unknown>> {
    const headers = options?.idempotencyKey
      ? { "Idempotency-Key": options.idempotencyKey }
      : undefined;
    const res = await this.http.post(path, {
      body: JSON.stringify(body),
      ...(headers ? { headers } : {}),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(
        `zap-api ${path} failed (${res.status}): ${String(data.error ?? res.statusText)}`,
      );
    }
    return data;
  }

  async sendText(
    to: string,
    text: string,
    options?: SendOptions,
  ): Promise<OutboundResult> {
    const data = await this.postJson("/message/send-text", { to, text }, options);
    return {
      status: String(data.status ?? "queued"),
      ...(typeof data.id === "string" ? { id: data.id } : {}),
      ...(typeof data.deduped === "boolean" ? { deduped: data.deduped } : {}),
    };
  }

  async sendMedia(
    to: string,
    media: OutboundMedia,
    options?: SendOptions,
  ): Promise<OutboundResult> {
    const body: Record<string, unknown> = { to, media: media.media };
    if (media.caption !== undefined) body.caption = media.caption;
    if (media.fileName !== undefined) body.fileName = media.fileName;
    const data = await this.postJson(
      `/message/${MEDIA_ROUTE[media.kind]}`,
      body,
      options,
    );
    return {
      status: String(data.status ?? "queued"),
      ...(typeof data.id === "string" ? { id: data.id } : {}),
      ...(typeof data.deduped === "boolean" ? { deduped: data.deduped } : {}),
    };
  }

  async checkNumber(number: string): Promise<boolean> {
    const res = await this.http.get(
      `/message/check-number/${encodeURIComponent(number)}`,
    );
    const data = (await res.json().catch(() => ({}))) as { exists?: boolean };
    return data.exists === true;
  }

  async status(): Promise<string> {
    const res = await this.http.get("/session/status");
    const raw = await res.text();
    try {
      const parsed = JSON.parse(raw) as { status?: string };
      return parsed.status ?? raw.trim();
    } catch {
      return raw.trim();
    }
  }

  /** Start the WhatsApp session (returns the authenticated QR URL, if any). */
  async startSession(): Promise<Record<string, unknown>> {
    return this.postJson("/session/start", {});
  }

  async onMessage(handler: InboundHandler, room = "*"): Promise<() => Promise<void>> {
    let ws: typeof import("ws");
    try {
      ws = await import("ws");
    } catch (cause) {
      throw new Error(
        "WhatsAppProvider.onMessage requires the 'ws' peer dependency. Install with `npm i ws`.",
        { cause },
      );
    }
    const socket = new ws.WebSocket(this.wsUrl, {
      headers: { "x-api-key": this.apiKey },
    });

    socket.on("open", () => {
      socket.send(JSON.stringify({ action: "subscribe", room }));
    });
    socket.on("message", (raw: unknown) => {
      let frame: { type?: string; payload?: unknown };
      try {
        frame = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (frame.type === "message" && frame.payload) {
        const p = frame.payload as Record<string, unknown>;
        void handler({
          from: String(p.remoteJid ?? ""),
          messageId: String(p.messageId ?? ""),
          ...(typeof p.text === "string" ? { text: p.text } : {}),
          mediaType: (p.mediaType as InboundMessageMediaType) ?? null,
          timestamp: String(p.timestamp ?? ""),
          ...(p.direction === "incoming" || p.direction === "outgoing"
            ? { direction: p.direction }
            : {}),
        });
      }
    });

    return async () => {
      try {
        socket.send(JSON.stringify({ action: "unsubscribe", room }));
      } catch {
        // socket may already be closed.
      }
      socket.close();
    };
  }
}

/** The media-type union carried on inbound frames. */
type InboundMessageMediaType =
  | "image"
  | "video"
  | "audio"
  | "document"
  | "sticker"
  | null;
