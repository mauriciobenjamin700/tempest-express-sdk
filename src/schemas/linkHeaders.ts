/**
 * RFC-5988 pagination `Link` header builder, mirroring `schemas.link_headers`.
 *
 * Emits the `first` / `prev` / `next` / `last` rels GitHub-style clients expect.
 * `prev`/`next` are omitted at the ends. Assign the result to
 * `res.setHeader("Link", value)`.
 */

/** Options for {@link buildPaginationLinkHeader}. */
export interface PaginationLinkOptions {
  /** Absolute or relative collection URL; existing query params are preserved. */
  baseUrl: string;
  /** Current page (1-based). */
  page: number;
  /** Page size. */
  pageSize: number;
  /** Total number of pages. */
  pages: number;
  /** Extra query params to preserve on every link (filters, sort). */
  extraParams?: Record<string, string>;
  /** Query param name for the page index. Default `"page"`. */
  pageParam?: string;
  /** Query param name for the page size. Default `"pageSize"`. */
  sizeParam?: string;
}

/**
 * Build a `Link` header value for an offset-paginated collection.
 *
 * @param options - Base URL, current page, page size, total pages and param names.
 * @returns The `Link` header value, or `""` when there's nothing to link (single page).
 */
export function buildPaginationLinkHeader(options: PaginationLinkOptions): string {
  const { baseUrl, page, pageSize, pages } = options;
  if (pages <= 0) return "";

  const pageParam = options.pageParam ?? "page";
  const sizeParam = options.sizeParam ?? "pageSize";

  // Split any existing query off the base so we can rebuild it deterministically.
  const [path, existingQuery = ""] = baseUrl.split("?", 2);
  const params = new URLSearchParams(existingQuery);
  for (const [key, value] of Object.entries(options.extraParams ?? {})) {
    if (!params.has(key)) params.set(key, value);
  }

  const urlFor = (target: number): string => {
    const q = new URLSearchParams(params);
    q.set(pageParam, String(target));
    q.set(sizeParam, String(pageSize));
    return `${path}?${q.toString()}`;
  };

  const parts: string[] = [
    `<${urlFor(1)}>; rel="first"`,
    `<${urlFor(pages)}>; rel="last"`,
  ];
  if (page > 1) parts.push(`<${urlFor(page - 1)}>; rel="prev"`);
  if (page < pages) parts.push(`<${urlFor(page + 1)}>; rel="next"`);
  return parts.join(", ");
}
