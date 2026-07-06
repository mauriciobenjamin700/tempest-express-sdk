/**
 * Structured JSON logging, mirroring `tempest_fastapi_sdk.core.logging`.
 *
 * Emits one JSON object per line to stdout (or stderr for `error`), enriched
 * with the active request id. Server errors (`500`) carry the
 * {@link HTTP_500_MARKER} flag so an external log router can split them into a
 * dedicated `500.log` sink.
 */

import { getRequestId } from "@/core/context";

/** Flag key marking a record as a captured HTTP 500 for sink routing. */
export const HTTP_500_MARKER = "http_500";

/** Severity levels, ordered from least to most severe. */
export type LogLevel = "debug" | "info" | "warning" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warning: 30,
  error: 40,
};

/** Free-form structured context merged into the emitted record. */
export type LogExtra = Record<string, unknown>;

/** A sink receiving every emitted record (for file routing, shipping, …). */
export type LogSink = (level: LogLevel, record: Record<string, unknown>) => void;

const sinks: LogSink[] = [];

/**
 * Register a sink invoked for every record every {@link JSONLogger} emits (in
 * addition to the stdout/stderr line). Used by `configureFileLogging` to route
 * records into per-level + `500.log` files.
 *
 * @param sink - The sink callback. Errors thrown by it are swallowed.
 * @returns A function that removes the sink.
 */
export function addLogSink(sink: LogSink): () => void {
  sinks.push(sink);
  return () => {
    const index = sinks.indexOf(sink);
    if (index !== -1) sinks.splice(index, 1);
  };
}

/** A minimal structured logger writing one JSON line per record. */
export class JSONLogger {
  /**
   * @param name - Logger name embedded in every record.
   * @param level - Minimum level to emit; quieter records are dropped.
   */
  constructor(
    private readonly name: string,
    private readonly level: LogLevel = "info",
  ) {}

  /** Log a debug-level message. */
  debug(message: string, extra?: LogExtra): void {
    this.log("debug", message, extra);
  }

  /** Log an info-level message. */
  info(message: string, extra?: LogExtra): void {
    this.log("info", message, extra);
  }

  /** Log a warning-level message. */
  warning(message: string, extra?: LogExtra): void {
    this.log("warning", message, extra);
  }

  /** Log an error-level message. */
  error(message: string, extra?: LogExtra): void {
    this.log("error", message, extra);
  }

  /**
   * Emit a record at `level` when it clears the configured threshold.
   *
   * @param level - The record severity.
   * @param message - The human-readable message.
   * @param extra - Structured context merged into the record.
   */
  log(level: LogLevel, message: string, extra?: LogExtra): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return;
    const record: Record<string, unknown> = {
      level,
      logger: this.name,
      message,
      requestId: getRequestId(),
      ...extra,
    };
    const line = JSON.stringify(record);
    if (level === "error") process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
    for (const sink of sinks) {
      try {
        sink(level, record);
      } catch {
        // A sink must never break logging.
      }
    }
  }
}

/**
 * Build a {@link JSONLogger}.
 *
 * @param name - Logger name.
 * @param level - Minimum level to emit (defaults to `info`).
 * @returns A configured logger.
 */
export function configureLogging(name: string, level: LogLevel = "info"): JSONLogger {
  return new JSONLogger(name, level);
}
