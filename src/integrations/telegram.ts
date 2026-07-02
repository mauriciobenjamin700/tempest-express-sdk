/**
 * Telegram provider — a client for the Telegram Bot API.
 *
 * Implements {@link MessagingProvider} over the built-in {@link HTTPClient}
 * (no external SDK). Outbound via `sendMessage`/`sendPhoto`/…; inbound via
 * `getUpdates` long-polling exposed through {@link TelegramProvider.onMessage}.
 */

import type {
  InboundHandler,
  MediaKind,
  MessagingProvider,
  OutboundMedia,
  OutboundResult,
} from "@/integrations/provider";
import { HTTPClient } from "@/utils/httpClient";

/** Options for {@link TelegramProvider}. */
export interface TelegramProviderOptions {
  /** Bot token from @BotFather. */
  token: string;
  /** API base. Default `https://api.telegram.org`. */
  apiBase?: string;
  /** Long-poll timeout in seconds for `getUpdates`. Default 30. */
  pollTimeoutSeconds?: number;
}

/** Bot API method suffix per media kind. */
const MEDIA_METHOD: Record<MediaKind, { method: string; field: string }> = {
  image: { method: "sendPhoto", field: "photo" },
  video: { method: "sendVideo", field: "video" },
  audio: { method: "sendAudio", field: "audio" },
  document: { method: "sendDocument", field: "document" },
};

/** A typed Telegram Bot API client. */
export class TelegramProvider implements MessagingProvider {
  private readonly http: HTTPClient;
  private readonly pollTimeout: number;

  /**
   * @param options - Bot token and API options.
   */
  constructor(options: TelegramProviderOptions) {
    const base = `${options.apiBase ?? "https://api.telegram.org"}/bot${options.token}`;
    this.pollTimeout = options.pollTimeoutSeconds ?? 30;
    this.http = new HTTPClient({
      baseUrl: base,
      defaultHeaders: { "content-type": "application/json" },
      // Timeout must exceed the long-poll window.
      timeoutMs: (this.pollTimeout + 10) * 1000,
    });
  }

  /** Call a Bot API method, returning the `result`, throwing on `ok: false`. */
  private async call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const res = await this.http.post(`/${method}`, { body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: T;
      description?: string;
    };
    if (!res.ok || !data.ok) {
      throw new Error(`Telegram ${method} failed: ${data.description ?? res.statusText}`);
    }
    return data.result as T;
  }

  async sendText(to: string, text: string): Promise<OutboundResult> {
    const result = await this.call<{ message_id: number }>("sendMessage", {
      chat_id: to,
      text,
    });
    return { id: String(result.message_id), status: "sent" };
  }

  async sendMedia(to: string, media: OutboundMedia): Promise<OutboundResult> {
    const { method, field } = MEDIA_METHOD[media.kind];
    const body: Record<string, unknown> = { chat_id: to, [field]: media.media };
    if (media.caption !== undefined) body.caption = media.caption;
    const result = await this.call<{ message_id: number }>(method, body);
    return { id: String(result.message_id), status: "sent" };
  }

  async status(): Promise<string> {
    try {
      await this.call<{ id: number }>("getMe", {});
      return "connected";
    } catch {
      return "disconnected";
    }
  }

  /**
   * Subscribe to inbound messages via `getUpdates` long-polling.
   *
   * @param handler - Invoked for each inbound text message.
   * @returns A stop function that ends the polling loop.
   */
  async onMessage(handler: InboundHandler): Promise<() => Promise<void>> {
    let running = true;
    let offset = 0;

    const loop = async (): Promise<void> => {
      while (running) {
        let updates: TelegramUpdate[] = [];
        try {
          updates = await this.call<TelegramUpdate[]>("getUpdates", {
            offset,
            timeout: this.pollTimeout,
          });
        } catch {
          if (running) await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        for (const update of updates) {
          offset = update.update_id + 1;
          const message = update.message;
          if (!message) continue;
          await handler({
            from: String(message.chat.id),
            messageId: String(message.message_id),
            ...(typeof message.text === "string" ? { text: message.text } : {}),
            mediaType: null,
            timestamp: new Date(message.date * 1000).toISOString(),
            direction: "incoming",
          });
        }
      }
    };

    void loop();
    return async () => {
      running = false;
    };
  }
}

/** Minimal shape of a Telegram update we consume. */
interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    date: number;
    text?: string;
    chat: { id: number };
  };
}
