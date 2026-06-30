/** Dictionary helpers, mirroring `utils.dict`. */

/**
 * Filter and extend a record in a single pass: drop `exclude`d keys and merge
 * `include` on top (merged entries win).
 *
 * @param data - The source record.
 * @param exclude - Keys to drop from the output.
 * @param include - Extra entries to merge in.
 * @returns A new record with the requested mutations.
 */
export function modifyDict(
  data: Record<string, unknown>,
  exclude: string[] = [],
  include: Record<string, unknown> = {},
): Record<string, unknown> {
  const excluded = new Set(exclude);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!excluded.has(key)) result[key] = value;
  }
  return { ...result, ...include };
}
