/**
 * `requestTracingMiddleware` — structured per-request access logging, mirroring
 * the request-tracing concern of the FastAPI SDK.
 *
 * Logs one JSON line per request with method, path, status, duration and the
 * request id (from the request-id context), so every request is traceable in a
 * log aggregator. It is the lightweight, dependency-free counterpart to full
 * OpenTelemetry tracing — the request id correlates logs across services.
 */

import { JSONLogger, type LogLevel, getRequestId } from "@/core";
import type { RequestHandler } from "express";

/** Options for {@link requestTracingMiddleware}. */
export interface RequestTracingOptions {
  /** Logger name. Default `tempest_express_sdk.api.tracing`. */
  loggerName?: string;
  /** Log level for completed requests. Default `"info"`. */
  level?: LogLevel;
  /** Exact paths to skip (e.g. health probes). */
  exemptPaths?: string[];
}

/**
 * Build an access-logging middleware. Records the request on completion with
 * its duration in milliseconds.
 *
 * @param options - Logger name, level and exempt paths.
 * @returns An Express middleware.
 */
export function requestTracingMiddleware(
  options: RequestTracingOptions = {},
): RequestHandler {
  const logger = new JSONLogger(options.loggerName ?? "tempest_express_sdk.api.tracing");
  const level = options.level ?? "info";
  const exempt = new Set(options.exemptPaths ?? []);

  return (req, res, next) => {
    if (exempt.has(req.path)) {
      next();
      return;
    }
    const start = process.hrtime.bigint();
    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      logger.log(level, "request", {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Math.round(durationMs * 1000) / 1000,
        requestId: getRequestId(),
      });
    });
    next();
  };
}
