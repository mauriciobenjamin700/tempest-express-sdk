/**
 * `idempotencyMiddleware` — cache responses by `Idempotency-Key`, mirroring
 * `api.middlewares.idempotency`.
 *
 * A client retrying a mutating request with the same `Idempotency-Key` gets the
 * original response back instead of a duplicate side effect (a second charge, a
 * second order). Only mutating verbs are eligible; the key is scoped per
 * `(method, path, key)` so the same key on different endpoints never collides.
 */

import type { RequestHandler, Response } from "express";

/** The canonical header (Stripe / AWS / GitHub all use it). */
export const IDEMPOTENCY_HEADER = "Idempotency-Key";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** A serialized response stored under an idempotency key. */
export interface CachedResponse {
  statusCode: number;
  headers: Array<[string, string]>;
  body: string;
  contentType: string | null;
}

/** Backend every idempotency cache implements. */
export interface IdempotencyStore {
  /** Return the cached response for `key`, or `null` when missing/expired. */
  get(key: string): Promise<CachedResponse | null>;
  /** Store `response` under `key` with a TTL. */
  set(key: string, response: CachedResponse, ttlSeconds: number): Promise<void>;
}

/** In-process {@link IdempotencyStore} with lazy TTL eviction (single-replica). */
export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly store = new Map<
    string,
    { expiresAt: number; response: CachedResponse }
  >();

  async get(key: string): Promise<CachedResponse | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.response;
  }

  async set(key: string, response: CachedResponse, ttlSeconds: number): Promise<void> {
    this.store.set(key, { expiresAt: Date.now() + ttlSeconds * 1000, response });
  }
}

/** Minimal async Redis surface used by {@link RedisIdempotencyStore}. */
export interface IdempotencyRedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { EX: number }): Promise<unknown>;
}

/** {@link IdempotencyStore} backed by an async Redis client (multi-replica). */
export class RedisIdempotencyStore implements IdempotencyStore {
  private readonly prefix: string;

  constructor(
    private readonly client: IdempotencyRedisLike,
    options: { prefix?: string } = {},
  ) {
    this.prefix = options.prefix ?? "idem:";
  }

  async get(key: string): Promise<CachedResponse | null> {
    const raw = await this.client.get(this.prefix + key);
    return raw === null ? null : (JSON.parse(raw) as CachedResponse);
  }

  async set(key: string, response: CachedResponse, ttlSeconds: number): Promise<void> {
    await this.client.set(this.prefix + key, JSON.stringify(response), {
      EX: ttlSeconds,
    });
  }
}

/** Options for {@link idempotencyMiddleware}. */
export interface IdempotencyOptions {
  /** The cache backend (memory or Redis). */
  store: IdempotencyStore;
  /** Time-to-live for a cached response, in seconds. Default 24h. */
  ttlSeconds?: number;
  /** Header carrying the key. Default `Idempotency-Key`. */
  headerName?: string;
}

/**
 * Build an idempotency middleware. On a cache hit it replays the stored
 * response; on a miss it captures the response, stores it, and forwards.
 *
 * @param options - Store, TTL and header name.
 * @returns An Express middleware.
 */
export function idempotencyMiddleware(options: IdempotencyOptions): RequestHandler {
  const { store } = options;
  const ttlSeconds = options.ttlSeconds ?? 24 * 3600;
  const headerName = options.headerName ?? IDEMPOTENCY_HEADER;

  return (req, res, next) => {
    if (!MUTATING_METHODS.has(req.method)) {
      next();
      return;
    }
    const rawKey = req.header(headerName);
    if (!rawKey) {
      next();
      return;
    }
    const scoped = `${req.method}:${req.path}:${rawKey}`;

    store
      .get(scoped)
      .then((cached) => {
        if (cached) {
          for (const [name, value] of cached.headers) res.setHeader(name, value);
          res.setHeader("Idempotent-Replayed", "true");
          if (cached.contentType) res.type(cached.contentType);
          res.status(cached.statusCode).send(cached.body);
          return;
        }
        captureAndForward(res, scoped, store, ttlSeconds);
        next();
      })
      .catch(next);
  };
}

/** Wrap `res.send` to capture the first body, then persist on `finish`. */
function captureAndForward(
  res: Response,
  key: string,
  store: IdempotencyStore,
  ttlSeconds: number,
): void {
  const originalSend = res.send.bind(res);
  let capturedBody = "";
  res.send = ((body?: unknown): Response => {
    if (typeof body === "string") capturedBody = body;
    else if (body !== undefined) capturedBody = JSON.stringify(body);
    return originalSend(body as never);
  }) as Response["send"];

  res.on("finish", () => {
    // Only cache successful, deterministic outcomes (2xx). Errors should be
    // retryable, not frozen.
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    const contentType = res.getHeader("content-type");
    void store
      .set(
        key,
        {
          statusCode: res.statusCode,
          headers: [],
          body: capturedBody,
          contentType: typeof contentType === "string" ? contentType : null,
        },
        ttlSeconds,
      )
      .catch(() => {
        // Best-effort cache write; a store outage must not fail the response.
      });
  });
}
