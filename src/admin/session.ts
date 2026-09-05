/**
 * Signed-cookie sessions for the admin panel, mirroring `admin.session`.
 *
 * The panel's session is **stateless**: the principal id, display name, CSRF
 * token and expiry travel in the cookie itself, signed with HMAC-SHA256 over
 * the caller's secret. Nothing is kept server-side, so the panel survives a
 * restart and works across replicas without a shared store — the property that
 * matters most for an operator tool that is used in bursts and left open.
 *
 * The CSRF token lives inside the session payload, so every write form can
 * carry it and the server compares it against the cookie it already trusts.
 */

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { parseCookies } from "@/sessions";
import type { Request, Response } from "express";

/** Minimum secret length; a shorter key makes the HMAC trivially brute-forceable. */
const MIN_SECRET_LENGTH = 32;

/** The payload carried by the admin session cookie. */
export interface AdminSession {
  /** Stable id of the authenticated principal. */
  subject: string;
  /** Display name shown in the header. */
  displayName: string;
  /** Token every write form echoes back for CSRF validation. */
  csrfToken: string;
  /** Expiry, in epoch seconds. */
  expiresAt: number;
  /**
   * `true` once the second factor was accepted. Sessions issued for a
   * principal without MFA are complete from the start.
   */
  mfaPassed: boolean;
}

/** Options for {@link AdminSessionStore}. */
export interface AdminSessionStoreOptions {
  /** HMAC key signing the cookie. At least 32 characters. */
  secret: string;
  /** Cookie name. Default `tempest_admin_session`. */
  cookieName?: string;
  /** Session lifetime in seconds. Default `28800` (8 hours). */
  maxAgeSeconds?: number;
  /** Send the cookie with `Secure` (HTTPS only). Default `true`. */
  cookieSecure?: boolean;
  /** Cookie `Path`. Default `/`. */
  cookiePath?: string;
}

/**
 * Encode a value as base64url without padding.
 *
 * @param value - The bytes or string to encode.
 * @returns The base64url text.
 */
function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

/**
 * Issues, verifies and clears the admin session cookie.
 *
 * The cookie value is `<base64url payload>.<base64url signature>`; a payload
 * whose signature does not verify, or whose expiry has passed, resolves to
 * `null` — an operator with a tampered or stale cookie is simply logged out.
 */
export class AdminSessionStore {
  private readonly secret: string;
  private readonly cookieName: string;
  private readonly maxAgeSeconds: number;
  private readonly cookieSecure: boolean;
  private readonly cookiePath: string;

  /**
   * Build the store.
   *
   * @param options - Secret, cookie name, lifetime and cookie flags.
   * @throws Error When the secret is shorter than 32 characters.
   */
  constructor(options: AdminSessionStoreOptions) {
    if (options.secret.length < MIN_SECRET_LENGTH) {
      throw new Error(
        `Admin session secret must be at least ${MIN_SECRET_LENGTH} characters; ` +
          `got ${options.secret.length}`,
      );
    }
    this.secret = options.secret;
    this.cookieName = options.cookieName ?? "tempest_admin_session";
    this.maxAgeSeconds = options.maxAgeSeconds ?? 8 * 60 * 60;
    this.cookieSecure = options.cookieSecure ?? true;
    this.cookiePath = options.cookiePath ?? "/";
  }

  /**
   * Sign a payload.
   *
   * @param payload - The base64url payload to sign.
   * @returns The base64url signature.
   */
  private sign(payload: string): string {
    return createHmac("sha256", this.secret).update(payload).digest("base64url");
  }

  /**
   * Mint a fresh session for an authenticated principal.
   *
   * @param subject - The principal id.
   * @param displayName - The name shown in the header.
   * @param mfaPassed - Whether the second factor is already satisfied.
   * @returns The new session payload (not yet written to a response).
   */
  issue(subject: string, displayName: string, mfaPassed = true): AdminSession {
    return {
      subject,
      displayName,
      csrfToken: randomUUID(),
      expiresAt: Math.floor(Date.now() / 1000) + this.maxAgeSeconds,
      mfaPassed,
    };
  }

  /**
   * Read and verify the session carried by a request.
   *
   * @param req - The inbound request.
   * @returns The session, or `null` when absent, tampered with or expired.
   */
  load(req: Request): AdminSession | null {
    const raw = parseCookies(req.header("cookie") ?? undefined)[this.cookieName];
    if (raw === undefined) return null;
    const separator = raw.lastIndexOf(".");
    if (separator <= 0) return null;

    const payload = raw.slice(0, separator);
    const signature = Buffer.from(raw.slice(separator + 1), "base64url");
    const expected = Buffer.from(this.sign(payload), "base64url");
    if (signature.length !== expected.length) return null;
    if (!timingSafeEqual(signature, expected)) return null;

    let session: AdminSession;
    try {
      session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    } catch {
      return null;
    }
    if (typeof session.subject !== "string" || typeof session.csrfToken !== "string") {
      return null;
    }
    if (session.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    return session;
  }

  /**
   * Write a session to the response as a signed cookie.
   *
   * @param res - The outbound response.
   * @param session - The session to persist.
   */
  save(res: Response, session: AdminSession): void {
    const payload = encode(JSON.stringify(session));
    const value = `${payload}.${this.sign(payload)}`;
    const maxAge = Math.max(0, session.expiresAt - Math.floor(Date.now() / 1000));
    res.append("set-cookie", this.cookie(value, maxAge));
  }

  /**
   * Drop the session cookie.
   *
   * @param res - The outbound response.
   */
  clear(res: Response): void {
    res.append("set-cookie", this.cookie("", 0));
  }

  /**
   * Render a `Set-Cookie` value with the configured flags.
   *
   * @param value - The cookie value.
   * @param maxAge - Lifetime in seconds (`0` expires it immediately).
   * @returns The header value.
   */
  private cookie(value: string, maxAge: number): string {
    const parts = [
      `${this.cookieName}=${value}`,
      `Path=${this.cookiePath}`,
      `Max-Age=${maxAge}`,
      "HttpOnly",
      "SameSite=Lax",
    ];
    if (this.cookieSecure) parts.push("Secure");
    return parts.join("; ");
  }
}

/**
 * Compare a submitted CSRF token against the session's, in constant time.
 *
 * @param session - The active session.
 * @param submitted - The `csrf_token` field from the form body.
 * @returns `true` when the tokens match.
 */
export function csrfTokenMatches(session: AdminSession, submitted: unknown): boolean {
  if (typeof submitted !== "string") return false;
  const expected = Buffer.from(session.csrfToken, "utf8");
  const actual = Buffer.from(submitted, "utf8");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
