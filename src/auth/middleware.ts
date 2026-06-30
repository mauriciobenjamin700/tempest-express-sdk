/**
 * JWT auth middleware + role guards, mirroring `api.dependencies.auth`.
 *
 * {@link makeJwtAuthMiddleware} decodes a `Bearer` token and attaches the
 * claims to `req.auth`; {@link requireRoles} gates a route on role membership.
 * Failures raise the SDK's {@link UnauthorizedException} / {@link ForbiddenException}
 * so they render as the canonical error envelope.
 */

import { ForbiddenException, UnauthorizedException } from "@/exceptions/http";
import type { JWTUtils, JwtClaims } from "@/utils/jwt";
import type { Request, RequestHandler } from "express";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    /** Decoded JWT claims, populated by {@link makeJwtAuthMiddleware}. */
    interface Request {
      auth?: JwtClaims;
    }
  }
}

/** Extract a `Bearer` token from the `Authorization` header, or `null`. */
export function bearerToken(req: Request): string | null {
  const header = req.header("authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

/** Read the decoded claims attached by the auth middleware, or `null`. */
export function getAuth(req: Request): JwtClaims | null {
  return req.auth ?? null;
}

/** Options for {@link makeJwtAuthMiddleware}. */
export interface JwtAuthOptions {
  /** When `true` (default), a missing/invalid token rejects with 401. */
  required?: boolean;
}

/**
 * Build middleware that decodes the bearer token and sets `req.auth`.
 *
 * @param jwt - The JWT helper used to verify tokens.
 * @param options - Whether authentication is required.
 * @returns An Express middleware.
 */
export function makeJwtAuthMiddleware(
  jwt: JWTUtils,
  options: JwtAuthOptions = {},
): RequestHandler {
  const required = options.required ?? true;
  return (req, _res, next) => {
    const token = bearerToken(req);
    if (!token) {
      if (required) {
        next(new UnauthorizedException({ message: "Missing bearer token" }));
        return;
      }
      next();
      return;
    }
    jwt
      .decode(token)
      .then((claims) => {
        req.auth = claims;
        next();
      })
      .catch((error: unknown) => {
        if (required) next(error);
        else next();
      });
  };
}

/**
 * Build middleware that requires the authenticated user to hold at least one
 * of `roles` (read from the `roles` claim). Must run after the auth middleware.
 *
 * @param roles - Acceptable role names.
 * @returns An Express middleware.
 */
export function requireRoles(...roles: string[]): RequestHandler {
  return (req, _res, next) => {
    const claims = req.auth;
    if (!claims) {
      next(new UnauthorizedException({ message: "Not authenticated" }));
      return;
    }
    const held = Array.isArray(claims.roles) ? (claims.roles as unknown[]) : [];
    if (roles.some((role) => held.includes(role))) {
      next();
      return;
    }
    next(new ForbiddenException({ message: "Insufficient role", details: { roles } }));
  };
}
