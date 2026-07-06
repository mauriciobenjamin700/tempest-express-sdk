/**
 * `WebhookSignatureVerifier` — HMAC signature verification for inbound
 * webhooks, mirroring `api.webhooks`.
 *
 * Providers compute `hmac(secret, body)` and ship the digest in a header (hex or
 * base64). This verifies it in constant time and exposes an Express middleware
 * that checks the header against the **raw** request body.
 */

import { type BinaryLike, createHmac, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler } from "express";

/** Options for {@link WebhookSignatureVerifier}. */
export interface WebhookSignatureOptions {
  /** Digest algorithm (e.g. `"sha256"`, `"sha512"`). Default `"sha256"`. */
  algorithm?: string;
  /** Header carrying the signature. Default `"X-Signature"`. */
  headerName?: string;
  /** Digest encoding. Default `"hex"`. */
  encoding?: "hex" | "base64";
  /** Prefix stripped from the header before comparing (e.g. `"sha256="`). */
  prefix?: string;
}

/** Verifies an HMAC webhook signature over a raw request body. */
export class WebhookSignatureVerifier {
  private readonly secret: BinaryLike;
  private readonly algorithm: string;
  private readonly headerName: string;
  private readonly encoding: "hex" | "base64";
  private readonly prefix: string;

  /**
   * @param secret - The shared signing secret.
   * @param options - Algorithm, header name, encoding and optional prefix.
   */
  constructor(secret: string | Buffer, options: WebhookSignatureOptions = {}) {
    this.secret = secret;
    this.algorithm = options.algorithm ?? "sha256";
    this.headerName = options.headerName ?? "X-Signature";
    this.encoding = options.encoding ?? "hex";
    this.prefix = options.prefix ?? "";
  }

  /** The header name this verifier reads. */
  get header(): string {
    return this.headerName;
  }

  /**
   * Compute the expected signature for a raw body.
   *
   * @param body - The raw request body.
   * @returns The signature in the configured encoding.
   */
  expected(body: BinaryLike): string {
    return createHmac(this.algorithm, this.secret).update(body).digest(this.encoding);
  }

  /**
   * Verify a signature against a raw body (constant time).
   *
   * @param body - The raw request body.
   * @param signature - The header value (including any configured prefix).
   * @returns `true` when it matches.
   */
  verify(body: BinaryLike, signature: string): boolean {
    let candidate = signature;
    if (this.prefix && candidate.startsWith(this.prefix)) {
      candidate = candidate.slice(this.prefix.length);
    }
    const expected = Buffer.from(this.expected(body));
    const provided = Buffer.from(candidate);
    if (expected.length !== provided.length) return false;
    return timingSafeEqual(expected, provided);
  }

  /**
   * Build an Express middleware that rejects requests with a bad signature.
   *
   * The route **must** receive the raw body as a `Buffer` — mount
   * `express.raw({ type: "..." })` (matching every content type) before this
   * middleware so `req.body` is the raw bytes. On success the request proceeds
   * (parse `req.body` yourself).
   *
   * @param options - Custom error message.
   * @returns An Express middleware.
   */
  middleware(options: { errorMessage?: string } = {}): RequestHandler {
    const errorMessage = options.errorMessage ?? "Invalid webhook signature";
    return (req: Request, res, next) => {
      const signature = req.header(this.headerName) ?? "";
      const body: BinaryLike = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(typeof req.body === "string" ? req.body : "");
      if (!signature || !this.verify(body, signature)) {
        res.status(401).json({ detail: errorMessage, code: "UNAUTHORIZED", details: {} });
        return;
      }
      next();
    };
  }
}
