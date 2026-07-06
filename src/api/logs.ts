/**
 * `makeLogsRouter` — a paginated read endpoint over the file logs, mirroring
 * `api.routers.logs`.
 *
 * Reads the per-level / `500.log` files written by `configureFileLogging`,
 * parses each JSON line, and serves the newest-first, offset-paginated. Guard it
 * (this exposes operational data) with any middleware you pass in `guards`.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { HTTP_500_LOG_FILE, LEVEL_LOG_FILES } from "@/utils/log";
import { type RequestHandler, Router } from "express";

/** Selector for which log file(s) to read. */
export type LogSource = "all" | "debug" | "info" | "warning" | "error" | "500";

/** Options for {@link makeLogsRouter}. */
export interface LogsRouterOptions {
  /** Directory holding the log files (same one passed to `configureFileLogging`). */
  dir: string;
  /** Endpoint path. Default `"/logs"`. */
  path?: string;
  /** Middlewares run before the handler (e.g. a token guard). */
  guards?: RequestHandler[];
}

function filesFor(dir: string, source: LogSource): string[] {
  if (source === "500") return [join(dir, HTTP_500_LOG_FILE)];
  if (source === "all") return Object.values(LEVEL_LOG_FILES).map((f) => join(dir, f));
  return [join(dir, LEVEL_LOG_FILES[source])];
}

async function readEntries(files: string[]): Promise<Record<string, unknown>[]> {
  const entries: Record<string, unknown>[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = await readFile(file, "utf8");
    } catch {
      continue; // missing file — skip
    }
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line) as Record<string, unknown>);
      } catch {
        // Skip a single corrupt line rather than failing the endpoint.
      }
    }
  }
  return entries;
}

/**
 * Build a router serving `GET <path>` with query params `source`, `page` and
 * `pageSize`. Returns `{ items, total, page, pageSize, pages }`, newest first.
 *
 * @param options - Log directory, path and optional guards.
 * @returns An Express router.
 */
export function makeLogsRouter(options: LogsRouterOptions): Router {
  const router = Router();
  const path = options.path ?? "/logs";
  const guards = options.guards ?? [];

  const handler: RequestHandler = (req, res, next) => {
    const source = (req.query.source as LogSource) ?? "all";
    const validSources: LogSource[] = ["all", "debug", "info", "warning", "error", "500"];
    if (!validSources.includes(source)) {
      res
        .status(422)
        .json({ detail: "Invalid log source", code: "VALIDATION_ERROR", details: {} });
      return;
    }
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize) || 50));

    readEntries(filesFor(options.dir, source))
      .then((entries) => {
        // Newest first when a timestamp is present; else keep file order reversed.
        entries.reverse();
        const total = entries.length;
        const start = (page - 1) * pageSize;
        res.json({
          items: entries.slice(start, start + pageSize),
          total,
          page,
          pageSize,
          pages: Math.ceil(total / pageSize),
        });
      })
      .catch(next);
  };

  router.get(path, ...guards, handler);
  return router;
}
