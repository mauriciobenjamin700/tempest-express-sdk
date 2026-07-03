/**
 * Redis-backed {@link SessionStore} for multi-replica deployments.
 *
 * Sessions live under `sess:<idHash>` with a Redis TTL; a per-user set
 * (`sess:user:<userId>`) indexes them so `listByUser`/`deleteByUser` work
 * without scanning. Takes an injected client (node-redis v4 compatible) so the
 * SDK never hard-depends on `redis`. Expired keys drop via TTL; stale index
 * entries are pruned lazily on read.
 */

import type { Session, SessionStore } from "@/sessions/store";

/** The subset of a node-redis v4 client this store needs. */
export interface SessionRedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<unknown>;
  del(key: string): Promise<unknown>;
  sAdd(key: string, member: string): Promise<unknown>;
  sRem(key: string, member: string): Promise<unknown>;
  sMembers(key: string): Promise<string[]>;
}

/** Redis-backed session store. */
export class RedisSessionStore implements SessionStore {
  /**
   * @param client - A connected node-redis v4 (or compatible) client.
   * @param prefix - Key prefix. Default `sess:`.
   */
  constructor(
    private readonly client: SessionRedisLike,
    private readonly prefix = "sess:",
  ) {}

  private key(idHash: string): string {
    return `${this.prefix}${idHash}`;
  }

  private userKey(userId: string): string {
    return `${this.prefix}user:${userId}`;
  }

  async get(idHash: string): Promise<Session | null> {
    const raw = await this.client.get(this.key(idHash));
    if (raw === null) return null;
    const session = JSON.parse(raw) as Session;
    if (session.expiresAt <= Date.now()) {
      await this.delete(idHash);
      return null;
    }
    return session;
  }

  async set(session: Session): Promise<void> {
    const ttlSeconds = Math.max(1, Math.ceil((session.expiresAt - Date.now()) / 1000));
    await this.client.set(this.key(session.idHash), JSON.stringify(session), {
      EX: ttlSeconds,
    });
    await this.client.sAdd(this.userKey(session.userId), session.idHash);
  }

  async delete(idHash: string): Promise<void> {
    const raw = await this.client.get(this.key(idHash));
    await this.client.del(this.key(idHash));
    if (raw) {
      const session = JSON.parse(raw) as Session;
      await this.client.sRem(this.userKey(session.userId), idHash);
    }
  }

  async deleteByUser(userId: string): Promise<number> {
    const ids = await this.client.sMembers(this.userKey(userId));
    let count = 0;
    for (const idHash of ids) {
      await this.client.del(this.key(idHash));
      await this.client.sRem(this.userKey(userId), idHash);
      count += 1;
    }
    return count;
  }

  async listByUser(userId: string): Promise<Session[]> {
    const ids = await this.client.sMembers(this.userKey(userId));
    const sessions: Session[] = [];
    const now = Date.now();
    for (const idHash of ids) {
      const raw = await this.client.get(this.key(idHash));
      if (raw === null) {
        await this.client.sRem(this.userKey(userId), idHash); // prune stale index
        continue;
      }
      const session = JSON.parse(raw) as Session;
      if (session.expiresAt > now) sessions.push(session);
    }
    return sessions.sort((a, b) => a.createdAt - b.createdAt);
  }
}
