/**
 * Concrete HTTP exception subclasses, mirroring the FastAPI SDK hierarchy.
 *
 * Each exists primarily for `instanceof` matching and to carry a sane default
 * status/code/message. Throw them directly or subclass further for domain
 * errors (e.g. `class UserNotFound extends NotFoundException {}`).
 */

import {
  AppException,
  type AppExceptionOptions,
  type ExceptionDetails,
} from "@/exceptions/base";

/** 409 — a write would violate a uniqueness/integrity rule. */
export class ConflictException extends AppException {
  static override statusCode = 409;
  static override message = "Resource conflict";
  static override code = "CONFLICT";
}

/** 404 — a single resource could not be located. Never for collections. */
export class NotFoundException extends AppException {
  static override statusCode = 404;
  static override message = "Resource not found";
  static override code = "NOT_FOUND";
}

/** 401 — the caller is not authenticated. */
export class UnauthorizedException extends AppException {
  static override statusCode = 401;
  static override message = "Unauthorized";
  static override code = "UNAUTHORIZED";
}

/** 403 — the caller is authenticated but lacks permission. */
export class ForbiddenException extends AppException {
  static override statusCode = 403;
  static override message = "Forbidden";
  static override code = "FORBIDDEN";
}

/** 422 — input failed a business rule beyond schema validation. */
export class ValidationException extends AppException {
  static override statusCode = 422;
  static override message = "Validation error";
  static override code = "VALIDATION_ERROR";
}

/** 401 — a JWT failed signature or claim validation. */
export class InvalidTokenException extends UnauthorizedException {
  static override message = "Invalid token";
  static override code = "INVALID_TOKEN";
}

/** 401 — a JWT's `exp` claim is in the past. */
export class ExpiredTokenException extends UnauthorizedException {
  static override message = "Token expired";
  static override code = "TOKEN_EXPIRED";
}

/** Options for {@link TooManyRequestsException}, adding a cooldown. */
export interface TooManyRequestsOptions extends AppExceptionOptions {
  /** Cooldown in seconds; sets `Retry-After` and `details.retryAfterSeconds`. */
  retryAfterSeconds?: number;
}

/** 429 — the client exceeded a rate limit or attempt budget. */
export class TooManyRequestsException extends AppException {
  static override statusCode = 429;
  static override message = "Too many requests";
  static override code = "TOO_MANY_REQUESTS";

  /**
   * @param options - Standard options plus an optional `retryAfterSeconds`
   *   that populates both the `Retry-After` header and `details`.
   */
  constructor(options: TooManyRequestsOptions = {}) {
    const { retryAfterSeconds, details, headers, ...rest } = options;
    const mergedDetails: ExceptionDetails = { ...details };
    const mergedHeaders: Record<string, string> = { ...headers };
    if (retryAfterSeconds !== undefined) {
      mergedDetails.retryAfterSeconds ??= retryAfterSeconds;
      mergedHeaders["Retry-After"] ??= String(retryAfterSeconds);
    }
    super({ ...rest, details: mergedDetails, headers: mergedHeaders });
  }
}
