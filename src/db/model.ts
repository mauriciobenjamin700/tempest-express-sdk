/**
 * Canonical base ORM model + opt-in column mixins, mirroring `db.model` /
 * `db.mixins`.
 *
 * `tempest-db-js` models are declarative classes whose fields are runtime
 * column builders. {@link BaseModel} gives every model the four columns the SDK
 * conventions require — `id` (UUID primary key), `isActive` (soft-delete flag),
 * `createdAt` and `updatedAt` (DB-managed timestamps) — so a concrete model
 * only declares its own domain columns plus a `tablename`.
 *
 * TypeScript has no multiple inheritance, so the "mixins" ship as reusable
 * column-builder factories ({@link deletedAtColumn} etc.) you assign as fields,
 * rather than as base classes.
 */

import { Model, column, sql } from "tempest-db-js";

/** Convert `CamelCase` to `snake_case` (e.g. `OrderItem` → `order_item`). */
function toSnakeCase(name: string): string {
  return name.replace(/(?<!^)(?=[A-Z])/g, "_").toLowerCase();
}

/**
 * Derive a conventional table name from a model class name: the trailing
 * `Model` suffix is stripped and the rest snake-cased (`UserModel` → `user`).
 *
 * @param className - The model class name.
 * @returns The derived table name.
 */
export function tableNameFor(className: string): string {
  return toSnakeCase(className.replace(/Model$/, ""));
}

/**
 * Abstract base for every model. Concrete models extend it, set a static
 * `tablename`, and declare their own columns:
 *
 * ```ts
 * class UserModel extends BaseModel {
 *   static tablename = tableNameFor("UserModel"); // "user"
 *   email = column.varchar(320).notNull();
 *   name = column.text().notNull();
 * }
 * ```
 */
export abstract class BaseModel extends Model {
  /** Primary key — a UUID v4 generated on insert. */
  id = column.uuid().primaryKey().default(sql.uuidv4());
  /** Soft-delete flag; `true` means the record is active. */
  isActive = column.boolean().notNull().default(true);
  /** Creation timestamp, set by the database on insert. */
  createdAt = column.datetime().notNull().default(sql.now());
  /** Last-update timestamp, refreshed by the database on every update. */
  updatedAt = column.datetime().notNull().default(sql.now()).onUpdate(sql.now());
}

/**
 * Soft-delete timestamp column (`deleted_at`). `null` while the row is alive;
 * set when soft-deleted. Pairs with {@link BaseModel.isActive}.
 *
 * @returns A nullable datetime column builder, defaulting to `null`.
 */
export function deletedAtColumn() {
  return column.datetime();
}

/**
 * `created_by` audit column: UUID of the user that created the row.
 *
 * @returns A nullable UUID column builder.
 */
export function createdByColumn() {
  return column.uuid();
}

/**
 * `updated_by` audit column: UUID of the user that last updated the row.
 *
 * @returns A nullable UUID column builder.
 */
export function updatedByColumn() {
  return column.uuid();
}
