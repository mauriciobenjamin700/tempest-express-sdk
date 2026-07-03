/**
 * Email channel — a {@link MessagingProvider} over {@link EmailUtils}.
 *
 * Lets transactional email participate in the same swappable messaging contract
 * as WhatsApp/Telegram/SMS: `sendText` sends a plain email, `sendMedia` sends
 * the media as a link in the body. Inbound (`onMessage`) is absent — email
 * ingestion is out of scope. Requires the optional `nodemailer` peer via
 * {@link EmailUtils}.
 */

import type {
  MessagingProvider,
  OutboundMedia,
  OutboundResult,
} from "@/integrations/provider";
import type { EmailUtils } from "@/utils/email";

/** Options for {@link EmailProvider}. */
export interface EmailProviderOptions {
  /** The configured SMTP sender. */
  email: EmailUtils;
  /** Default subject line for `sendText`/`sendMedia`. Default `"Notification"`. */
  subject?: string;
}

/** An email-backed {@link MessagingProvider}. */
export class EmailProvider implements MessagingProvider {
  private readonly email: EmailUtils;
  private readonly subject: string;

  /**
   * @param options - The email sender and default subject.
   */
  constructor(options: EmailProviderOptions) {
    this.email = options.email;
    this.subject = options.subject ?? "Notification";
  }

  /**
   * Send a plain-text email.
   *
   * @param to - Recipient address.
   * @param text - Body text (also used as HTML).
   * @returns A sent result.
   */
  async sendText(to: string, text: string): Promise<OutboundResult> {
    await this.email.send({ to, subject: this.subject, text });
    return { status: "sent" };
  }

  /**
   * Send an email linking to the media (caption becomes the lead text).
   *
   * @param to - Recipient address.
   * @param media - The media reference (URL) + optional caption.
   * @returns A sent result.
   */
  async sendMedia(to: string, media: OutboundMedia): Promise<OutboundResult> {
    const caption = media.caption ?? "";
    await this.email.send({
      to,
      subject: this.subject,
      html: `${caption ? `<p>${caption}</p>` : ""}<p><a href="${media.media}">${media.media}</a></p>`,
    });
    return { status: "sent" };
  }

  /** Always `"connected"` — SMTP reachability is verified on first send. */
  async status(): Promise<string> {
    return "connected";
  }
}
