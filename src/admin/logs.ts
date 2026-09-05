/**
 * The admin panel's log reader and exporters, mirroring `admin.router`'s logs
 * page and `admin` log export helpers.
 *
 * Reads the structured JSON records `configureFileLogging` writes, filters them
 * the way the page does, and renders the same selection as markdown or JSON so
 * an export never disagrees with the page it was taken from.
 *
 * The page is **opt-in**: the payload carries tracebacks and request metadata,
 * so it only exists when a project passes a log directory to `makeAdminRouter`.
 */

/** A parsed log record, as the panel reads it. */
export interface AdminLogEntry {
  /** Severity, when the record carries one. */
  level: string;
  /** The logger name. */
  logger: string;
  /** The message text. */
  message: string;
  /** ISO timestamp, when present. */
  timestamp: string;
  /** The stack trace, when the record carries one. */
  stack: string | null;
  /** Correlation fields worth showing next to the message. */
  context: Record<string, unknown>;
  /** Everything the record carried, verbatim. */
  raw: Record<string, unknown>;
}

/** Fields lifted out of a record into its own column rather than the context blob. */
const LIFTED = new Set(["level", "logger", "message", "timestamp", "stack"]);

/**
 * Normalize a raw JSON log line into the shape the page renders.
 *
 * @param raw - The parsed record.
 * @returns The normalized entry.
 */
export function toLogEntry(raw: Record<string, unknown>): AdminLogEntry {
  const context: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (LIFTED.has(key) || value === null || value === undefined) continue;
    context[key] = value;
  }
  return {
    level: typeof raw.level === "string" ? raw.level : "info",
    logger: typeof raw.logger === "string" ? raw.logger : "",
    message: typeof raw.message === "string" ? raw.message : "",
    timestamp: typeof raw.timestamp === "string" ? raw.timestamp : "",
    stack: typeof raw.stack === "string" ? raw.stack : null,
    context,
    raw,
  };
}

/**
 * Filter entries by a free-text term.
 *
 * Matches the message, the logger and the stack, because an operator hunting a
 * 500 usually has a fragment of the traceback, not of the message.
 *
 * @param entries - The entries to filter.
 * @param term - The search term; empty returns everything.
 * @returns The matching entries.
 */
export function filterLogEntries(
  entries: AdminLogEntry[],
  term: string,
): AdminLogEntry[] {
  const needle = term.trim().toLowerCase();
  if (needle === "") return entries;
  return entries.filter((entry) =>
    `${entry.message} ${entry.logger} ${entry.stack ?? ""}`
      .toLowerCase()
      .includes(needle),
  );
}

/**
 * Render entries as markdown, ready to paste into an issue.
 *
 * Each stack goes in a fenced block so it survives the paste with its
 * indentation intact, and the header declares the source, the filter and — when
 * the cap truncated the selection — how many records matched in total, so a
 * partial export never reads as a complete one.
 *
 * @param entries - The entries to render, newest first.
 * @param options - The source and search term the page had applied, and the
 *   total number of matches before the cap.
 * @returns The markdown document.
 */
export function renderLogEntriesMarkdown(
  entries: AdminLogEntry[],
  options: { source: string; query: string; total: number },
): string {
  const lines = [
    "# Application logs",
    "",
    `- **Source:** \`${options.source}\``,
    `- **Search:** ${options.query === "" ? "_none_" : `\`${options.query}\``}`,
    `- **Exported:** ${entries.length} of ${options.total} matching record(s)`,
    "",
  ];
  if (entries.length < options.total) {
    lines.push(
      `> Truncated: the export is capped, so ${options.total - entries.length} older matching record(s) are not included.`,
      "",
    );
  }

  for (const entry of entries) {
    lines.push(
      `## ${entry.level.toUpperCase()} — ${entry.message || "(no message)"}`,
      "",
      `- **When:** ${entry.timestamp || "unknown"}`,
      `- **Logger:** ${entry.logger || "unknown"}`,
    );
    for (const [key, value] of Object.entries(entry.context)) {
      lines.push(
        `- **${key}:** ${typeof value === "string" ? value : JSON.stringify(value)}`,
      );
    }
    lines.push("");
    if (entry.stack !== null) {
      lines.push("```text", entry.stack, "```", "");
    }
  }
  return lines.join("\n");
}

/**
 * Render entries as JSON, verbatim.
 *
 * @param entries - The entries to render, newest first.
 * @returns The JSON document, carrying every field the application logged.
 */
export function renderLogEntriesJson(entries: AdminLogEntry[]): string {
  return JSON.stringify(
    entries.map((entry) => entry.raw),
    null,
    2,
  );
}
