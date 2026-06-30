/**
 * Session model + store, mirroring `sessions.store` / `sessions.schemas`.
 *
 * Sessions are keyed by the SHA-256 hash of the opaque cookie value, so a leak
 * of the store yields no reusable cookies. The {@link SessionStore} interface is
 * narrow; {@link MemorySessionStore} is the in-process implementation for
 * dev/tests/single-replica (a Redis store is a planned follow-up).
 */

/** A persisted session row. */
export interface Session {
  /** SHA-256 hash of the opaque cookie value (the store key). */
  idHash: string;
  /** The owning user id. */
  userId: string;
  /** Arbitrary JSON-serializable session payload. */
  data: Record<string, unknown>;
  /** Creation timestamp (epoch ms). */
  createdAt: number;
  /** Expiry timestamp (epoch ms). */
  expiresAt: number;
}

/** Persistence port every session backend implements. */
export interface SessionStore {
  /** Return the live session for `idHash`, or `null` when missing/expired. */
  get(idHash: string): Promise<Session | null>;
  /** Persist or overwrite a session. */
  set(session: Session): Promise<void>;
  /** Remove a single session. Idempotent. */
  delete(idHash: string): Promise<void>;
  /** Remove every session for `userId`; returns the count deleted. */
  deleteByUser(userId: string): Promise<number>;
  /** Return every live session for `userId` (oldest first). */
  listByUser(userId: string): Promise<Session[]>;
}

/** In-process {@link SessionStore} with a secondary user index. */
export class MemorySessionStore implements SessionStore {
  private readonly byHash = new Map<string, Session>();

  private live(session: Session | undefined, idHash: string): Session | null {
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      this.byHash.delete(idHash);
      return null;
    }
    return session;
  }

  async get(idHash: string): Promise<Session | null> {
    return this.live(this.byHash.get(idHash), idHash);
  }

  async set(session: Session): Promise<void> {
    this.byHash.set(session.idHash, session);
  }

  async delete(idHash: string): Promise<void> {
    this.byHash.delete(idHash);
  }

  async deleteByUser(userId: string): Promise<number> {
    let count = 0;
    for (const [hash, session] of this.byHash) {
      if (session.userId === userId) {
        this.byHash.delete(hash);
        count += 1;
      }
    }
    return count;
  }

  async listByUser(userId: string): Promise<Session[]> {
    const now = Date.now();
    return [...this.byHash.values()]
      .filter((s) => s.userId === userId && s.expiresAt > now)
      .sort((a, b) => a.createdAt - b.createdAt);
  }
}
