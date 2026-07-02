/**
 * TOTP (RFC 6238) helper for MFA, mirroring `utils.totp.TOTPHelper`.
 *
 * Implemented natively over `node:crypto` (HMAC-SHA1) — no external OTP library
 * needed. Generates a base32 secret, builds the `otpauth://` provisioning URI
 * (scanned as a QR code), and verifies a 6-digit code with a clock-drift window.
 */

import { createHmac, randomBytes } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Encode bytes to RFC 4648 base32 (no padding). */
function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Decode an RFC 4648 base32 string (ignores padding/case) to bytes. */
function base32Decode(secret: string): Buffer {
  const clean = secret.toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Compute the HOTP code for a counter, per RFC 4226. */
function hotp(secret: Buffer, counter: number, digits: number): string {
  const buffer = Buffer.alloc(8);
  // 53-bit safe integer counter written big-endian.
  buffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buffer.writeUInt32BE(counter >>> 0, 4);
  const digest = createHmac("sha1", secret).update(buffer).digest();
  const offset = (digest[digest.length - 1] as number) & 0xf;
  const binary =
    (((digest[offset] as number) & 0x7f) << 24) |
    (((digest[offset + 1] as number) & 0xff) << 16) |
    (((digest[offset + 2] as number) & 0xff) << 8) |
    ((digest[offset + 3] as number) & 0xff);
  return (binary % 10 ** digits).toString().padStart(digits, "0");
}

/** Options for {@link TOTPHelper}. */
export interface TOTPOptions {
  /** Label shown in the authenticator app (e.g. the product name). */
  issuer: string;
  /** Time step in seconds. Default 30. */
  step?: number;
  /** Number of digits. Default 6. */
  digits?: number;
}

/** Stateless TOTP issuer + verifier. Construct one per app. */
export class TOTPHelper {
  private readonly issuer: string;
  private readonly step: number;
  private readonly digits: number;

  /**
   * @param options - Issuer label, time step and digit count.
   */
  constructor(options: TOTPOptions) {
    this.issuer = options.issuer;
    this.step = options.step ?? 30;
    this.digits = options.digits ?? 6;
  }

  /**
   * Generate a fresh base32 secret (80 bits).
   *
   * @returns A base32-encoded TOTP secret to persist on the user row.
   */
  generateSecret(): string {
    return base32Encode(randomBytes(10));
  }

  /**
   * Build the `otpauth://` provisioning URI (render as a QR code).
   *
   * @param secret - The base32 secret.
   * @param accountName - Identifier shown next to the issuer (e.g. the email).
   * @returns The `otpauth://totp/...` URI.
   */
  provisioningUri(secret: string, accountName: string): string {
    const label = encodeURIComponent(`${this.issuer}:${accountName}`);
    const params = new URLSearchParams({
      secret,
      issuer: this.issuer,
      algorithm: "SHA1",
      digits: String(this.digits),
      period: String(this.step),
    });
    return `otpauth://totp/${label}?${params.toString()}`;
  }

  /**
   * Verify a code against the secret for the current time window.
   *
   * @param secret - The base32 secret.
   * @param code - The submitted code.
   * @param window - Tolerance in steps (±). Default 1 (previous/current/next).
   * @returns `true` when the code matches within the window.
   */
  verify(secret: string, code: string, window = 1): boolean {
    const cleaned = code.trim().replace(/[\s-]/g, "");
    if (!/^\d+$/.test(cleaned) || cleaned.length !== this.digits) return false;
    const key = base32Decode(secret);
    const counter = Math.floor(Date.now() / 1000 / this.step);
    for (let offset = -window; offset <= window; offset++) {
      if (hotp(key, counter + offset, this.digits) === cleaned) return true;
    }
    return false;
  }
}
