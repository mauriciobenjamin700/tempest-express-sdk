/**
 * Zod foundation shared by every DTO, mirroring `schemas.base.BaseSchema`.
 *
 * Pydantic uses class inheritance for shared config; Zod composes instead. This
 * module re-exports a `z` already augmented with `.openapi()` (so every schema
 * can carry OpenAPI metadata) and a {@link toDict} helper matching
 * `BaseSchema.to_dict` (drop nullish, exclude keys, merge extras).
 *
 * **The `z` this module exports is the augmented instance.** `extendZodWithOpenApi`
 * patches `ZodType.prototype`, and zod v4 copies prototype members into each
 * instance at construction — so only schemas built *after* this module has been
 * evaluated carry `.openapi()`. Importing `z` from here rather than from `zod`
 * makes that ordering automatic. It is not a requirement:
 * `createOpenApiRegistry()` re-tags an un-patched schema on registration, so a
 * project importing `z` straight from `zod` works too.
 */

import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

// Augment the shared `z` instance with `.openapi(...)`. Idempotent — calling it
// more than once across modules is safe.
extendZodWithOpenApi(z);

export { z };

/** Options for {@link toDict}. */
export interface ToDictOptions {
  /** Field names to drop from the output. */
  exclude?: string[];
  /** Extra entries merged on top (override existing keys). */
  include?: Record<string, unknown>;
}

/**
 * Serialize a validated object to a plain record, dropping `null`/`undefined`,
 * removing `exclude`d keys and merging `include` on top.
 *
 * @param data - The source object (typically a parsed schema).
 * @param options - Keys to exclude and entries to merge in.
 * @returns The cleaned record.
 */
export function toDict(
  data: Record<string, unknown>,
  options: ToDictOptions = {},
): Record<string, unknown> {
  const exclude = new Set(options.exclude ?? []);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (exclude.has(key)) continue;
    if (value === null || value === undefined) continue;
    out[key] = value;
  }
  return { ...out, ...(options.include ?? {}) };
}

/**
 * Response schema fields every ORM record carries (`id`, `isActive`,
 * `createdAt`, `updatedAt`). Mirrors `BaseResponseSchema`. Extend it with
 * `baseResponseSchema.extend({ ... })` to build concrete `*ResponseSchema`s.
 */
export const baseResponseSchema = z.object({
  id: z.uuid().openapi({ description: "The unique identifier of the record." }),
  isActive: z
    .boolean()
    .openapi({ description: "Whether the record is active (soft-delete flag)." }),
  createdAt: z.coerce
    .date()
    .openapi({ description: "The creation timestamp of the record (UTC)." }),
  updatedAt: z.coerce
    .date()
    .openapi({ description: "The last update timestamp of the record (UTC)." }),
});

/** The inferred TS type of a {@link baseResponseSchema} payload. */
export type BaseResponse = z.infer<typeof baseResponseSchema>;
