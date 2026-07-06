/**
 * Composable settings fragments covering common service dependencies,
 * mirroring `settings.mixins`.
 *
 * Each fragment is a plain object of zod fields keyed by the **environment
 * variable name** (matched case-sensitively, no prefix), with the same defaults
 * as the FastAPI SDK. Compose the ones a service needs onto
 * {@link baseAppSettingsShape} and parse with {@link loadSettings}:
 *
 * ```ts
 * import { baseAppSettingsShape, jwtSettingsShape, loadSettings, z } from "tempest-express-sdk";
 *
 * const settings = loadSettings(
 *   z.object({ ...baseAppSettingsShape, ...jwtSettingsShape }),
 * );
 * settings.JWT_SECRET; // typed
 * ```
 *
 * Nothing here reads `process.env` on its own — `loadSettings` does, so the
 * fragments stay pure and testable.
 */

import { z } from "@/schemas/base";

/**
 * Parse an environment string into a boolean. Unlike `z.coerce.boolean()`
 * (which treats every non-empty string — including `"false"` — as `true`), this
 * reads the usual truthy tokens and treats everything else as `false`.
 *
 * @param defaultValue - The value when the variable is absent.
 * @returns A zod schema coercing `"true"`/`"1"`/`"yes"`/`"on"` to `true`.
 */
export function envBoolean(defaultValue: boolean) {
  return z
    .union([z.boolean(), z.string()])
    .default(defaultValue)
    .transform((value) => {
      if (typeof value === "boolean") return value;
      return ["true", "1", "yes", "on"].includes(value.trim().toLowerCase());
    });
}

/**
 * Parse a comma-separated environment string into a trimmed, non-empty list.
 *
 * @param defaultValue - The default CSV string when the variable is absent.
 * @returns A zod schema producing `string[]`.
 */
export function envList(defaultValue = "") {
  return z
    .string()
    .default(defaultValue)
    .transform((value) =>
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    );
}

/** Structured logging configuration. */
export const logSettingsShape = {
  LOG_LEVEL: z.enum(["DEBUG", "INFO", "WARNING", "ERROR"]).default("INFO"),
  LOG_JSON: envBoolean(true),
  LOG_DIR: z.string().default("logs"),
} as const;

/** Redis connection settings (cache / sessions / SSE broker). */
export const redisSettingsShape = {
  REDIS_URL: z.string().default("redis://localhost:6379/0"),
} as const;

/** RabbitMQ connection settings (queue broker). */
export const rabbitmqSettingsShape = {
  RABBITMQ_URL: z.string().default("amqp://guest:guest@localhost:5672/"),
  RABBITMQ_PREFETCH_COUNT: z.coerce.number().int().min(1).default(10),
} as const;

/** JWT signing/verification settings. */
export const jwtSettingsShape = {
  JWT_SECRET: z.string().default("change-me-change-me-change-me-32"),
  JWT_ALGORITHM: z.string().default("HS256"),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(1).default(3600),
  JWT_REFRESH_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(1)
    .default(86400 * 7),
  JWT_ISSUER: z.string().optional(),
} as const;

/** Opaque shared-secret token settings (`X-Token` guards). */
export const tokenSettingsShape = {
  TOKEN_SECRET: z.string().default(""),
} as const;

/** SMTP email transport settings. */
export const emailSettingsShape = {
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USERNAME: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM_ADDR: z.string().default("noreply@example.com"),
  SMTP_USE_TLS: envBoolean(true),
  SMTP_USE_SSL: envBoolean(false),
  SMTP_TIMEOUT_SECONDS: z.coerce.number().min(0).default(30),
} as const;

/** Local upload storage settings. */
export const uploadSettingsShape = {
  UPLOAD_DIR: z.string().default("./var/uploads"),
  UPLOAD_MAX_SIZE_BYTES: z.coerce
    .number()
    .int()
    .min(0)
    .default(10 * 1024 * 1024),
  UPLOAD_ALLOWED_EXTENSIONS: envList(),
  UPLOAD_ALLOWED_MIMETYPES: envList(),
} as const;

/** MinIO / S3 object-storage settings. */
export const minioSettingsShape = {
  MINIO_ENDPOINT: z.string().default("localhost:9000"),
  MINIO_ACCESS_KEY: z.string().default("minioadmin"),
  MINIO_SECRET_KEY: z.string().default("minioadmin"),
  MINIO_SECURE: envBoolean(false),
  MINIO_REGION: z.string().default("us-east-1"),
  MINIO_DEFAULT_BUCKET: z.string().default("uploads"),
  MINIO_PUBLIC_ENDPOINT: z.string().optional(),
  MINIO_PUBLIC_SECURE: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) =>
      value === undefined
        ? undefined
        : typeof value === "boolean"
          ? value
          : ["true", "1", "yes", "on"].includes(value.trim().toLowerCase()),
    ),
} as const;

/** Web Push (VAPID) settings. */
export const webPushSettingsShape = {
  VAPID_PUBLIC_KEY: z.string().default(""),
  VAPID_PRIVATE_KEY: z.string().default(""),
  VAPID_SUBJECT: z.string().default("mailto:admin@example.com"),
  WEBPUSH_DEFAULT_TTL_SECONDS: z.coerce.number().int().min(0).default(86400),
} as const;

/** Server-side session settings (cookie + TTL). */
export const sessionSettingsShape = {
  SESSION_TTL_SECONDS: z.coerce.number().int().min(1).default(86400),
  SESSION_SLIDING: envBoolean(true),
  SESSION_COOKIE_NAME: z.string().default("tempest_session"),
  SESSION_COOKIE_DOMAIN: z.string().optional(),
  SESSION_COOKIE_PATH: z.string().default("/"),
  SESSION_COOKIE_SECURE: envBoolean(true),
  SESSION_COOKIE_HTTPONLY: envBoolean(true),
  SESSION_COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),
  SESSION_ROTATE_ON_LOGIN: envBoolean(true),
} as const;

/** WebSocket hub tuning. */
export const webSocketSettingsShape = {
  WS_HEARTBEAT_SECONDS: z.coerce.number().int().min(1).default(30),
  WS_HEARTBEAT_TIMEOUT_SECONDS: z.coerce.number().int().min(1).default(60),
  WS_MAX_CONNECTIONS_PER_USER: z.coerce.number().int().min(1).default(5),
  WS_MAX_MESSAGE_BYTES: z.coerce
    .number()
    .int()
    .min(1)
    .default(64 * 1024),
} as const;

/**
 * Authentication flow settings (signup/activation/reset/MFA + token delivery).
 * The FastAPI SDK's HTML-template fields (SSR activation/reset pages) are
 * omitted — this SDK ships the JSON auth API and defers rendering to a
 * decoupled frontend.
 */
export const authSettingsShape = {
  AUTH_AUTO_ACTIVATE: envBoolean(false),
  AUTH_RETURN_TOKEN_IN_RESPONSE: envBoolean(false),
  AUTH_ACTIVATION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(1)
    .default(86400 * 7),
  AUTH_PASSWORD_RESET_TTL_SECONDS: z.coerce.number().int().min(1).default(3600),
  AUTH_ACTIVATION_URL_TEMPLATE: z
    .string()
    .default("http://localhost:3000/activate?token={token}"),
  AUTH_PASSWORD_RESET_URL_TEMPLATE: z
    .string()
    .default("http://localhost:3000/reset-password?token={token}"),
  AUTH_PASSWORD_MIN_LENGTH: z.coerce.number().int().min(1).default(12),
  AUTH_PASSWORD_REQUIRE_COMPLEXITY: envBoolean(false),
  AUTH_DEFAULT_LOCALE: z.string().default("pt-BR"),
  AUTH_MFA_ENABLED: envBoolean(false),
  AUTH_MFA_ISSUER: z.string().default("Tempest"),
  AUTH_MFA_RECOVERY_CODES_COUNT: z.coerce.number().int().min(0).default(10),
  AUTH_MFA_TOKEN_TTL_SECONDS: z.coerce.number().int().min(1).default(300),
  AUTH_MFA_VERIFY_WINDOW: z.coerce.number().int().min(0).default(1),
  AUTH_TOKEN_DELIVERY: z.enum(["bearer", "cookie", "both"]).default("bearer"),
  AUTH_COOKIE_SECURE: envBoolean(true),
  AUTH_COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),
  AUTH_COOKIE_DOMAIN: z.string().optional(),
  AUTH_ACCESS_COOKIE_NAME: z.string().default("access_token"),
  AUTH_REFRESH_COOKIE_NAME: z.string().default("refresh_token"),
} as const;
