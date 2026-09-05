/**
 * Related child models surfaced on a parent's detail view — Django's
 * `TabularInline` analog, mirroring `admin.config.Inline`.
 *
 * An inline lists the child rows that point back at the record being viewed,
 * so an order shows its line items and a user shows their API keys without a
 * round trip to another screen. A read-only inline renders a compact table with
 * links into the child's own admin; an `editable` one renders the same rows as
 * an in-place formset — one input row per child plus a blank row to add
 * another — that posts back to the parent.
 */

import type { ModelClass } from "@/db";

/** Options accepted by {@link adminInline}. */
export interface AdminInlineOptions {
  /** The child model class. */
  model: ModelClass;
  /** The child column referencing the parent. */
  fkField: string;
  /**
   * Columns to show. Falls back to the child admin's `listDisplay`, then to
   * every column the child declares.
   */
  listDisplay?: readonly string[];
  /** Section heading. Defaults to the child's plural display name. */
  label?: string;
  /** Render the rows as an editable in-place formset. Default `false`. */
  editable?: boolean;
  /**
   * Add a per-row delete checkbox. Editable inlines only, and still gated on
   * the child admin's `canDelete`. Default `false`.
   */
  canDelete?: boolean;
}

/** A configured inline. */
export interface AdminInline {
  /** The child model class. */
  model: ModelClass;
  /** The child admin slug — the child model's table name. */
  slug: string;
  /** The child column referencing the parent. */
  fkField: string;
  /** Columns to show, or `null` to fall back to the child admin's. */
  listDisplay: string[] | null;
  /** Section heading, or `null` to derive one. */
  label: string | null;
  /** Whether the rows render as an editable formset. */
  editable: boolean;
  /** Whether an editable row offers a delete checkbox. */
  canDelete: boolean;
}

/**
 * Describe a related child model to surface on a parent's detail view.
 *
 * @param options - Child model, the column pointing back at the parent, and
 *   the presentation flags.
 * @returns The inline descriptor to pass to `AdminModel({ inlines: [...] })`.
 * @throws Error When the child model declares no table name.
 */
export function adminInline(options: AdminInlineOptions): AdminInline {
  const slug = options.model.tablename;
  if (typeof slug !== "string" || slug === "") {
    throw new Error("adminInline requires a concrete model with a tablename");
  }
  return {
    model: options.model,
    slug,
    fkField: options.fkField,
    listDisplay: options.listDisplay === undefined ? null : [...options.listDisplay],
    label: options.label ?? null,
    editable: options.editable ?? false,
    canDelete: options.canDelete ?? false,
  };
}
