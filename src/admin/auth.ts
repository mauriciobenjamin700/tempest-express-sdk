/**
 * Authentication backends for the admin panel, mirroring `admin.auth`.
 *
 * Operators sign in with a row from the project's own database — there is no
 * separate admin password store. {@link UserModelAuthBackend} covers the
 * conventional case (a {@link BaseUserModel} subclass gated on `isActive` and
 * `isAdmin`); anything else — LDAP, an upstream identity provider, a service
 * account table — implements {@link AdminAuthBackend} directly.
 */

import type { AsyncSession, ModelClass } from "@/db";
import { BaseRepository } from "@/db";
import { PasswordUtils } from "@/utils";

/** The columns {@link UserModelAuthBackend} reads off a principal row. */
interface UserPrincipalRow {
  id: string;
  email: string;
  hashedPassword: string;
  isActive: boolean;
  isAdmin: boolean;
}

/** Verifies a TOTP code for a principal that enrolled a second factor. */
export interface AdminMfaVerifier {
  /** Whether the principal has a confirmed second factor. */
  isEnabled(userId: string): Promise<boolean>;
  /** Whether `code` is a valid current TOTP for the principal. */
  verify(userId: string, code: string): Promise<boolean>;
}

/**
 * How the panel turns a login form into a principal.
 *
 * The interface is generic in the principal so a custom backend can hand its
 * own row type back to {@link AdminAuthBackend.displayName} and friends.
 */
export interface AdminAuthBackend<Principal = unknown> {
  /**
   * Verify credentials.
   *
   * @param session - A DB session for the current request.
   * @param identifier - The submitted login identifier (typically an email).
   * @param password - The submitted plaintext password.
   * @returns The principal, or `null` when the credentials are rejected.
   */
  authenticate(
    session: AsyncSession,
    identifier: string,
    password: string,
  ): Promise<Principal | null>;

  /**
   * Re-load the principal a session points at, so a deactivated operator loses
   * access on the next request rather than at cookie expiry.
   *
   * @param session - A DB session for the current request.
   * @param subject - The principal id stored in the session.
   * @returns The principal, or `null` when it no longer qualifies.
   */
  loadPrincipal(session: AsyncSession, subject: string): Promise<Principal | null>;

  /**
   * Return the stable id stored in the session cookie.
   *
   * @param principal - The authenticated principal.
   * @returns The principal id.
   */
  principalId(principal: Principal): string;

  /**
   * Return the name shown in the panel header.
   *
   * @param principal - The authenticated principal.
   * @returns A human-readable label.
   */
  displayName(principal: Principal): string;

  /**
   * Whether this principal must clear a second factor before entering.
   *
   * Omit to declare the backend has no MFA — the panel then treats every
   * successful password check as a complete login.
   *
   * @param principal - The authenticated principal.
   * @returns `true` when a TOTP challenge is required.
   */
  mfaEnabled?(principal: Principal): Promise<boolean>;

  /**
   * Verify the submitted TOTP code.
   *
   * @param principal - The authenticated principal.
   * @param code - The submitted code.
   * @returns `true` when the code is valid.
   */
  verifyMfa?(principal: Principal, code: string): Promise<boolean>;
}

/** Options for {@link UserModelAuthBackend}. */
export interface UserModelAuthBackendOptions {
  /** Password hasher. Defaults to a stock {@link PasswordUtils}. */
  passwords?: PasswordUtils;
  /**
   * TOTP verifier. When given, a principal with a confirmed secret is sent
   * through the panel's `/mfa` challenge after the password check, so the
   * admin panel can never be the weaker door into an MFA-protected account.
   */
  mfa?: AdminMfaVerifier;
  /** Column holding the login identifier. Default `"email"`. */
  identifierField?: string;
  /**
   * Require `isAdmin === true` on the row. Default `true`. Turn it off only
   * when the model expresses privilege some other way and the panel is already
   * gated elsewhere.
   */
  requireAdmin?: boolean;
}

/**
 * The conventional backend: authenticate against a {@link BaseUserModel}
 * subclass, admitting only rows that are both active and flagged as admins.
 *
 * ```ts
 * new UserModelAuthBackend(UserModel);
 * ```
 */
export class UserModelAuthBackend implements AdminAuthBackend<UserPrincipalRow> {
  private readonly model: ModelClass;
  private readonly passwords: PasswordUtils;
  private readonly mfa: AdminMfaVerifier | null;
  private readonly identifierField: string;
  private readonly requireAdmin: boolean;

  /**
   * Build the backend.
   *
   * @param model - The user model class (a `BaseUserModel` subclass).
   * @param options - Hasher, MFA verifier and gating overrides.
   */
  constructor(model: ModelClass, options: UserModelAuthBackendOptions = {}) {
    this.model = model;
    this.passwords = options.passwords ?? new PasswordUtils();
    this.mfa = options.mfa ?? null;
    this.identifierField = options.identifierField ?? "email";
    this.requireAdmin = options.requireAdmin ?? true;
  }

  /**
   * Whether a row is allowed into the panel at all.
   *
   * @param row - The candidate row.
   * @returns `true` when the row is active and (when required) an admin.
   */
  private admits(row: UserPrincipalRow): boolean {
    if (row.isActive === false) return false;
    return !this.requireAdmin || row.isAdmin === true;
  }

  /**
   * Verify an identifier/password pair.
   *
   * The identifier is lowercased and trimmed before lookup, matching the
   * normalization the auth service applies on signup.
   *
   * @param session - A DB session for the current request.
   * @param identifier - The submitted identifier.
   * @param password - The submitted plaintext password.
   * @returns The matching row, or `null` when it does not qualify.
   */
  async authenticate(
    session: AsyncSession,
    identifier: string,
    password: string,
  ): Promise<UserPrincipalRow | null> {
    const repository = new BaseRepository(this.model, session);
    const filters = { [this.identifierField]: identifier.trim().toLowerCase() };
    const row = (await repository.first(
      filters as never,
    )) as unknown as UserPrincipalRow | null;
    if (row === null || !this.admits(row)) return null;
    if (!(await this.passwords.verify(password, row.hashedPassword))) return null;
    return row;
  }

  /**
   * Re-load the principal a session points at.
   *
   * @param session - A DB session for the current request.
   * @param subject - The principal id from the session cookie.
   * @returns The row, or `null` when it vanished or lost its privileges.
   */
  async loadPrincipal(
    session: AsyncSession,
    subject: string,
  ): Promise<UserPrincipalRow | null> {
    const repository = new BaseRepository(this.model, session);
    const row = (await repository.getByIdOrNull(
      subject,
    )) as unknown as UserPrincipalRow | null;
    if (row === null || !this.admits(row)) return null;
    return row;
  }

  /**
   * Return the row's primary key.
   *
   * @param principal - The authenticated row.
   * @returns The principal id.
   */
  principalId(principal: UserPrincipalRow): string {
    return String(principal.id);
  }

  /**
   * Return the label shown in the panel header.
   *
   * @param principal - The authenticated row.
   * @returns The identifier column's value.
   */
  displayName(principal: UserPrincipalRow): string {
    const value = (principal as unknown as Record<string, unknown>)[this.identifierField];
    return typeof value === "string" ? value : String(principal.id);
  }

  /**
   * Whether the principal enrolled a second factor.
   *
   * @param principal - The authenticated row.
   * @returns `true` when an MFA verifier is configured and reports a secret.
   */
  async mfaEnabled(principal: UserPrincipalRow): Promise<boolean> {
    if (this.mfa === null) return false;
    return await this.mfa.isEnabled(String(principal.id));
  }

  /**
   * Verify a submitted TOTP code.
   *
   * @param principal - The authenticated row.
   * @param code - The submitted code.
   * @returns `true` when the code is valid.
   */
  async verifyMfa(principal: UserPrincipalRow, code: string): Promise<boolean> {
    if (this.mfa === null) return false;
    return await this.mfa.verify(String(principal.id), code);
  }
}
