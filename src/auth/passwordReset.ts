/**
 * Password-reset flow, mirroring the FastAPI SDK reset flow.
 *
 * `request` issues a single-use opaque token (hash stored) for a known email,
 * returning it so the caller can email the reset link — without leaking whether
 * the email exists. `confirm` validates the token + new password and rehashes.
 */

import { InvalidTokenException, ValidationException } from "@/exceptions/http";
import { generateOpaqueToken, hashOpaqueToken } from "@/utils/opaqueToken";
import type { PasswordUtils } from "@/utils/password";

/** Persistence port for password resets. */
export interface PasswordResetStore {
  /** Resolve a (lowercased) email to a user id, or `null`. */
  findUserIdByEmail(email: string): Promise<string | null>;
  /** Persist a reset token hash + expiry (epoch ms). */
  saveResetToken(userId: string, tokenHash: string, expiresAt: number): Promise<void>;
  /** Look up a reset token hash, returning owner + expiry, or `null`. */
  findResetToken(
    tokenHash: string,
  ): Promise<{ userId: string; expiresAt: number } | null>;
  /** Remove a reset token hash (single-use). */
  clearResetToken(tokenHash: string): Promise<void>;
  /** Overwrite a user's password hash. */
  updatePassword(userId: string, passwordHash: string): Promise<void>;
}

/** Options for {@link PasswordResetService}. */
export interface PasswordResetServiceOptions {
  /** The reset persistence port. */
  store: PasswordResetStore;
  /** Password hasher. */
  password: PasswordUtils;
  /** Token lifetime in seconds. Default 3600 (1h). */
  ttlSeconds?: number;
  /** Minimum new-password length. Default 12. */
  passwordMinLength?: number;
}

export class PasswordResetService {
  private readonly store: PasswordResetStore;
  private readonly password: PasswordUtils;
  private readonly ttlSeconds: number;
  private readonly passwordMinLength: number;

  /**
   * @param options - Store, password hasher and policy.
   */
  constructor(options: PasswordResetServiceOptions) {
    this.store = options.store;
    this.password = options.password;
    this.ttlSeconds = options.ttlSeconds ?? 3600;
    this.passwordMinLength = options.passwordMinLength ?? 12;
  }

  /**
   * Request a reset for `email`.
   *
   * Returns the plaintext token only when the email maps to a user; otherwise
   * `null`. Callers should respond with the same success shape either way to
   * avoid user enumeration — email the token only when present.
   *
   * @param email - The account email.
   * @returns The one-time token, or `null` when no user matches.
   */
  async request(email: string): Promise<string | null> {
    const userId = await this.store.findUserIdByEmail(email.toLowerCase());
    if (!userId) return null;
    const { plaintext, tokenHash } = generateOpaqueToken();
    await this.store.saveResetToken(
      userId,
      tokenHash,
      Date.now() + this.ttlSeconds * 1000,
    );
    return plaintext;
  }

  /**
   * Confirm a reset: validate the token + new password and rehash.
   *
   * @param token - The plaintext reset token.
   * @param newPassword - The new plaintext password.
   * @throws {ValidationException} When the new password is too short.
   * @throws {InvalidTokenException} When the token is unknown or expired.
   */
  async confirm(token: string, newPassword: string): Promise<void> {
    if (newPassword.length < this.passwordMinLength) {
      throw new ValidationException({
        message: `Password must be at least ${this.passwordMinLength} characters`,
        details: { minLength: this.passwordMinLength },
      });
    }
    const tokenHash = hashOpaqueToken(token);
    const record = await this.store.findResetToken(tokenHash);
    if (!record || record.expiresAt <= Date.now()) {
      throw new InvalidTokenException({ message: "Invalid or expired reset token" });
    }
    await this.store.updatePassword(record.userId, await this.password.hash(newPassword));
    await this.store.clearResetToken(tokenHash);
  }
}
