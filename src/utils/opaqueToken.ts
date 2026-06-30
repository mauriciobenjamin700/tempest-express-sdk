/**
 * Single-use opaque tokens hashed at rest, mirroring `utils.opaque_token`.
 *
 * For flows where a secret is emailed/SMS'd and later presented back (password
 * reset, email verification, magic links, API keys). The plaintext is shown
 * once; only its SHA-256 digest is stored, so a DB leak exposes no usable
 * tokens. Verification hashes the incoming plaintext and compares in constant
 * time. Pure standard library (`node:crypto`).
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const DEFAULT_NBYTES = 32;

/**
 * Return the SHA-256 hex digest of a token's plaintext.
 *
 * @param plaintext - The token value to hash.
 * @returns A 64-character lowercase hex digest.
 */
export function hashOpaqueToken(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

/**
 * Generate a cryptographically random token and its digest.
 *
 * @param nbytes - Entropy in bytes for the URL-safe token (default 32).
 * @returns `{ plaintext, tokenHash }` — show `plaintext` once, store `tokenHash`.
 */
export function generateOpaqueToken(nbytes: number = DEFAULT_NBYTES): {
  plaintext: string;
  tokenHash: string;
} {
  const plaintext = randomBytes(nbytes).toString("base64url");
  return { plaintext, tokenHash: hashOpaqueToken(plaintext) };
}

/**
 * Constant-time check that `plaintext` hashes to `tokenHash`.
 *
 * @param plaintext - The token submitted by the caller.
 * @param tokenHash - The stored SHA-256 hex digest.
 * @returns `true` when the hashes match.
 */
export function verifyOpaqueToken(plaintext: string, tokenHash: string): boolean {
  const computed = Buffer.from(hashOpaqueToken(plaintext), "hex");
  const expected = Buffer.from(tokenHash, "hex");
  if (computed.length !== expected.length) return false;
  return timingSafeEqual(computed, expected);
}
