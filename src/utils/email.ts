/**
 * Transactional email, mirroring `utils.email.EmailUtils`.
 *
 * Wraps the optional `nodemailer` peer (lazily imported) behind a tiny
 * `send` surface. The transport is created once from SMTP options and reused.
 */

/** SMTP connection + sender options. */
export interface EmailOptions {
  /** SMTP host. */
  host: string;
  /** SMTP port. Default 587. */
  port?: number;
  /** Use TLS on connect. Default `false` (STARTTLS on 587). */
  secure?: boolean;
  /** SMTP auth user. */
  user?: string;
  /** SMTP auth password. */
  password?: string;
  /** Default `From` address. */
  from: string;
}

/** A single email message. */
export interface EmailMessage {
  /** Recipient(s). */
  to: string | string[];
  /** Subject line. */
  subject: string;
  /** Plain-text body. */
  text?: string;
  /** HTML body. */
  html?: string;
  /** Override the default `From`. */
  from?: string;
}

type NodemailerModule = typeof import("nodemailer");
type Transport = ReturnType<NodemailerModule["createTransport"]>;

/** Sends transactional email over SMTP via `nodemailer`. */
export class EmailUtils {
  private transport: Transport | null = null;

  /**
   * @param options - SMTP connection and default sender.
   */
  constructor(private readonly options: EmailOptions) {}

  private async ready(): Promise<Transport> {
    if (this.transport) return this.transport;
    let nodemailer: NodemailerModule;
    try {
      const mod = (await import("nodemailer")) as NodemailerModule & {
        default?: NodemailerModule;
      };
      nodemailer = mod.default ?? mod;
    } catch (cause) {
      throw new Error(
        "EmailUtils requires the 'nodemailer' peer dependency. Install with `npm i nodemailer`.",
        { cause },
      );
    }
    this.transport = nodemailer.createTransport({
      host: this.options.host,
      port: this.options.port ?? 587,
      secure: this.options.secure ?? false,
      ...(this.options.user
        ? { auth: { user: this.options.user, pass: this.options.password ?? "" } }
        : {}),
    });
    return this.transport;
  }

  /**
   * Send an email message.
   *
   * @param message - The message (recipients, subject, body).
   */
  async send(message: EmailMessage): Promise<void> {
    const transport = await this.ready();
    await transport.sendMail({
      from: message.from ?? this.options.from,
      to: message.to,
      subject: message.subject,
      ...(message.text !== undefined ? { text: message.text } : {}),
      ...(message.html !== undefined ? { html: message.html } : {}),
    });
  }
}
