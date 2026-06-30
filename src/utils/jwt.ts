/**
 * JWT encode/decode backed by `jsonwebtoken`, mirroring `utils.jwt.JWTUtils`.
 *
 * `jsonwebtoken` is an optional peer dependency, imported lazily so the SDK
 * imports without it; the clear error is deferred to first use. Every token
 * gets `iat`/`exp` automatically; pass `issuer` to add and verify `iss`.
 * Expired/invalid tokens raise the SDK's {@link ExpiredTokenException} /
 * {@link InvalidTokenException}.
 */

import { ExpiredTokenException, InvalidTokenException } from "@/exceptions/http";

type JwtModule = typeof import("jsonwebtoken");

let cached: JwtModule | null = null;

/** Lazily load `jsonwebtoken`, with a clear install hint when missing. */
async function loadJwt(): Promise<JwtModule> {
  if (cached) return cached;
  try {
    const mod = (await import("jsonwebtoken")) as JwtModule & { default?: JwtModule };
    cached = mod.default ?? mod;
  } catch (cause) {
    throw new Error(
      "JWTUtils requires the 'jsonwebtoken' peer dependency. Install with `npm i jsonwebtoken`.",
      { cause },
    );
  }
  return cached;
}

/** JWT claims — a free-form payload. */
export type JwtClaims = Record<string, unknown>;

/** Options for {@link JWTUtils}. */
export interface JWTUtilsOptions {
  /** Signing algorithm. Defaults to `HS256`. */
  algorithm?: "HS256" | "HS384" | "HS512" | "RS256" | "ES256";
  /** Default token lifetime in seconds. Defaults to 3600 (1 hour). */
  defaultTtlSeconds?: number;
  /** Value for the `iss` claim; when set, `decode` verifies it. */
  issuer?: string;
}

/** Encode and decode JWTs using a shared secret (or asymmetric key). */
export class JWTUtils {
  private readonly algorithm: NonNullable<JWTUtilsOptions["algorithm"]>;
  private readonly defaultTtlSeconds: number;
  private readonly issuer: string | undefined;

  /**
   * @param secret - The signing key (HMAC secret or private key).
   * @param options - Algorithm, default TTL and optional issuer.
   */
  constructor(
    private readonly secret: string,
    options: JWTUtilsOptions = {},
  ) {
    this.algorithm = options.algorithm ?? "HS256";
    this.defaultTtlSeconds = options.defaultTtlSeconds ?? 3600;
    this.issuer = options.issuer;
  }

  /**
   * Encode `payload` as a signed JWT.
   *
   * @param payload - Claims to include (typically `{ sub: "<user-id>" }`).
   * @param options - Override the default TTL for this call.
   * @returns The compact-serialized JWT.
   */
  async encode(
    payload: JwtClaims,
    options: { ttlSeconds?: number } = {},
  ): Promise<string> {
    const jwt = await loadJwt();
    return jwt.sign(payload, this.secret, {
      algorithm: this.algorithm,
      expiresIn: options.ttlSeconds ?? this.defaultTtlSeconds,
      ...(this.issuer !== undefined ? { issuer: this.issuer } : {}),
    });
  }

  /**
   * Decode and verify a JWT.
   *
   * @param token - The token to decode.
   * @returns The decoded claims.
   * @throws {ExpiredTokenException} When `exp` is in the past.
   * @throws {InvalidTokenException} For any other validation failure.
   */
  async decode(token: string): Promise<JwtClaims> {
    const jwt = await loadJwt();
    try {
      const decoded = jwt.verify(token, this.secret, {
        algorithms: [this.algorithm],
        ...(this.issuer !== undefined ? { issuer: this.issuer } : {}),
      });
      return typeof decoded === "string" ? { sub: decoded } : (decoded as JwtClaims);
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) throw new ExpiredTokenException();
      throw new InvalidTokenException();
    }
  }

  /**
   * Decode and verify a JWT, returning `null` on failure (soft auth).
   *
   * @param token - The token to decode.
   * @returns The decoded claims, or `null` when invalid/expired.
   */
  async decodeOrNull(token: string): Promise<JwtClaims | null> {
    try {
      return await this.decode(token);
    } catch {
      return null;
    }
  }
}
