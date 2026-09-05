/**
 * Form building and submission parsing for the admin CRUD views, mirroring
 * `admin.forms`.
 *
 * One direction turns a model's columns into typed widget descriptors the
 * templates render; the other reads a posted `application/x-www-form-urlencoded`
 * body back into coerced values ready for the repository. Both live here, away
 * from the router, so the fiddly per-type handling is unit-testable on its own.
 */

import {
  type AdminSelectOption,
  type AdminWidget,
  adminColumns,
  foreignKeyTable,
  humanizeField,
  isColumnOptional,
  widgetForColumn,
} from "@/admin/columns";
import type { AdminModel } from "@/admin/config";
import type { Column } from "@/db";

/** A single rendered form control. */
export interface AdminFormField {
  /** Column key, used as the form field name. */
  name: string;
  /** Human-readable label. */
  label: string;
  /** The control to render. */
  widget: AdminWidget;
  /** Pre-filled value, already stringified for the control. */
  value: string;
  /** Whether the field must be filled in. */
  required: boolean;
  /** Checkbox state (`checkbox` widget only). */
  checked: boolean;
  /** `step` attribute for `number` widgets. */
  step: string | null;
  /** `(value, label)` pairs for `select` widgets. */
  options: AdminSelectOption[];
  /** Per-field validation error, or `null`. */
  error: string | null;
  /** For an `autocomplete` widget, the JSON search endpoint backing the input. */
  autocompleteUrl: string | null;
  /** For an `autocomplete` widget, the label of the currently selected row. */
  displayLabel: string;
}

/** The outcome of parsing a submitted create/edit form. */
export interface ParsedAdminForm {
  /** Coerced column values, ready to hand to the repository. */
  data: Record<string, unknown>;
  /** Per-field error messages, keyed by column. Empty when the form is valid. */
  errors: Record<string, string>;
}

/** Options for {@link parseFormBody}. */
export interface ParseFormBodyOptions {
  /**
   * Read upload columns as plain text instead of skipping them.
   *
   * The create/edit form skips them because the router writes the storage key
   * after saving the file. A CSV import has no file to save — it carries the
   * key already — so it reads them like any other string column.
   */
  uploadsAsText?: boolean;
  /**
   * Restrict parsing to these columns. An inline formset uses it to keep the
   * foreign key pointing at the parent out of the operator's reach.
   */
  only?: readonly string[];
}

/** Options for {@link buildFormFields}. */
export interface BuildFormFieldsOptions {
  /** Current values, keyed by column — a row on edit, a re-submission on error. */
  values?: Record<string, unknown>;
  /** Per-field errors to surface, keyed by column. */
  errors?: Record<string, string>;
  /**
   * Options for foreign-key columns whose target model is registered, keyed by
   * column. A field listed here renders as a `<select>` of related rows instead
   * of a raw identity text input.
   */
  foreignKeyOptions?: Record<string, AdminSelectOption[]>;
  /**
   * Search endpoints for foreign-key columns listed in `autocompleteFields`,
   * keyed by column. A field listed here renders as a typed search box.
   */
  autocompleteUrls?: Record<string, string>;
  /** Current labels for autocomplete fields, keyed by column. */
  autocompleteLabels?: Record<string, string>;
}

/**
 * Render a stored value into the string a control pre-fills with.
 *
 * @param widget - The control the value is rendered for.
 * @param value - The stored value.
 * @returns The control's `value` text (empty for `null`/`undefined`).
 */
export function formatFieldValue(widget: AdminWidget, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (widget === "json") {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  }
  if (value instanceof Date) {
    const iso = value.toISOString();
    if (widget === "date") return iso.slice(0, 10);
    if (widget === "time") return iso.slice(11, 19);
    return iso.slice(0, 16);
  }
  if (widget === "datetime" || widget === "date") {
    const parsed = new Date(String(value));
    if (!Number.isNaN(parsed.getTime())) {
      const iso = parsed.toISOString();
      return widget === "date" ? iso.slice(0, 10) : iso.slice(0, 16);
    }
  }
  return String(value);
}

/**
 * Return the literal default a column carries, for pre-filling a blank form.
 *
 * Only literal defaults are usable: an expression default (`now()`,
 * `uuidv4()`) is evaluated by the database, has no client-side value, and
 * belongs to a column the generic form never edits anyway.
 *
 * @param column - The column to inspect.
 * @returns The default value, or `undefined` when there is none to show.
 */
function literalDefault(column: Column<unknown>): unknown {
  const fallback = column.defaultValue;
  if (fallback === null || fallback.kind !== "literal") return undefined;
  return fallback.value;
}

/**
 * Build the controls a create/edit form renders.
 *
 * A field with no current value falls back to its column's literal default, so
 * a blank create form arrives pre-filled the way the database would fill it.
 * Without that, submitting the form untouched would write `false` over a
 * `default(true)` flag — the panel would silently deactivate every row it
 * creates.
 *
 * @param admin - The model configuration.
 * @param options - Current values and per-field errors.
 * @returns One {@link AdminFormField} per editable column, in declaration order.
 */
export function buildFormFields(
  admin: AdminModel,
  options: BuildFormFieldsOptions = {},
): AdminFormField[] {
  const columns = adminColumns(admin.model);
  const values = options.values ?? {};
  const errors = options.errors ?? {};
  const foreignKeys = options.foreignKeyOptions ?? {};
  const autocompleteUrls = options.autocompleteUrls ?? {};
  const autocompleteLabels = options.autocompleteLabels ?? {};
  const uploads = new Set(admin.uploadFields);

  return admin.editableFieldNames().flatMap((name) => {
    const column = columns[name];
    if (column === undefined) return [];
    const related = foreignKeys[name];
    const autocompleteUrl = autocompleteUrls[name];
    const spec = uploads.has(name)
      ? { widget: "file" as const, step: null, options: [] }
      : autocompleteUrl !== undefined
        ? { widget: "autocomplete" as const, step: null, options: [] }
        : related === undefined
          ? widgetForColumn(column)
          : { widget: "select" as const, step: null, options: related };
    const raw = name in values ? values[name] : literalDefault(column);
    return [
      {
        name,
        label: humanizeField(name),
        widget: spec.widget,
        value: spec.widget === "checkbox" ? "" : formatFieldValue(spec.widget, raw),
        required: !isColumnOptional(column),
        checked: spec.widget === "checkbox" && toBoolean(raw),
        step: spec.step,
        options: spec.options,
        error: errors[name] ?? null,
        autocompleteUrl: autocompleteUrl ?? null,
        displayLabel: autocompleteLabels[name] ?? "",
      },
    ];
  });
}

/**
 * Interpret a stored or submitted value as a checkbox state.
 *
 * @param value - The value to read.
 * @returns `true` for `true`, `1`, `"true"`, `"on"`, `"yes"` and `"1"`.
 */
function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return false;
  return ["true", "on", "yes", "1"].includes(value.trim().toLowerCase());
}

/**
 * Coerce one submitted string into the value its column stores.
 *
 * @param column - The target column.
 * @param widget - The control the value came from.
 * @param raw - The submitted text.
 * @returns The coerced value.
 * @throws Error With a user-facing message when the text is not valid for the column.
 */
function coerceValue(column: Column<unknown>, widget: AdminWidget, raw: string): unknown {
  const { kind, meta } = column.type;
  switch (widget) {
    case "number": {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) throw new Error("Enter a valid number.");
      if (kind === "bigint") return BigInt(raw);
      if (kind === "smallint" || kind === "integer") {
        if (!Number.isInteger(parsed)) throw new Error("Enter a whole number.");
        return parsed;
      }
      if (kind === "numeric") return raw;
      return parsed;
    }
    case "datetime":
    case "date": {
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) throw new Error("Enter a valid date.");
      return parsed;
    }
    case "json":
      try {
        return JSON.parse(raw);
      } catch {
        throw new Error("Enter valid JSON.");
      }
    case "select": {
      const allowed = kind === "enum" ? (meta.values ?? []) : [];
      if (allowed.length > 0 && !allowed.includes(raw)) {
        throw new Error(`Choose one of: ${allowed.join(", ")}.`);
      }
      return raw;
    }
    default:
      return raw;
  }
}

/**
 * Read a submitted create/edit form back into coerced column values.
 *
 * A checkbox that is absent from the body is `false` (that is how browsers
 * submit an unchecked box), and an empty text field on an optional column
 * becomes `null` rather than an empty string, so a cleared field really clears
 * the column.
 *
 * @param admin - The model configuration.
 * @param body - The parsed request body.
 * @returns The coerced values plus any per-field errors.
 */
export function parseFormBody(
  admin: AdminModel,
  body: Record<string, unknown>,
  options: ParseFormBodyOptions = {},
): ParsedAdminForm {
  const columns = adminColumns(admin.model);
  const data: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  const uploads =
    options.uploadsAsText === true ? new Set<string>() : new Set(admin.uploadFields);

  const only = options.only === undefined ? null : new Set(options.only);

  for (const name of admin.editableFieldNames()) {
    if (only !== null && !only.has(name)) continue;
    const column = columns[name];
    if (column === undefined) continue;
    if (uploads.has(name)) continue;
    const { widget } = widgetForColumn(column);

    if (widget === "checkbox") {
      data[name] = toBoolean(body[name]);
      continue;
    }

    const submitted = body[name];
    const raw = typeof submitted === "string" ? submitted.trim() : "";
    if (raw === "") {
      if (!isColumnOptional(column)) {
        errors[name] = "This field is required.";
        continue;
      }
      if (column.flags.hasDefault && !(name in body)) continue;
      data[name] = null;
      continue;
    }

    try {
      data[name] = coerceValue(column, widget, raw);
    } catch (error) {
      errors[name] = error instanceof Error ? error.message : "Invalid value.";
    }
  }

  return { data, errors };
}

/**
 * Render a stored value for a read-only list or detail cell.
 *
 * @param value - The stored value.
 * @returns A display string (empty for `null`/`undefined`).
 */
export function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().replace("T", " ").slice(0, 19);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Return the editable foreign-key columns of an admin, as `field → table`.
 *
 * @param admin - The model configuration.
 * @returns One entry per editable column that references another table.
 */
export function foreignKeyFields(admin: AdminModel): Record<string, string> {
  const columns = adminColumns(admin.model);
  const out: Record<string, string> = {};
  for (const name of admin.editableFieldNames()) {
    const column = columns[name];
    if (column === undefined) continue;
    const table = foreignKeyTable(column);
    if (table !== null) out[name] = table;
  }
  return out;
}

/**
 * Build a human label for a referenced row — the analog of Django's `__str__`.
 *
 * Prefers the referenced admin's first search field, then a conventional
 * display attribute, then the row's identity, so a dropdown of related rows
 * reads as names rather than as a column of UUIDs.
 *
 * @param admin - The **referenced** model's configuration.
 * @param row - The referenced row.
 * @returns A label for the option.
 */
export function foreignKeyLabel(admin: AdminModel, row: Record<string, unknown>): string {
  for (const field of admin.searchFields) {
    const value = row[field];
    if (typeof value === "string" && value !== "") return value;
  }
  for (const field of ["name", "title", "email", "label", "reference"]) {
    const value = row[field];
    if (typeof value === "string" && value !== "") return value;
  }
  return String(row[admin.identityField] ?? "");
}
