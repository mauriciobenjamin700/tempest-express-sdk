/**
 * Trusted client-IP resolution, mirroring `utils.client_ip`.
 *
 * Reading the leftmost `X-Forwarded-For` entry is a security hole — that header
 * is client-controlled. Resolve from a SINGLE header the edge proxy sets itself
 * (e.g. `X-Real-IP`, `CF-Connecting-IP`), falling back to the socket peer.
 */

import type { Request } from "express";

const UNKNOWN = "unknown";

/** Options for {@link getClientIp}. */
export interface ClientIpOptions {
  /**
   * Name of the single edge-set header to trust (case-insensitive, e.g.
   * `"x-real-ip"`). Omit to use only the transport peer.
   */
  trustedHeader?: string;
}

/**
 * Resolve the client IP from an Express request.
 *
 * @param req - The inbound request.
 * @param options - The trusted header to read, if any.
 * @returns The resolved IP, or `"unknown"` when unavailable.
 */
export function getClientIp(req: Request, options: ClientIpOptions = {}): string {
  if (options.trustedHeader) {
    const value = req.header(options.trustedHeader);
    if (value) return value.trim();
  }
  return req.socket?.remoteAddress ?? req.ip ?? UNKNOWN;
}
