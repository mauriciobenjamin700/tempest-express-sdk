/** Datetime helpers, mirroring `utils.datetime`. */

/**
 * Return the current instant. JavaScript `Date` is always UTC-based internally;
 * serialize with `.toISOString()` for a UTC wire format.
 *
 * @returns The current `Date`.
 */
export function utcnow(): Date {
  return new Date();
}

/**
 * Coerce a value to a `Date`. Accepts a `Date`, an ISO string or an epoch
 * milliseconds number.
 *
 * @param value - The value to normalize.
 * @returns The corresponding `Date`.
 * @throws {Error} When the value cannot be parsed to a valid date.
 */
export function toUtc(value: Date | string | number): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("invalid date");
  return date;
}
