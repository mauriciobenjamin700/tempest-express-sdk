/**
 * Column introspection for the admin panel, mirroring `admin.forms`' widget
 * derivation.
 *
 * `tempest-db-js` keeps rich runtime metadata on every column — the canonical
 * type kind, enum members, `varchar` length, the not-null/default/primary-key
 * flags and the foreign-key reference — so the admin derives its form widgets
 * and list filters from the model itself instead of asking the project to
 * restate them. Kept separate from the router so the (fiddly) type handling is
 * unit-testable in isolation.
 */

import { type Column, type ModelClass, columnsOf } from "@/db";

/** The set of form controls the admin knows how to render. */
export type AdminWidget =
  | "text"
  | "textarea"
  | "number"
  | "checkbox"
  | "datetime"
  | "date"
  | "time"
  | "select"
  | "json";

/** A `(value, label)` pair for a `select` widget. */
export interface AdminSelectOption {
  value: string;
  label: string;
}

/** The widget a column maps to, plus the attributes that render it. */
export interface WidgetSpec {
  /** The control to render. */
  widget: AdminWidget;
  /** `step` attribute for `number` widgets, or `null`. */
  step: string | null;
  /** Options for `select` widgets (empty otherwise). */
  options: AdminSelectOption[];
}

/** How a column is surfaced in the list view's filter bar. */
export type AdminFilterKind = "select" | "daterange" | "text";

/**
 * Humanize a column key into a form label (`lastLoginAt` → `Last Login At`).
 *
 * @param name - The column key.
 * @returns A title-cased label.
 */
export function humanizeField(name: string): string {
  return name
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Return every column of a model, keyed by field name in declaration order.
 *
 * @param model - The model class.
 * @returns The column map (do not mutate).
 */
export function adminColumns(model: ModelClass): Record<string, Column<unknown>> {
  return columnsOf(model);
}

/**
 * Map a column to the widget that edits it.
 *
 * `json` is matched before anything else because a JSON column carries no
 * useful scalar type, and `enum` is matched before the string kinds so its
 * members become a dropdown rather than a free-text input.
 *
 * @param column - The column to inspect.
 * @returns The widget, its `number` step (or `null`) and its `select` options.
 */
export function widgetForColumn(column: Column<unknown>): WidgetSpec {
  const { kind, meta } = column.type;
  const plain = (widget: AdminWidget): WidgetSpec => ({
    widget,
    step: null,
    options: [],
  });

  switch (kind) {
    case "json":
      return plain("json");
    case "boolean":
      return plain("checkbox");
    case "enum":
      return {
        widget: "select",
        step: null,
        options: (meta.values ?? []).map((value) => ({
          value,
          label: humanizeField(value),
        })),
      };
    case "smallint":
    case "integer":
    case "bigint":
      return { widget: "number", step: "1", options: [] };
    case "numeric":
    case "real":
    case "double":
      return { widget: "number", step: "any", options: [] };
    case "datetime":
    case "timestamp":
      return plain("datetime");
    case "date":
      return plain("date");
    case "time":
      return plain("time");
    case "text":
      return plain("textarea");
    case "varchar":
    case "char":
      return plain(meta.length !== undefined && meta.length > 255 ? "textarea" : "text");
    default:
      return plain("text");
  }
}

/**
 * Whether a column may be left blank on submit — it is nullable, carries a
 * default, or is the primary key the database fills in.
 *
 * @param column - The column to inspect.
 * @returns `true` when the field is optional.
 */
export function isColumnOptional(column: Column<unknown>): boolean {
  return !column.flags.notNull || column.flags.hasDefault || column.flags.primaryKey;
}

/**
 * Map a column to the filter control the list view shows for it.
 *
 * Booleans and enums become dropdowns, date-like columns become a from/to pair
 * of date inputs, and anything else falls back to an equality text input.
 *
 * @param column - The column to inspect.
 * @returns The filter kind and, for `select`, its options.
 */
export function filterForColumn(column: Column<unknown>): {
  kind: AdminFilterKind;
  options: AdminSelectOption[];
} {
  const { kind, meta } = column.type;
  if (kind === "boolean") {
    return {
      kind: "select",
      options: [
        { value: "true", label: "Yes" },
        { value: "false", label: "No" },
      ],
    };
  }
  if (kind === "enum") {
    return {
      kind: "select",
      options: (meta.values ?? []).map((value) => ({
        value,
        label: humanizeField(value),
      })),
    };
  }
  if (kind === "date" || kind === "datetime" || kind === "timestamp") {
    return { kind: "daterange", options: [] };
  }
  return { kind: "text", options: [] };
}

/**
 * Return the table a column points at, when it carries a foreign key.
 *
 * @param column - The column to inspect.
 * @returns The referenced table name, or `null` for a plain column.
 */
export function foreignKeyTable(column: Column<unknown>): string | null {
  return column.reference?.table ?? null;
}

/**
 * Whether a column holds free text a `LIKE '%…%'` search can match.
 *
 * @param column - The column to inspect.
 * @returns `true` for `varchar` / `text` / `char` columns.
 */
export function isSearchableColumn(column: Column<unknown>): boolean {
  const { kind } = column.type;
  return kind === "varchar" || kind === "text" || kind === "char";
}
