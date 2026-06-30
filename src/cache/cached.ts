/**
 * Read-through memoization helper, mirroring `cache.decorator.cached`.
 *
 * Wraps an async function so its result is cached under a derived key. On a hit
 * the cached value is returned without calling the function; on a miss the
 * function runs and its result is stored with an optional TTL.
 */

import type { CacheManager } from "@/cache/manager";

/** Options for {@link cached}. */
export interface CachedOptions<A extends unknown[]> {
  /** The cache backend to read/write. */
  manager: CacheManager;
  /** Build the cache key from the call arguments. */
  key: (...args: A) => string;
  /** TTL in seconds for stored values. Omit for no expiry. */
  ttlSeconds?: number;
}

/**
 * Wrap an async function with read-through caching.
 *
 * @param fn - The async function to memoize.
 * @param options - Cache backend, key builder and optional TTL.
 * @returns A function with the same signature, served from cache when possible.
 *
 * @example
 * ```ts
 * const getUser = cached(fetchUser, {
 *   manager,
 *   key: (id: string) => `user:${id}`,
 *   ttlSeconds: 60,
 * });
 * ```
 */
export function cached<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  options: CachedOptions<A>,
): (...args: A) => Promise<R> {
  return async (...args: A): Promise<R> => {
    const key = options.key(...args);
    const hit = await options.manager.get<R>(key);
    if (hit !== null) return hit;
    const result = await fn(...args);
    await options.manager.set(key, result, options.ttlSeconds);
    return result;
  };
}
