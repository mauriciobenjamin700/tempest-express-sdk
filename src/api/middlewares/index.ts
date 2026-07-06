/** HTTP hardening middlewares, mirroring `api.middlewares`. */

export {
  type BodySizeLimitOptions,
  bodySizeLimitMiddleware,
} from "@/api/middlewares/bodySize";
export {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  type CsrfOptions,
  csrfMiddleware,
  generateCsrfToken,
} from "@/api/middlewares/csrf";
export {
  GracefulShutdown,
  type GracefulShutdownOptions,
} from "@/api/middlewares/graceful";
export {
  type CachedResponse,
  IDEMPOTENCY_HEADER,
  type IdempotencyOptions,
  type IdempotencyRedisLike,
  type IdempotencyStore,
  MemoryIdempotencyStore,
  RedisIdempotencyStore,
  idempotencyMiddleware,
} from "@/api/middlewares/idempotency";
export {
  HttpMetrics,
  prometheusMiddleware,
} from "@/api/middlewares/prometheus";
export {
  type JwtDecoderLike,
  type RateLimitKeyFunc,
  type RateLimitOptions,
  type RateLimitRedisLike,
  type RateLimitResult,
  type RateLimitStore,
  MemoryRateLimitStore,
  RedisRateLimitStore,
  keyByHeader,
  keyByIp,
  keyByJwtClaim,
  keyByJwtSubject,
  rateLimitMiddleware,
} from "@/api/middlewares/rateLimit";
export {
  type RequestTracingOptions,
  requestTracingMiddleware,
} from "@/api/middlewares/tracing";
