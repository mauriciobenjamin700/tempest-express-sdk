/**
 * Email-activation flow, mirroring the FastAPI SDK activation flow.
 *
 * Issues a single-use opaque token (only its SHA-256 hash is stored), emails
 * the plaintext to the user, and activates the account when the link is opened.
 */

import { InvalidTokenException } from "@/exceptions/http";
import { generateOpaqueToken, hashOpaqueToken } from "@/utils/opaqueToken";

/** Persistence port for activation tokens. */
export interface ActivationStore {
  /** Persist a token hash + expiry (epoch ms) for a user. */
  saveActivationToken(
    userId: string,
    tokenHash: string,
    expiresAt: number,
  ): Promise<void>;
  /** Look up a token hash, returning the owner + expiry, or `null`. */
  findActivationToken(
    tokenHash: string,
  ): Promise<{ userId: string; expiresAt: number } | null>;
  /** Remove a token hash (single-use). */
  clearActivationToken(tokenHash: string): Promise<void>;
  /** Mark a user active. */
  activate(userId: string): Promise<void>;
}

/** Options for {@link ActivationService}. */
export interface ActivationServiceOptions {
  /** The activation persistence port. */
  store: ActivationStore;
  /** Token lifetime in seconds. Default 86400 (24h). */
  ttlSeconds?: number;
}

export class ActivationService {
  private readonly store: ActivationStore;
  private readonly ttlSeconds: number;

  /**
   * @param options - Store and token TTL.
   */
  constructor(options: ActivationServiceOptions) {
    this.store = options.store;
    this.ttlSeconds = options.ttlSeconds ?? 60 * 60 * 24;
  }

  /**
   * Start activation: issue a token and persist its hash.
   *
   * @param userId - The user to activate.
   * @returns The one-time plaintext token (embed in the activation link).
   */
  async start(userId: string): Promise<string> {
    const { plaintext, tokenHash } = generateOpaqueToken();
    await this.store.saveActivationToken(
      userId,
      tokenHash,
      Date.now() + this.ttlSeconds * 1000,
    );
    return plaintext;
  }

  /**
   * Activate an account from a token.
   *
   * @param token - The plaintext token from the activation link.
   * @returns The activated user id.
   * @throws {InvalidTokenException} When the token is unknown or expired.
   */
  async activate(token: string): Promise<string> {
    const tokenHash = hashOpaqueToken(token);
    const record = await this.store.findActivationToken(tokenHash);
    if (!record || record.expiresAt <= Date.now()) {
      throw new InvalidTokenException({ message: "Invalid or expired activation token" });
    }
    await this.store.activate(record.userId);
    await this.store.clearActivationToken(tokenHash);
    return record.userId;
  }
}
