/**
 * Web Push (VAPID) dispatch, mirroring `webpush.dispatcher`.
 *
 * Wraps the optional `web-push` peer (lazily imported). A `410 Gone` / `404`
 * from the push service means the subscription is dead — surfaced as
 * {@link WebPushGoneError} so the caller can prune it from storage.
 */

import type { WebPushPayload, WebPushSubscription } from "@/webpush/schemas";

/** A Web Push delivery failure. */
export class WebPushError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = "WebPushError";
  }
}

/** The subscription is expired/unsubscribed (410/404) — prune it. */
export class WebPushGoneError extends WebPushError {
  constructor(statusCode: number) {
    super("Push subscription is gone", statusCode);
    this.name = "WebPushGoneError";
  }
}

/** Options for {@link WebPushDispatcher}. */
export interface WebPushDispatcherOptions {
  /** VAPID public key. */
  publicKey: string;
  /** VAPID private key. */
  privateKey: string;
  /** VAPID subject (`mailto:` or site URL). */
  subject: string;
}

type WebPushModule = typeof import("web-push");

let cached: WebPushModule | null = null;

async function loadWebPush(): Promise<WebPushModule> {
  if (cached) return cached;
  try {
    const mod = (await import("web-push")) as WebPushModule & { default?: WebPushModule };
    cached = mod.default ?? mod;
  } catch (cause) {
    throw new Error(
      "WebPushDispatcher requires the 'web-push' peer dependency. Install with `npm i web-push`.",
      { cause },
    );
  }
  return cached;
}

/** Sends Web Push notifications with configured VAPID details. */
export class WebPushDispatcher {
  /**
   * @param options - VAPID keys and subject.
   */
  constructor(private readonly options: WebPushDispatcherOptions) {}

  /**
   * Send a payload to a single subscription.
   *
   * @param subscription - The browser push subscription.
   * @param payload - The notification payload.
   * @throws {WebPushGoneError} When the subscription is expired (410/404).
   * @throws {WebPushError} On any other delivery failure.
   */
  async send(subscription: WebPushSubscription, payload: WebPushPayload): Promise<void> {
    const webpush = await loadWebPush();
    webpush.setVapidDetails(
      this.options.subject,
      this.options.publicKey,
      this.options.privateKey,
    );
    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload));
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) throw new WebPushGoneError(status);
      throw new WebPushError((error as Error).message, status);
    }
  }
}
