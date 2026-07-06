/**
 * `csrfMiddleware` — double-submit cookie protection for state changes,
 * mirroring `api.middlewares.csrf`.
 *
 * CSRF lets a third-party site trigger authenticated mutating requests through
 * a victim's browser, because cookies ride along automatically. The
 * double-submit defense: issue a random `csrf_token` cookie, have the frontend
 * echo it in an `X-CSRF-Token` header, and reject mutating requests where the
 * header is missing or does not match the cookie. A cross-site page can't read
 * the cookie (same-origin policy), so it can't forge the header.
 *
 * JWT bearer auth (`Authorization: Bearer …`) is **not** subject to CSRF (the
 * browser doesn't auto-attach it), so `/api/` routes are typically excluded.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler } from "express";

/** Default cookie holding the CSRF token. */
export const CSRF_COOKIE_NAME = "csrf_token";
/** Default header the client echoes the cookie value into. */
export const CSRF_HEADER_NAME = "X-CSRF-Token";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Generate a URL-safe random CSRF token.
 *
 * @param nBytes - Entropy bytes (32 → a 43-char token). Default `32`.
 * @returns A URL-safe base64 token without padding.
 */
export function generateCsrfToken(nBytes = 32): string {
  return randomBytes(nBytes).toString("base64url");
}

function readCookie(req: Request, name: string): string | undefined {
  // Prefer a cookie-parser-populated `req.cookies`, else parse the header.
  const parsed = (req as Request & { cookies?: Record<string, string> }).cookies;
  if (parsed && typeof parsed[name] === "string") return parsed[name];
  const header = req.header("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return undefined;
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Options for {@link csrfMiddleware}. */
export interface CsrfOptions {
  /** Name of the CSRF cookie. Default `csrf_token`. */
  cookieName?: string;
  /** Name of the CSRF header. Default `X-CSRF-Token`. */
  headerName?: string;
  /** Path prefixes that bypass the check (e.g. `["/api/", "/webhooks/"]`). */
  excludePaths?: string[];
}

/**
 * Build a double-submit CSRF middleware. Safe methods (GET/HEAD/OPTIONS) pass;
 * unsafe methods must carry a matching cookie + header or get `403`.
 *
 * @param options - Cookie/header names and excluded path prefixes.
 * @returns An Express middleware.
 */
export function csrfMiddleware(options: CsrfOptions = {}): RequestHandler {
  const cookieName = options.cookieName ?? CSRF_COOKIE_NAME;
  const headerName = options.headerName ?? CSRF_HEADER_NAME;
  const excludePaths = options.excludePaths ?? [];

  const reject = (res: Parameters<RequestHandler>[1], message: string): void => {
    res.status(403).json({ detail: message, code: "CSRF_FAILED", details: {} });
  };

  return (req, res, next) => {
    if (!UNSAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    if (excludePaths.some((prefix) => req.path.startsWith(prefix))) {
      next();
      return;
    }
    const cookieToken = readCookie(req, cookieName);
    const headerToken = req.header(headerName);
    if (!cookieToken || !headerToken) {
      reject(res, "CSRF token missing.");
      return;
    }
    if (!safeEqual(cookieToken, headerToken)) {
      reject(res, "CSRF token mismatch.");
      return;
    }
    next();
  };
}
