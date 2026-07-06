/**
 * Slow-query logging, mirroring `db.slow_query`.
 *
 * `tempest-db-js` exposes an `onQuery` hook with the SQL + params but **no
 * duration**, so timing has to happen at the driver boundary. This wraps an
 * `AsyncDriver` so every statement is timed and any that meets or exceeds a
 * threshold is logged — including statements run inside a reserved transaction.
 *
 * ```ts
 * import { AsyncEngine, NodeSqliteDriver } from "tempest-express-sdk";
 * import { wrapWithSlowQueryLog } from "tempest-express-sdk";
 *
 * const sync = NodeSqliteDriver.open("app.db");
 * const timed = wrapWithSlowQueryLog(
 *   { execute: (s, p) => Promise.resolve(sync.execute(s, p)), close: async () => sync.close() },
 *   { thresholdMs: 200 },
 * );
 * const engine = new AsyncEngine(timed, "sqlite");
 * ```
 */

import { JSONLogger, type LogLevel } from "@/core";
import type { AsyncDriver } from "tempest-db-js";

/** Options for {@link wrapWithSlowQueryLog}. */
export interface SlowQueryOptions {
  /** Statements at or above this many ms are logged. Default `500`. */
  thresholdMs?: number;
  /** Level for the slow-query lines. Default `"warning"`. */
  level?: LogLevel;
  /** Include the bound params in the log line. **Dev only** — may carry PII. */
  logParameters?: boolean;
  /** Logger name. Default `tempest_express_sdk.db.slow_query`. */
  loggerName?: string;
}

/**
 * Wrap an `AsyncDriver` so slow statements are logged. The returned driver is a
 * drop-in for {@link AsyncEngine}; `iterate` and `reserve` (transactions) are
 * preserved and their statements timed too.
 *
 * @param driver - The driver to wrap.
 * @param options - Threshold, level and whether to log params.
 * @returns A timing driver delegating to `driver`.
 */
export function wrapWithSlowQueryLog(
  driver: AsyncDriver,
  options: SlowQueryOptions = {},
): AsyncDriver {
  const thresholdMs = options.thresholdMs ?? 500;
  const level = options.level ?? "warning";
  const logParameters = options.logParameters ?? false;
  const logger = new JSONLogger(
    options.loggerName ?? "tempest_express_sdk.db.slow_query",
  );

  // Wrap a given `execute` with timing so both the pooled driver and any
  // reserved (transaction-pinned) connection log slow statements correctly.
  const timed = (exec: AsyncDriver["execute"]): AsyncDriver["execute"] => {
    return async (sql, params) => {
      const start = process.hrtime.bigint();
      try {
        return await exec(sql, params);
      } finally {
        const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
        if (durationMs >= thresholdMs) {
          logger.log(level, "slow query", {
            sql,
            durationMs: Math.round(durationMs * 1000) / 1000,
            ...(logParameters ? { params } : {}),
          });
        }
      }
    };
  };

  const wrapped: AsyncDriver = {
    execute: timed(driver.execute.bind(driver)),
    close: () => driver.close(),
  };
  if (driver.iterate) {
    wrapped.iterate = (sql, params) => driver.iterate?.(sql, params) as never;
  }
  if (driver.reserve) {
    wrapped.reserve = async () => {
      const reserved = await driver.reserve?.();
      if (!reserved) throw new Error("driver.reserve() returned nothing");
      return {
        execute: timed(reserved.execute.bind(reserved)),
        close: () => reserved.close(),
        release: () => reserved.release(),
        ...(reserved.iterate
          ? { iterate: (sql, params) => reserved.iterate?.(sql, params) as never }
          : {}),
      };
    };
  }
  return wrapped;
}
