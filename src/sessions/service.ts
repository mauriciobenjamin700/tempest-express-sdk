/**
 * Session service, mirroring `sessions.service`.
 *
 * Issues opaque session cookies, persists only their SHA-256 hash, and resolves
 * an incoming cookie back to a live {@link Session}. Built on the SDK's opaque
 * token helpers so the store never holds a usable cookie value.
 */

import type { Session, SessionStore } from "@/sessions/store";
import { generateOpaqueToken, hashOpaqueToken } from "@/utils/opaqueToken";

/** Options for {@link SessionService}. */
export interface SessionServiceOptions {
  /** The backing store. */
  store: SessionStore;
  /** Default session lifetime in seconds. Default 604800 (7 days). */
  ttlSeconds?: number;
}

/** A freshly created session and its one-time plaintext cookie value. */
export interface IssuedSession {
  /** The opaque cookie value to set on the client (shown once). */
  token: string;
  /** The persisted session row. */
  session: Session;
}

export class SessionService {
  private readonly store: SessionStore;
  private readonly ttlSeconds: number;

  /**
   * @param options - Store and default TTL.
   */
  constructor(options: SessionServiceOptions) {
    this.store = options.store;
    this.ttlSeconds = options.ttlSeconds ?? 60 * 60 * 24 * 7;
  }

  /**
   * Create a session for `userId` and return its one-time cookie value.
   *
   * @param userId - The owning user id.
   * @param data - Arbitrary session payload.
   * @param ttlSeconds - Override the default lifetime.
   * @returns The plaintext token (set as a cookie) and the stored session.
   */
  async create(
    userId: string,
    data: Record<string, unknown> = {},
    ttlSeconds?: number,
  ): Promise<IssuedSession> {
    const { plaintext, tokenHash } = generateOpaqueToken();
    const now = Date.now();
    const session: Session = {
      idHash: tokenHash,
      userId,
      data,
      createdAt: now,
      expiresAt: now + (ttlSeconds ?? this.ttlSeconds) * 1000,
    };
    await this.store.set(session);
    return { token: plaintext, session };
  }

  /**
   * Resolve an opaque cookie value to its live session.
   *
   * @param token - The plaintext cookie value.
   * @returns The session, or `null` when missing/expired.
   */
  async resolve(token: string): Promise<Session | null> {
    return this.store.get(hashOpaqueToken(token));
  }

  /**
   * Revoke a single session by its cookie value.
   *
   * @param token - The plaintext cookie value.
   */
  async destroy(token: string): Promise<void> {
    await this.store.delete(hashOpaqueToken(token));
  }

  /**
   * Revoke every session a user owns (global logout).
   *
   * @param userId - The user id.
   * @returns The number of sessions removed.
   */
  async destroyByUser(userId: string): Promise<number> {
    return this.store.deleteByUser(userId);
  }

  /**
   * List a user's live sessions (e.g. an "active devices" view).
   *
   * @param userId - The user id.
   * @returns The user's sessions, oldest first.
   */
  async listByUser(userId: string): Promise<Session[]> {
    return this.store.listByUser(userId);
  }
}
