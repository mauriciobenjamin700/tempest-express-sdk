/**
 * Sliding-window rate-limit middleware with pluggable stores and keys,
 * mirroring `api.middlewares.rate_limit`.
 *
 * Two axes are pluggable:
 *
 * - **Store** — where the counters live. {@link MemoryRateLimitStore} (default,
 *   in-process) fits a single worker; {@link RedisRateLimitStore} shares state
 *   across replicas via an atomic Lua sliding-window log.
 * - **Key** — *who* a request counts against. {@link keyByIp} (default),
 *   {@link keyByHeader} (e.g. an API key), {@link keyByJwtClaim} /
 *   {@link keyByJwtSubject} (per authenticated principal), each falling back to
 *   the client IP for anonymous traffic.
 */

import { randomUUID } from "node:crypto";
import { type ClientIpOptions, getClientIp } from "@/utils/clientIp";
import type { Request, RequestHandler } from "express";

/** Outcome of a single rate-limit check. */
export interface RateLimitResult {
  /** `true` when the request fits under the limit. */
  allowed: boolean;
  /** Requests still allowed in the current window (`0` when rejected). */
  remaining: number;
  /** Seconds to wait before retrying (`0` when allowed, `>= 1` on rejection). */
  retryAfter: number;
}

/** Backend that counts hits per key inside a sliding window. */
export interface RateLimitStore {
  /**
   * Register one hit for `key` and report whether it is allowed.
   *
   * @param key - The rate-limit bucket key.
   * @param maxRequests - Maximum hits allowed in the window.
   * @param windowSeconds - Sliding-window length in seconds.
   * @returns The decision for this hit.
   */
  hit(key: string, maxRequests: number, windowSeconds: number): Promise<RateLimitResult>;
}

/**
 * In-process sliding-window store backed by per-key timestamp logs.
 *
 * State lives in this worker's memory only — correct for a single process. For
 * multi-replica deployments use {@link RedisRateLimitStore}.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, number[]>();

  async hit(
    key: string,
    maxRequests: number,
    windowSeconds: number,
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const cutoff = now - windowMs;
    const bucket = this.buckets.get(key) ?? [];
    // Prune timestamps older than the window.
    let start = 0;
    while (start < bucket.length) {
      const ts = bucket[start];
      if (ts === undefined || ts >= cutoff) break;
      start += 1;
    }
    const live = start > 0 ? bucket.slice(start) : bucket;

    if (live.length >= maxRequests) {
      this.buckets.set(key, live);
      const oldest = live[0] ?? now;
      const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      return { allowed: false, remaining: 0, retryAfter };
    }
    live.push(now);
    this.buckets.set(key, live);
    return { allowed: true, remaining: maxRequests - live.length, retryAfter: 0 };
  }
}

/** Minimal async Redis surface used by {@link RedisRateLimitStore}. */
export interface RateLimitRedisLike {
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
}

// Atomic sliding-window log: drop expired members, count, and only add the new
// member when still under the limit. Returns {allowed, remaining, retry_ms}.
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
if count < limit then
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, window)
  return {1, limit - count - 1, 0}
end
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local retry = window
if oldest[2] then
  retry = (tonumber(oldest[2]) + window) - now
end
if retry < 1 then retry = 1 end
return {0, 0, retry}
`;

/**
 * Distributed sliding-window store backed by a Redis sorted set. A single Lua
 * script prunes expired members, counts survivors and conditionally adds the
 * new hit, so the check is atomic across replicas. On a backend error the
 * request is allowed when `failOpen` (the default).
 */
export class RedisRateLimitStore implements RateLimitStore {
  private readonly namespace: string;
  private readonly failOpen: boolean;

  /**
   * @param redis - Async Redis client exposing `eval({ keys, arguments })`.
   * @param options - Key namespace and fail-open behavior.
   */
  constructor(
    private readonly redis: RateLimitRedisLike,
    options: { namespace?: string; failOpen?: boolean } = {},
  ) {
    this.namespace = options.namespace ?? "ratelimit";
    this.failOpen = options.failOpen ?? true;
  }

  async hit(
    key: string,
    maxRequests: number,
    windowSeconds: number,
  ): Promise<RateLimitResult> {
    const nowMs = Date.now();
    const windowMs = Math.round(windowSeconds * 1000);
    const member = randomUUID();
    try {
      const raw = (await this.redis.eval(SLIDING_WINDOW_LUA, {
        keys: [`${this.namespace}:${key}`],
        arguments: [String(nowMs), String(windowMs), String(maxRequests), member],
      })) as [number, number, number];
      const [allowedFlag, remaining, retryMs] = raw;
      const allowed = Boolean(allowedFlag);
      return {
        allowed,
        remaining: Number(remaining),
        retryAfter: allowed ? 0 : Math.max(1, Math.ceil(Number(retryMs) / 1000)),
      };
    } catch (error) {
      if (this.failOpen) {
        return { allowed: true, remaining: maxRequests - 1, retryAfter: 0 };
      }
      throw error;
    }
  }
}

/** Builds a rate-limit bucket key from a request (sync or async). */
export type RateLimitKeyFunc = (req: Request) => string | Promise<string>;

/** Minimal JWT decoder surface used by the `keyByJwt*` helpers. */
export interface JwtDecoderLike {
  decode(token: string): Promise<Record<string, unknown>>;
}

/** Build `ClientIpOptions`, omitting `trustedHeader` when undefined. */
function ipOpts(trustedHeader: string | undefined): ClientIpOptions {
  return trustedHeader !== undefined ? { trustedHeader } : {};
}

function bearerToken(req: Request): string | null {
  const header = req.header("authorization");
  if (!header) return null;
  const parts = header.split(/\s+/, 2);
  const [scheme, token] = parts;
  if (scheme?.toLowerCase() === "bearer" && token) return token.trim();
  return null;
}

/** Build a key function that buckets by resolved client IP. */
export function keyByIp(options: ClientIpOptions = {}): RateLimitKeyFunc {
  return (req) => `ip:${getClientIp(req, options)}`;
}

/**
 * Build a key function that buckets by a request header value (e.g. an API
 * key), falling back to the client IP for anonymous callers.
 */
export function keyByHeader(
  headerName: string,
  options: { scope?: string; fallbackToIp?: boolean; trustedIpHeader?: string } = {},
): RateLimitKeyFunc {
  const scope = options.scope ?? "key";
  const fallbackToIp = options.fallbackToIp ?? true;
  return (req) => {
    const value = req.header(headerName);
    if (value) return `${scope}:${value.trim()}`;
    if (fallbackToIp) return `ip:${getClientIp(req, ipOpts(options.trustedIpHeader))}`;
    return `${scope}:anonymous`;
  };
}

/**
 * Build a key function that buckets by a claim in the bearer token, falling
 * back to the client IP for anonymous traffic.
 */
export function keyByJwtClaim(
  jwt: JwtDecoderLike,
  claim: string,
  options: { scope?: string; fallbackToIp?: boolean; trustedIpHeader?: string } = {},
): RateLimitKeyFunc {
  const label = options.scope ?? claim;
  const fallbackToIp = options.fallbackToIp ?? true;
  return async (req) => {
    const token = bearerToken(req);
    if (token) {
      try {
        const claims = await jwt.decode(token);
        const value = claims[claim];
        if (value !== undefined && value !== null) return `${label}:${String(value)}`;
      } catch {
        // Invalid/expired token — treat as anonymous.
      }
    }
    if (fallbackToIp) return `ip:${getClientIp(req, ipOpts(options.trustedIpHeader))}`;
    return `${label}:anonymous`;
  };
}

/** Build a key function that buckets by the JWT `sub` claim (per-user). */
export function keyByJwtSubject(
  jwt: JwtDecoderLike,
  options: { fallbackToIp?: boolean; trustedIpHeader?: string } = {},
): RateLimitKeyFunc {
  return keyByJwtClaim(jwt, "sub", { scope: "user", ...options });
}

/** Options for {@link rateLimitMiddleware}. */
export interface RateLimitOptions {
  /** Maximum requests per window. Default `60`. */
  maxRequests?: number;
  /** Window length in seconds. Default `60`. */
  windowSeconds?: number;
  /** Build a rate-limit key from the request. Overrides `trustedIpHeader`. */
  keyFunc?: RateLimitKeyFunc;
  /** Single edge-set header to resolve the client IP from when keying by IP. */
  trustedIpHeader?: string;
  /** Counter backend. Defaults to an in-process {@link MemoryRateLimitStore}. */
  store?: RateLimitStore;
  /** Exact paths to skip entirely (e.g. health probes). */
  exemptPaths?: string[];
  /** Whether to add a `Retry-After` header on 429s. Default `true`. */
  retryAfterHeader?: boolean;
  /** Body message of the 429 response. */
  errorMessage?: string;
}

/**
 * Build a sliding-window rate-limit middleware.
 *
 * @param options - Limits, key/store strategy and exemptions.
 * @returns An Express middleware rejecting excess traffic with `429`.
 * @throws {RangeError} When `maxRequests` < 1 or `windowSeconds` <= 0.
 */
export function rateLimitMiddleware(options: RateLimitOptions = {}): RequestHandler {
  const maxRequests = options.maxRequests ?? 60;
  const windowSeconds = options.windowSeconds ?? 60;
  if (maxRequests < 1) throw new RangeError("maxRequests must be >= 1");
  if (windowSeconds <= 0) throw new RangeError("windowSeconds must be > 0");

  const store = options.store ?? new MemoryRateLimitStore();
  const keyFunc: RateLimitKeyFunc =
    options.keyFunc ?? keyByIp(ipOpts(options.trustedIpHeader));
  const exempt = new Set(options.exemptPaths ?? []);
  const retryAfterHeader = options.retryAfterHeader ?? true;
  const errorMessage = options.errorMessage ?? "Too many requests";

  return (req, res, next) => {
    if (exempt.has(req.path)) {
      next();
      return;
    }
    Promise.resolve(keyFunc(req))
      .then((key) => store.hit(key, maxRequests, windowSeconds))
      .then((result) => {
        res.setHeader("X-RateLimit-Limit", String(maxRequests));
        res.setHeader("X-RateLimit-Remaining", String(Math.max(0, result.remaining)));
        if (!result.allowed) {
          if (retryAfterHeader) res.setHeader("Retry-After", String(result.retryAfter));
          res.status(429).json({
            detail: errorMessage,
            code: "TOO_MANY_REQUESTS",
            details: { retryAfterSeconds: result.retryAfter },
          });
          return;
        }
        next();
      })
      .catch(next);
  };
}
