/**
 * `bodySizeLimitMiddleware` — reject oversize request bodies early, mirroring
 * `api.middlewares.body_size`.
 *
 * Without an upstream limit a client can stream gigabytes before body parsers
 * reject it — wasting bandwidth and RAM. This middleware short-circuits the
 * moment `Content-Length` exceeds the cap, and defensively tracks streamed
 * bytes for chunked/unknown-length uploads.
 */

import type { RequestHandler } from "express";

/** Options for {@link bodySizeLimitMiddleware}. */
export interface BodySizeLimitOptions {
  /** Hard cap on the request body in bytes. */
  maxBytes: number;
  /** Path prefixes that bypass the check (e.g. an upload endpoint). */
  excludePaths?: string[];
}

/**
 * Build a middleware enforcing `maxBytes` per request. A `Content-Length` over
 * the cap is rejected immediately with `413`; chunked bodies are aborted once
 * the streamed size crosses the cap.
 *
 * @param options - The cap and path exclusions.
 * @returns An Express middleware.
 */
export function bodySizeLimitMiddleware(options: BodySizeLimitOptions): RequestHandler {
  const { maxBytes } = options;
  const excludePaths = options.excludePaths ?? [];

  const reject = (res: Parameters<RequestHandler>[1]): void => {
    res.status(413).json({
      detail: "Request body too large.",
      code: "REQUEST_BODY_TOO_LARGE",
      details: { maxBytes },
    });
  };

  return (req, res, next) => {
    if (maxBytes <= 0 || excludePaths.some((prefix) => req.path.startsWith(prefix))) {
      next();
      return;
    }

    // Step 1 — fast path on Content-Length.
    const declared = Number.parseInt(req.header("content-length") ?? "", 10);
    if (Number.isFinite(declared) && declared > maxBytes) {
      reject(res);
      return;
    }

    // Step 2 — defensive streaming check for chunked/unknown-length bodies.
    // A `data` listener runs alongside any downstream body parser (Node fans
    // each chunk out to every listener), so counting here doesn't steal the
    // body. On overflow we answer 413 and destroy the request to abort.
    let seen = 0;
    let aborted = false;
    const onData = (chunk: Buffer | string): void => {
      if (aborted) return;
      seen += Buffer.byteLength(chunk);
      if (seen > maxBytes) {
        aborted = true;
        req.removeListener("data", onData);
        if (!res.headersSent) reject(res);
        req.destroy();
      }
    };
    req.on("data", onData);
    req.on("end", () => req.removeListener("data", onData));
    next();
  };
}
