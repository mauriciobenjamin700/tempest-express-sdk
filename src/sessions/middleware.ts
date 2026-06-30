/**
 * Session middleware, mirroring `sessions.middleware`.
 *
 * Reads the session cookie, resolves it to a live {@link Session} via the
 * {@link SessionService}, and attaches it to `req.session` (or `null` when
 * absent/expired). Pairs with {@link makeJwtAuthMiddleware} for JWT auth; use
 * whichever model fits the surface.
 */

import type { SessionService } from "@/sessions/service";
import type { Session } from "@/sessions/store";
import type { Request, RequestHandler } from "express";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    /** The live session for this request, populated by the middleware. */
    interface Request {
      session?: Session | null;
    }
  }
}

/** Parse the `Cookie` header into a name → value map. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

/** Read the session cookie value from a request, or `null`. */
export function sessionCookie(req: Request, cookieName: string): string | null {
  return parseCookies(req.header("cookie") ?? undefined)[cookieName] ?? null;
}

/** Options for {@link makeSessionMiddleware}. */
export interface SessionMiddlewareOptions {
  /** Cookie name carrying the opaque session id. Default `sid`. */
  cookieName?: string;
}

/**
 * Build middleware that resolves the session cookie into `req.session`.
 *
 * @param service - The session service used to resolve cookies.
 * @param options - Cookie name.
 * @returns An Express middleware.
 */
export function makeSessionMiddleware(
  service: SessionService,
  options: SessionMiddlewareOptions = {},
): RequestHandler {
  const cookieName = options.cookieName ?? "sid";
  return (req, _res, next) => {
    const token = sessionCookie(req, cookieName);
    if (!token) {
      req.session = null;
      next();
      return;
    }
    service
      .resolve(token)
      .then((session) => {
        req.session = session;
        next();
      })
      .catch(next);
  };
}
