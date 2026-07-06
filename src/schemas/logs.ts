/**
 * `logEntrySchema` — the shape of one structured log record, mirroring
 * `schemas.logs.LogEntrySchema`.
 *
 * Matches the JSON `JSONLogger` emits. It is intentionally open (`.passthrough()`)
 * so arbitrary `extra` keys (`path`, `requestId`, `http_500`, …) survive instead
 * of being dropped — useful when a logs endpoint parses and returns records.
 */

import { z } from "@/schemas/base";

/** One structured log record; extra keys pass through unchanged. */
export const logEntrySchema = z
  .object({
    timestamp: z
      .string()
      .openapi({ description: "ISO-8601 UTC timestamp of the record." }),
    level: z.string().openapi({ description: "Log level name (INFO, ERROR, …)." }),
    logger: z.string().openapi({ description: "Name of the emitting logger." }),
    message: z.string().openapi({ description: "The formatted log message." }),
    requestId: z
      .string()
      .nullable()
      .optional()
      .openapi({ description: "Correlation id, when present." }),
    stack: z
      .string()
      .nullable()
      .optional()
      .openapi({
        description: "Formatted stack trace, when the record carries an error.",
      }),
  })
  .passthrough();

/** The parsed shape of {@link logEntrySchema} (plus any extra keys). */
export type LogEntry = z.infer<typeof logEntrySchema>;
