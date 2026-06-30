/**
 * Base application exception.
 *
 * Mirrors `tempest_fastapi_sdk.exceptions.base.AppException`: a single base any
 * layer can throw, carrying an HTTP status, a stable machine-readable `code`,
 * free-form `details`, optional response `headers`, and localization hooks
 * (`messageKey` / `messageParams`). The exception handler
 * ({@link registerExceptionHandlers}) serializes it to the canonical envelope:
 *
 * ```json
 * { "detail": "<message>", "code": "<code>", "details": { } }
 * ```
 *
 * Concrete projects either throw a domain subclass (for `instanceof` matching)
 * or the base directly, overriding fields via the constructor options.
 */

/** Free-form structured context attached to the response payload. */
export type ExceptionDetails = Record<string, unknown>;

/** Constructor options for {@link AppException} and subclasses. */
export interface AppExceptionOptions {
  /** Override the default message; used verbatim as `detail` absent a catalog. */
  message?: string;
  /** Override the default machine-readable code on this instance only. */
  code?: string;
  /** Override the default HTTP status code on this instance only. */
  statusCode?: number;
  /** Structured context merged into the JSON response `details`. */
  details?: ExceptionDetails;
  /** Extra HTTP response headers. */
  headers?: Record<string, string>;
  /** Catalog key used to localize `detail`; falls back to `code`. */
  messageKey?: string;
  /** Values interpolated into the localized message template. */
  messageParams?: Record<string, unknown>;
}

export class AppException extends Error {
  /** Default HTTP status code for the class. */
  static statusCode = 500;
  /** Default human-readable message for the class. */
  static message = "Internal server error";
  /** Default machine-readable code for the class. */
  static code = "INTERNAL_SERVER_ERROR";
  /** Default catalog key for the class (falls back to `code`). */
  static messageKey: string | null = null;

  readonly statusCode: number;
  readonly code: string;
  readonly details: ExceptionDetails;
  readonly headers: Record<string, string>;
  readonly messageKey: string | null;
  readonly messageParams: Record<string, unknown>;

  /**
   * @param options - Per-instance overrides; omitted fields fall back to the
   *   static class defaults.
   */
  constructor(options: AppExceptionOptions = {}) {
    const cls = new.target as typeof AppException;
    super(options.message ?? cls.message);
    this.name = cls.name;
    this.statusCode = options.statusCode ?? cls.statusCode;
    this.code = options.code ?? cls.code;
    this.details = options.details ?? {};
    this.headers = options.headers ?? {};
    this.messageKey = options.messageKey ?? cls.messageKey;
    this.messageParams = options.messageParams ?? {};
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
