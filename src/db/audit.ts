/**
 * Audit log model + snapshot/diff helpers, mirroring `db.audit`.
 *
 * `BaseAuditLogModel` records who changed what: the entity, its id, the action,
 * an actor and a before/after `changes` diff. {@link snapshot} freezes a row to
 * a plain record and {@link diffSnapshots} computes the changed-field diff — the
 * two together are what a service writes into an audit row on every mutation.
 */

import { BaseModel } from "@/db/model";
import { column } from "tempest-db-js";

/** The kind of mutation an audit entry records. */
export const AuditAction = {
  CREATE: "create",
  UPDATE: "update",
  DELETE: "delete",
} as const;

/** An `AuditAction` value. */
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

/** A per-field before/after change. */
export interface FieldChange {
  before: unknown;
  after: unknown;
}

/**
 * Freeze a row (ORM instance or plain object) into a plain, comparable record,
 * dropping keys whose value is a function.
 *
 * @param row - The row to snapshot.
 * @param exclude - Field names to omit (e.g. `["hashedPassword"]`).
 * @returns A plain record of the row's own enumerable data fields.
 */
export function snapshot(
  row: Record<string, unknown>,
  exclude: readonly string[] = [],
): Record<string, unknown> {
  const skip = new Set(exclude);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (skip.has(key) || typeof value === "function") continue;
    out[key] = value;
  }
  return out;
}

/**
 * Compute the changed-field diff between two snapshots.
 *
 * @param before - The snapshot before the change.
 * @param after - The snapshot after the change.
 * @returns A map of changed field → `{ before, after }`; empty when nothing
 *   changed. Keys present in only one side count as a change.
 */
export function diffSnapshots(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, FieldChange> {
  const changed: Record<string, FieldChange> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const oldValue = before[key];
    const newValue = after[key];
    if (
      !Object.is(oldValue, newValue) &&
      JSON.stringify(oldValue) !== JSON.stringify(newValue)
    ) {
      changed[key] = { before: oldValue, after: newValue };
    }
  }
  return changed;
}

/**
 * Base for an append-only audit log. Subclass it, set `tablename`, add indexes
 * on `entity` / `entityId` / `actor` in a migration.
 */
export abstract class BaseAuditLogModel extends BaseModel {
  /** Changed model name (e.g. `"UserModel"`). */
  entity = column.varchar(128).notNull();
  /** Changed row id, stored as text. */
  entityId = column.varchar(64).notNull();
  /** Mutation kind (an {@link AuditAction} value). */
  action = column.varchar(16).notNull();
  /** Who performed the change, or `null` for system/anonymous. */
  actor = column.varchar(128);
  /** Before/after diff, serialized as JSON. */
  changes = column.json<Record<string, FieldChange>>().notNull();
  /** Optional extra metadata (request id, ip, reason, …). */
  context = column.json<Record<string, unknown>>();
}
