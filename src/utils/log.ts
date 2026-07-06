/**
 * File-based log routing, mirroring `utils.log` / the `core.logging` file sink.
 *
 * `configureFileLogging` installs a {@link LogSink} that appends every record
 * emitted by any {@link JSONLogger} to a per-level file (`info.log`,
 * `error.log`, …) and, additionally, routes records flagged as captured HTTP
 * 500s to a dedicated `500.log` — so uncaught-error triage has its own stream.
 */

import { type WriteStream, createWriteStream } from "node:fs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { HTTP_500_MARKER, type LogLevel, type LogSink, addLogSink } from "@/core";

/** Per-level log file names. */
export const LEVEL_LOG_FILES: Record<LogLevel, string> = {
  debug: "debug.log",
  info: "info.log",
  warning: "warning.log",
  error: "error.log",
};

/** The dedicated file for captured HTTP 500 records. */
export const HTTP_500_LOG_FILE = "500.log";

/** A handle to detach file logging and close the open streams. */
export interface FileLoggingHandle {
  /** Remove the sink and close every open file stream. */
  close(): void;
}

/** Options for {@link configureFileLogging}. */
export interface FileLoggingOptions {
  /** Directory the log files are written under (created if missing). */
  dir: string;
}

/**
 * Route every emitted log record into per-level files + `500.log`.
 *
 * @param options - The log directory.
 * @returns A handle whose `close()` detaches the sink and closes the streams.
 *
 * @example
 * ```ts
 * const logs = configureFileLogging({ dir: "logs" });
 * // ... on shutdown:
 * logs.close();
 * ```
 */
export function configureFileLogging(options: FileLoggingOptions): FileLoggingHandle {
  const { dir } = options;
  mkdirSync(dir, { recursive: true });

  const streams = new Map<string, WriteStream>();
  const streamFor = (filename: string): WriteStream => {
    let stream = streams.get(filename);
    if (!stream) {
      stream = createWriteStream(join(dir, filename), { flags: "a" });
      streams.set(filename, stream);
    }
    return stream;
  };

  const sink: LogSink = (level, record) => {
    const line = `${JSON.stringify(record)}\n`;
    streamFor(LEVEL_LOG_FILES[level]).write(line);
    if (record[HTTP_500_MARKER]) streamFor(HTTP_500_LOG_FILE).write(line);
  };

  const detach = addLogSink(sink);
  return {
    close() {
      detach();
      for (const stream of streams.values()) stream.end();
      streams.clear();
    },
  };
}
