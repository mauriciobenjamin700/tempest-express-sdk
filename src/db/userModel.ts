/**
 * Optional base user + token models, mirroring `db.user_model` /
 * `db.user_token_model` / `db.user_refresh_token_model`.
 *
 * These are **opt-in** starting points: subclass one, set a `static tablename`,
 * and add the columns your domain needs. They extend {@link BaseModel}, so they
 * already carry `id` / `isActive` / `createdAt` / `updatedAt`.
 */

import { BaseModel } from "@/db/model";
import { column, sql } from "tempest-db-js";

/**
 * Base for an authenticated user. Subclass it, set `tablename`, and add domain
 * columns (name, avatar, …):
 *
 * ```ts
 * class UserModel extends BaseUserModel {
 *   static tablename = tableNameFor("UserModel"); // "user"
 *   name = column.text().notNull();
 * }
 * ```
 */
export abstract class BaseUserModel extends BaseModel {
  /** Login identifier; enforce uniqueness with a unique index in a migration. */
  email = column.varchar(320).notNull();
  /** The password hash (never the plaintext) — see `PasswordUtils`. */
  hashedPassword = column.text().notNull();
  /** Whether the user has administrative privileges. */
  isAdmin = column.boolean().notNull().default(false);
  /** Timestamp of the last successful login, or `null` if never. */
  lastLoginAt = column.datetime();
}

/** Purpose of a single-use user token. */
export const UserTokenPurpose = {
  ACTIVATION: "activation",
  PASSWORD_RESET: "password_reset",
  EMAIL_VERIFICATION: "email_verification",
  EMAIL_CHANGE: "email_change",
} as const;

/** A `UserTokenPurpose` value. */
export type UserTokenPurpose = (typeof UserTokenPurpose)[keyof typeof UserTokenPurpose];

/**
 * Base for a single-use, hashed user token (activation, password reset, email
 * verification/change). Store only the **hash** of the token; compare hashes on
 * redemption.
 */
export abstract class BaseUserTokenModel extends BaseModel {
  /** Owning user id. */
  userId = column.uuid().notNull();
  /** Hash of the opaque token value. */
  tokenHash = column.text().notNull();
  /** Purpose discriminator (a {@link UserTokenPurpose} value). */
  purpose = column.varchar(32).notNull();
  /** When the token stops being valid. */
  expiresAt = column.datetime().notNull();
  /** When the token was consumed, or `null` while still usable. */
  usedAt = column.datetime();
  /** Optional JSON payload carried with the token (e.g. the pending email). */
  payload = column.json<Record<string, unknown>>();
}

/**
 * Base for a rotating refresh token. Rotation revokes the used token and issues
 * a new one in the same `familyId`; reuse of a revoked token in a family is the
 * signal to revoke the whole family (theft detection).
 */
export abstract class BaseUserRefreshTokenModel extends BaseModel {
  /** Owning user id. */
  userId = column.uuid().notNull();
  /** Hash of the opaque refresh token. */
  tokenHash = column.text().notNull();
  /** Rotation family — all tokens descended from one login share it. */
  familyId = column.uuid().notNull().default(sql.uuidv4());
  /** When the token expires. */
  expiresAt = column.datetime().notNull();
  /** When the token was rotated/consumed, or `null`. */
  usedAt = column.datetime();
  /** When the token was revoked, or `null` while active. */
  revokedAt = column.datetime();
}
