/**
 * Delta-sync pagination schemas, mirroring `schemas.pagination` (Sync* half).
 *
 * For offline-first clients that pull "everything changed since my last sync".
 * The client sends the `serverTime` from the previous page back as `since`;
 * using the **server** clock as the watermark avoids clock-skew gaps.
 */

import { z } from "@/schemas/base";

/**
 * Filter schema for a delta-sync pull. Extend with `.extend` to add domain
 * filters; the sync keys stay reserved.
 */
export const syncFilterSchema = z.object({
  since: z.coerce
    .date()
    .optional()
    .openapi({
      description: "High-water mark; only rows changed after this are returned.",
    }),
  cursor: z
    .string()
    .optional()
    .openapi({
      description: "Opaque cursor from the previous page; omit for the first.",
    }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(100)
    .openapi({ description: "Maximum number of items to return." }),
  includeDeleted: z.coerce
    .boolean()
    .default(false)
    .openapi({ description: "Whether soft-deleted rows are included in the delta." }),
});

/** The parsed shape of {@link syncFilterSchema}. */
export type SyncFilter = z.infer<typeof syncFilterSchema>;

/**
 * Build the delta-sync response envelope for a given item schema. Persist
 * `serverTime` on the client and send it back as the next `since`.
 *
 * @param item - The zod schema for a single item.
 * @returns A zod object `{ items, nextCursor, hasMore, limit, serverTime }`.
 */
export function syncPaginationSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item).openapi({ description: "Changed rows in this page." }),
    nextCursor: z
      .string()
      .nullable()
      .openapi({ description: "Cursor for the next page, or null when exhausted." }),
    hasMore: z.boolean().openapi({ description: "Whether another page is available." }),
    limit: z.number().int().min(1).openapi({ description: "The page size used." }),
    serverTime: z.coerce
      .date()
      .openapi({
        description: "Server instant to persist as the next `since` watermark.",
      }),
  });
}
