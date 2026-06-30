/**
 * Cache managers, mirroring `cache.redis_manager`.
 *
 * A narrow async cache interface ({@link CacheManager}) with two backends: an
 * in-process {@link MemoryCacheManager} (dev/tests/single replica) and a
 * {@link RedisCacheManager} backed by the optional `redis` peer (lazily
 * imported, like the auth helpers). Values are JSON-serialized.
 */

/** Narrow async cache surface every backend implements. */
export interface CacheManager {
  /** Read a value by key, or `null` when missing/expired. */
  get<T>(key: string): Promise<T | null>;
  /** Write a value with an optional TTL in seconds. */
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  /** Delete a key. Idempotent. */
  delete(key: string): Promise<void>;
  /** Whether a live (non-expired) value exists for `key`. */
  has(key: string): Promise<boolean>;
  /** Remove every entry. */
  clear(): Promise<void>;
}

interface Entry {
  value: string;
  expiresAt: number | null;
}

/** In-process {@link CacheManager} backed by a `Map`, with lazy TTL expiry. */
export class MemoryCacheManager implements CacheManager {
  private readonly store = new Map<string, Entry>();

  private live(key: string): Entry | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry;
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.live(key);
    return entry ? (JSON.parse(entry.value) as T) : null;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    this.store.set(key, {
      value: JSON.stringify(value),
      expiresAt: ttlSeconds !== undefined ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async has(key: string): Promise<boolean> {
    return this.live(key) !== null;
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}

/** A minimal subset of the `redis` client this manager relies on. */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<unknown>;
  del(key: string): Promise<unknown>;
  exists(key: string): Promise<number>;
  flushDb(): Promise<unknown>;
}

/** Redis-backed {@link CacheManager}. Pass a connected `redis` v4 client. */
export class RedisCacheManager implements CacheManager {
  /**
   * @param client - A connected `redis` (node-redis v4) client or compatible.
   * @param prefix - Optional key prefix applied to every operation.
   */
  constructor(
    private readonly client: RedisLike,
    private readonly prefix = "",
  ) {}

  private key(key: string): string {
    return this.prefix ? `${this.prefix}${key}` : key;
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(this.key(key));
    return raw === null ? null : (JSON.parse(raw) as T);
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const payload = JSON.stringify(value);
    await this.client.set(
      this.key(key),
      payload,
      ttlSeconds !== undefined ? { EX: ttlSeconds } : undefined,
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.del(this.key(key));
  }

  async has(key: string): Promise<boolean> {
    return (await this.client.exists(this.key(key))) > 0;
  }

  async clear(): Promise<void> {
    await this.client.flushDb();
  }
}
