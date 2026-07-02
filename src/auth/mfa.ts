/**
 * TOTP MFA enrollment/verification, mirroring the FastAPI SDK MFA flow.
 *
 * Orchestrates {@link TOTPHelper} over a pluggable {@link MfaStore}: enroll
 * (generate + persist a secret, return the provisioning URI), confirm (verify a
 * code and flip MFA on), verify (login step) and disable.
 */

import { ValidationException } from "@/exceptions/http";
import type { TOTPHelper } from "@/utils/totp";

/** Persistence port for MFA secrets/state. */
export interface MfaStore {
  /** Persist a user's TOTP secret (pending until confirmed). */
  setSecret(userId: string, secret: string): Promise<void>;
  /** Read a user's TOTP secret, or `null`. */
  getSecret(userId: string): Promise<string | null>;
  /** Flip the MFA-enabled flag. */
  setEnabled(userId: string, enabled: boolean): Promise<void>;
  /** Whether MFA is enabled for the user. */
  isEnabled(userId: string): Promise<boolean>;
}

/** The result of starting enrollment. */
export interface MfaEnrollment {
  /** The base32 secret (persist server-side; also shown once for manual entry). */
  secret: string;
  /** The `otpauth://` URI to render as a QR code. */
  otpauthUri: string;
}

/** Options for {@link MfaService}. */
export interface MfaServiceOptions {
  /** The MFA persistence port. */
  store: MfaStore;
  /** The TOTP helper (issuer preconfigured). */
  totp: TOTPHelper;
}

export class MfaService {
  private readonly store: MfaStore;
  private readonly totp: TOTPHelper;

  /**
   * @param options - Store and TOTP helper.
   */
  constructor(options: MfaServiceOptions) {
    this.store = options.store;
    this.totp = options.totp;
  }

  /**
   * Begin enrollment: generate and persist a secret, return the QR URI.
   *
   * @param userId - The enrolling user.
   * @param accountName - Label shown in the authenticator (usually the email).
   * @returns The secret and provisioning URI.
   */
  async enroll(userId: string, accountName: string): Promise<MfaEnrollment> {
    const secret = this.totp.generateSecret();
    await this.store.setSecret(userId, secret);
    await this.store.setEnabled(userId, false);
    return { secret, otpauthUri: this.totp.provisioningUri(secret, accountName) };
  }

  /**
   * Confirm enrollment by verifying a code, enabling MFA on success.
   *
   * @param userId - The user.
   * @param code - The 6-digit code from the authenticator.
   * @throws {ValidationException} When no secret is pending or the code is wrong.
   */
  async confirm(userId: string, code: string): Promise<void> {
    const secret = await this.store.getSecret(userId);
    if (!secret) throw new ValidationException({ message: "MFA not initialized" });
    if (!this.totp.verify(secret, code)) {
      throw new ValidationException({ message: "Invalid MFA code" });
    }
    await this.store.setEnabled(userId, true);
  }

  /**
   * Verify a code (login step). Returns `false` without throwing.
   *
   * @param userId - The user.
   * @param code - The submitted code.
   * @returns `true` when the code is valid.
   */
  async verify(userId: string, code: string): Promise<boolean> {
    const secret = await this.store.getSecret(userId);
    return secret ? this.totp.verify(secret, code) : false;
  }

  /**
   * Disable MFA after verifying a code.
   *
   * @param userId - The user.
   * @param code - The submitted code.
   * @throws {ValidationException} When the code is invalid.
   */
  async disable(userId: string, code: string): Promise<void> {
    if (!(await this.verify(userId, code))) {
      throw new ValidationException({ message: "Invalid MFA code" });
    }
    await this.store.setEnabled(userId, false);
    await this.store.setSecret(userId, "");
  }
}
