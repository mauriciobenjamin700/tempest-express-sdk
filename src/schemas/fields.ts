/**
 * Ready-made, validated Zod field types, mirroring `utils.fields`.
 *
 * Reusable building blocks for DTOs so you don't re-derive the same constraint
 * everywhere: money in cents, a price string, a percentage, a latitude, a slug,
 * a hex color. Compose them into schemas with `z.object({ price: priceField })`.
 */

import { z } from "@/schemas/base";

// --- Integers ---------------------------------------------------------------

/** A strictly positive integer (`> 0`). */
export const positiveIntField = z.number().int().positive();
/** A non-negative integer (`>= 0`). */
export const nonNegativeIntField = z.number().int().min(0);
/** A monetary amount in the smallest unit (cents), `>= 0`. Avoids float drift. */
export const centsField = z.number().int().min(0);
/** A TCP port (`1..65535`). */
export const portField = z.number().int().min(1).max(65535);
/** A 0–5 star rating. */
export const ratingField = z.number().int().min(0).max(5);

// --- Floats -----------------------------------------------------------------

/** A strictly positive float (`> 0`). */
export const positiveFloatField = z.number().positive();
/** A non-negative float (`>= 0`). */
export const nonNegativeFloatField = z.number().min(0);
/** A percentage (`0..100`). */
export const percentField = z.number().min(0).max(100);
/** A ratio (`0..1`). */
export const ratioField = z.number().min(0).max(1);
/** A WGS-84 latitude (`-90..90`). */
export const latitudeField = z.number().min(-90).max(90);
/** A WGS-84 longitude (`-180..180`). */
export const longitudeField = z.number().min(-180).max(180);

// --- Strings ----------------------------------------------------------------

/** A non-empty string; whitespace is trimmed before the length check. */
export const nonEmptyStrField = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().min(1));

/** A URL slug: lowercase alphanumerics separated by single hyphens. */
export const slugField = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
  message: "Must be a lowercase hyphen-separated slug.",
});

/** A hex color: `#rgb` or `#rrggbb`. */
export const hexColorField = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, {
  message: "Must be a #rgb or #rrggbb hex color.",
});

/**
 * A money amount as an exact decimal **string** with up to two decimal places
 * (e.g. `"19.90"`). Mirrors `PriceField` — `tempest-db-js` `numeric` columns map
 * to strings, so money stays exact instead of drifting through a float.
 */
export const priceField = z
  .string()
  .regex(/^\d+(?:\.\d{1,2})?$/, {
    message: 'Must be a decimal money string, e.g. "19.90".',
  });
