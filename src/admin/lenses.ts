/**
 * Named, saved list-view presets — Laravel Nova's "lenses", mirroring
 * `admin.config.Lens`.
 *
 * A lens bundles a set of filters and an optional ordering under a label. On
 * the list view lenses render as tabs; clicking one applies its filters (ANDed
 * with whatever the operator typed) and its ordering. A "support triage" lens
 * pinning `{ status: "open", priority: { gte: 3 } }` sorted oldest-first gets
 * an operator to the working set in one click instead of re-entering filters
 * every morning.
 */

import type { WhereInput } from "@/db";

/** Options accepted by {@link adminLens}. */
export interface AdminLensOptions {
  /** Lens identifier; its slug is the `?lens=` value. */
  name: string;
  /** Conditions merged into the query, in repository `where` shape. */
  filters?: WhereInput<Record<string, unknown>>;
  /** Ordering column; prefix with `-` for descending. */
  orderBy?: string;
  /** Tab label. Defaults to `name`. */
  label?: string;
}

/** A registered lens. */
export interface AdminLens {
  /** Lens identifier. */
  name: string;
  /** URL slug — the `?lens=` value. */
  slug: string;
  /** Tab label. */
  label: string;
  /** Conditions merged into the query. */
  filters: WhereInput<Record<string, unknown>>;
  /** Ordering column, or `null`. `-column` means descending. */
  orderBy: string | null;
}

/**
 * Slugify a lens name into its `?lens=` value.
 *
 * @param name - The lens name.
 * @returns A lowercase, hyphenated slug.
 */
function slugify(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "lens"
  );
}

/**
 * Describe a saved list-view preset.
 *
 * @param options - Name, filters, ordering and label.
 * @returns The lens descriptor to pass to `AdminModel({ lenses: [...] })`.
 */
export function adminLens(options: AdminLensOptions): AdminLens {
  return {
    name: options.name,
    slug: slugify(options.name),
    label: options.label ?? options.name,
    filters: options.filters ?? {},
    orderBy: options.orderBy ?? null,
  };
}
