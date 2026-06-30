/**
 * Lightweight message localization, mirroring `exceptions.i18n`.
 *
 * A {@link MessageCatalog} maps `code` → `{ locale: template }`. The exception
 * handler negotiates a locale from the request `Accept-Language` header and
 * resolves the exception's `messageKey` (or `code`) into a localized `detail`,
 * interpolating `messageParams` via `{name}` placeholders. A missing
 * translation falls back to the literal message, so partial catalogs are safe.
 */

/** Default locale used when negotiation finds no match. */
export const DEFAULT_LOCALE = "en";

/** A `code` → (`locale` → template) translation table. */
export type CatalogData = Record<string, Record<string, string>>;

/**
 * Parse an `Accept-Language` header into locales ordered by descending `q`.
 *
 * @param header - The raw header value, or `null`/`undefined`.
 * @returns Lower-cased language tags, highest quality first.
 */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith("q="))
        ?.slice(2);
      return { tag: (tag ?? "").trim().toLowerCase(), q: q ? Number(q) : 1 };
    })
    .filter((entry) => entry.tag.length > 0 && !Number.isNaN(entry.q))
    .sort((a, b) => b.q - a.q)
    .map((entry) => entry.tag);
}

/** Interpolate `{name}` placeholders in `template` with `params`. */
function interpolate(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}

/** A localized message catalog keyed by error `code`. */
export class MessageCatalog {
  /**
   * @param data - The translation table.
   * @param defaultLocale - Locale used when negotiation matches nothing.
   */
  constructor(
    private readonly data: CatalogData = {},
    private readonly defaultLocale: string = DEFAULT_LOCALE,
  ) {}

  /**
   * Pick the best locale for an `Accept-Language` header.
   *
   * Matches exact tags first, then the primary subtag (`pt-br` → `pt`),
   * falling back to `defaultLocale`.
   *
   * @param header - The raw `Accept-Language` value.
   * @param defaultLocale - Override the catalog's default for this call.
   * @returns The negotiated locale tag.
   */
  negotiate(header: string | null | undefined, defaultLocale?: string): string {
    const fallback = defaultLocale ?? this.defaultLocale;
    const available = new Set<string>();
    for (const byLocale of Object.values(this.data)) {
      for (const locale of Object.keys(byLocale)) available.add(locale.toLowerCase());
    }
    for (const tag of parseAcceptLanguage(header)) {
      if (available.has(tag)) return tag;
      const primary = tag.split("-")[0];
      if (primary && available.has(primary)) return primary;
    }
    return fallback;
  }

  /**
   * Resolve a localized message for `code` in `locale`.
   *
   * @param code - The catalog key (an exception's `messageKey` or `code`).
   * @param locale - The negotiated locale.
   * @param params - Values interpolated into the template.
   * @returns The localized string, or `null` when no template exists.
   */
  resolve(
    code: string,
    locale: string,
    params: Record<string, unknown> = {},
  ): string | null {
    const byLocale = this.data[code];
    if (!byLocale) return null;
    const template = byLocale[locale] ?? byLocale[this.defaultLocale];
    return template ? interpolate(template, params) : null;
  }
}

/** Build an empty default catalog. */
export function defaultMessageCatalog(): MessageCatalog {
  return new MessageCatalog();
}
