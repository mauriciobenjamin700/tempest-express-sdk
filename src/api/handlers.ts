/**
 * Express error handling, mirroring `api.handlers`.
 *
 * Produces the canonical SDK envelope `{ detail, code, details }` for every
 * failure path: {@link AppException} subclasses, Zod validation errors (→ 422),
 * unmatched routes (→ 404) and uncaught errors (→ 500). A {@link MessageCatalog}
 * localizes `detail` from the request `Accept-Language` header. Server errors
 * are logged with the {@link HTTP_500_MARKER} flag for sink routing.
 */

import { randomUUID } from "node:crypto";
import {
  HTTP_500_MARKER,
  JSONLogger,
  type LogLevel,
  runWithRequestContext,
} from "@/core";
import { AppException, type ExceptionDetails } from "@/exceptions/base";
import { DEFAULT_LOCALE, type MessageCatalog } from "@/exceptions/i18n";
import type { ErrorRequestHandler, Express, RequestHandler } from "express";
import { ZodError } from "zod";

const logger = new JSONLogger("tempest_express_sdk.api.handlers");

/** Header carrying the per-request correlation id. */
export const REQUEST_ID_HEADER = "X-Request-ID";

/**
 * Whitelist for inbound request IDs: printable ASCII, no whitespace or control
 * characters, so a spoofed header can't inject CRLF into log lines or the
 * echoed response header. Generous enough for UUIDs, ULIDs and trace IDs.
 */
const VALID_REQUEST_ID = /^[A-Za-z0-9._\-:+/=]{1,128}$/;

/**
 * Middleware that establishes a request id and binds the request context.
 *
 * Reuses an inbound `X-Request-ID` when present **and well-formed**, otherwise
 * generates one, sets it on the response, and runs the rest of the chain inside
 * {@link runWithRequestContext} so loggers and handlers can read it.
 *
 * @returns The configured middleware.
 */
export function requestIdMiddleware(): RequestHandler {
  return (req, res, next) => {
    const inbound = req.header(REQUEST_ID_HEADER);
    const requestId = inbound && VALID_REQUEST_ID.test(inbound) ? inbound : randomUUID();
    res.setHeader(REQUEST_ID_HEADER, requestId);
    runWithRequestContext({ requestId }, () => next());
  };
}

/** Options for {@link makeAppExceptionHandler}. */
export interface AppExceptionHandlerOptions {
  /** Catalog used to localize `detail`; `null` keeps the literal message. */
  catalog?: MessageCatalog | null;
  /** Locale used when `Accept-Language` is absent or unmatched. */
  defaultLocale?: string;
  /** Level used for 5xx `AppException` records (4xx always logs at `info`). */
  serverErrorLevel?: LogLevel;
}

/** Serialize an {@link AppException} to the envelope and write the response. */
function writeAppException(
  res: Parameters<ErrorRequestHandler>[2],
  exc: AppException,
  detail: string,
): void {
  for (const [name, value] of Object.entries(exc.headers)) res.setHeader(name, value);
  res.status(exc.statusCode).json({
    detail,
    code: exc.code,
    details: exc.details,
  });
}

/**
 * Build the error middleware for {@link AppException} subclasses.
 *
 * Zod errors are coerced into a 422 envelope (`code: "VALIDATION_ERROR"`) with
 * the field issues under `details.issues`. Anything else is passed to `next`.
 *
 * @param options - Localization and logging options.
 * @returns An Express error middleware.
 */
export function makeAppExceptionHandler(
  options: AppExceptionHandlerOptions = {},
): ErrorRequestHandler {
  const {
    catalog = null,
    defaultLocale = DEFAULT_LOCALE,
    serverErrorLevel = "info",
  } = options;

  return (err, req, res, next) => {
    let exc: AppException;
    if (err instanceof AppException) {
      exc = err;
    } else if (err instanceof ZodError) {
      const details: ExceptionDetails = { issues: err.issues };
      exc = new AppException({
        message: "Validation error",
        code: "VALIDATION_ERROR",
        statusCode: 422,
        details,
      });
    } else {
      next(err);
      return;
    }

    const isServerError = exc.statusCode >= 500;
    logger.log(isServerError ? serverErrorLevel : "info", "AppException handled", {
      path: req.path,
      method: req.method,
      statusCode: exc.statusCode,
      code: exc.code,
      ...(isServerError ? { [HTTP_500_MARKER]: true, stack: exc.stack } : {}),
    });

    let detail = exc.message;
    if (catalog) {
      const locale = catalog.negotiate(req.header("accept-language"), defaultLocale);
      const localized = catalog.resolve(
        exc.messageKey ?? exc.code,
        locale,
        exc.messageParams,
      );
      if (localized !== null) detail = localized;
    }
    writeAppException(res, exc, detail);
  };
}

/** Options for {@link makeUnhandledExceptionHandler}. */
export interface UnhandledExceptionHandlerOptions {
  /** Surface the stack under `details.stack` (development only). */
  includeStack?: boolean;
  /** Level used to log the failure. */
  logLevel?: LogLevel;
}

/**
 * Build the catch-all error middleware for non-{@link AppException} errors.
 *
 * Logs the failure (flagged with {@link HTTP_500_MARKER}) and returns the
 * canonical 500 envelope. With `includeStack` the stack is added to the body —
 * never enable in production.
 *
 * @param options - Stack-exposure and logging options.
 * @returns An Express error middleware.
 */
export function makeUnhandledExceptionHandler(
  options: UnhandledExceptionHandlerOptions = {},
): ErrorRequestHandler {
  const { includeStack = false, logLevel = "error" } = options;

  return (err, req, res, _next) => {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.log(logLevel, "Unhandled exception", {
      path: req.path,
      method: req.method,
      [HTTP_500_MARKER]: true,
      stack: error.stack,
    });
    const details: ExceptionDetails = includeStack ? { stack: error.stack } : {};
    res.status(500).json({
      detail: "Internal server error",
      code: "INTERNAL_SERVER_ERROR",
      details,
    });
  };
}

/**
 * Build the fallback 404 handler for unmatched routes.
 *
 * @returns A request handler emitting the canonical 404 envelope.
 */
export function notFoundHandler(): RequestHandler {
  return (req, res) => {
    res.status(404).json({
      detail: `No route for ${req.method} ${req.path}`,
      code: "NOT_FOUND",
      details: {},
    });
  };
}

/** Options for {@link registerExceptionHandlers}. */
export interface RegisterExceptionHandlersOptions
  extends AppExceptionHandlerOptions,
    UnhandledExceptionHandlerOptions {
  /** Register the {@link notFoundHandler} for unmatched routes. Default `true`. */
  notFound?: boolean;
}

/**
 * Register the full error-handling stack on an Express app.
 *
 * Call this AFTER all routers are mounted. Order: 404 fallback (optional) →
 * {@link AppException}/Zod handler → catch-all 500 handler.
 *
 * @param app - The Express application.
 * @param options - Localization, logging and 404 options.
 */
export function registerExceptionHandlers(
  app: Express,
  options: RegisterExceptionHandlersOptions = {},
): void {
  const { notFound = true, includeStack, logLevel, ...appOptions } = options;
  if (notFound) app.use(notFoundHandler());
  app.use(makeAppExceptionHandler(appOptions));
  app.use(
    makeUnhandledExceptionHandler({
      ...(includeStack !== undefined ? { includeStack } : {}),
      ...(logLevel !== undefined ? { logLevel } : {}),
    }),
  );
}
