/**
 * Pagination request/response primitives, mirroring `schemas.pagination`.
 *
 * Offset pagination ({@link paginationFilterSchema} / {@link paginationSchema})
 * and cursor pagination ({@link cursorPaginationFilterSchema} /
 * {@link cursorPaginationSchema}). Field names match the `tempest-db-js`
 * `BaseRepository.paginate` arguments so a parsed filter forwards through with
 * no renaming.
 */

import { type ToDictOptions, toDict, z } from "@/schemas/base";

/**
 * Filter schema for offset-paginated list endpoints. Subclass via `.extend`
 * to add domain filters; {@link getConditions} strips the pagination keys.
 */
export const paginationFilterSchema = z.object({
  page: z.coerce
    .number()
    .int()
    .min(1)
    .default(1)
    .openapi({ description: "The page number to retrieve (1-indexed)." }),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .default(20)
    .openapi({ description: "The number of items per page." }),
  orderBy: z
    .string()
    .optional()
    .openapi({ description: "Column to order by; defaults to repository default." }),
  ascending: z.coerce
    .boolean()
    .default(true)
    .openapi({ description: "Whether to order results ascending." }),
});

/** The parsed shape of {@link paginationFilterSchema}. */
export type PaginationFilter = z.infer<typeof paginationFilterSchema>;

const PAGINATION_KEYS = ["page", "pageSize", "orderBy", "ascending"];

/**
 * Strip pagination/sort keys from a parsed filter, leaving only domain filters.
 *
 * @param filter - The parsed filter object (may carry extra domain fields).
 * @param options - Extra exclude/include passed through to {@link toDict}.
 * @returns The domain-level filter conditions.
 */
export function getConditions(
  filter: Record<string, unknown>,
  options: ToDictOptions = {},
): Record<string, unknown> {
  return toDict(filter, {
    ...options,
    exclude: [...PAGINATION_KEYS, ...(options.exclude ?? [])],
  });
}

/**
 * The pagination/sort keyword arguments to forward to `BaseRepository.paginate`.
 *
 * @param filter - The parsed pagination filter.
 * @returns `{ page, pageSize, orderBy, ascending }`.
 */
export function getPaginationConditions(filter: PaginationFilter): {
  page: number;
  pageSize: number;
  orderBy?: string;
  ascending: boolean;
} {
  return {
    page: filter.page,
    pageSize: filter.pageSize,
    ...(filter.orderBy !== undefined ? { orderBy: filter.orderBy } : {}),
    ascending: filter.ascending,
  };
}

/**
 * Build the offset-pagination response envelope for a given item schema.
 *
 * @param item - The zod schema for a single item.
 * @returns A zod object schema `{ items, total, page, pageSize, pages }`.
 */
export function paginationSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item).openapi({ description: "The items on the current page." }),
    total: z
      .number()
      .int()
      .min(0)
      .openapi({ description: "Total items across all pages." }),
    page: z.number().int().min(1).openapi({ description: "Current page (1-indexed)." }),
    pageSize: z.number().int().min(1).openapi({ description: "Items per page." }),
    pages: z.number().int().min(0).openapi({ description: "Total number of pages." }),
  });
}

/** Filter schema for cursor-paginated endpoints. */
export const cursorPaginationFilterSchema = z.object({
  cursor: z
    .string()
    .optional()
    .openapi({ description: "Opaque cursor; omit for the first page." }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(500)
    .default(20)
    .openapi({ description: "Maximum number of items to return." }),
  orderBy: z.string().default("createdAt").openapi({ description: "Column to sort by." }),
  ascending: z.coerce
    .boolean()
    .default(false)
    .openapi({ description: "Whether to sort ascending (default newest first)." }),
});

/** The parsed shape of {@link cursorPaginationFilterSchema}. */
export type CursorPaginationFilter = z.infer<typeof cursorPaginationFilterSchema>;

/**
 * Build the cursor-pagination response envelope for a given item schema.
 *
 * @param item - The zod schema for a single item.
 * @returns A zod object schema `{ items, nextCursor, hasMore, limit }`.
 */
export function cursorPaginationSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item).openapi({ description: "The items on the current page." }),
    nextCursor: z
      .string()
      .nullable()
      .openapi({ description: "Cursor for the next page, or null when exhausted." }),
    hasMore: z.boolean().openapi({ description: "Whether another page is available." }),
    limit: z.number().int().min(1).openapi({ description: "The page size used." }),
  });
}

/**
 * Serialize a cursor payload to an opaque URL-safe base64 string (no padding).
 *
 * @param payload - The cursor state, e.g. `{ id, value }`.
 * @returns The encoded cursor.
 */
export function encodeCursor(payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload);
  return Buffer.from(json, "utf8").toString("base64url");
}

/**
 * Decode a cursor produced by {@link encodeCursor}.
 *
 * @param cursor - The opaque cursor string.
 * @returns The decoded payload.
 * @throws {Error} When the cursor is not valid base64 or not a JSON object.
 */
export function decodeCursor(cursor: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch (cause) {
    throw new Error("Invalid cursor", { cause });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Invalid cursor payload");
  }
  return parsed as Record<string, unknown>;
}
