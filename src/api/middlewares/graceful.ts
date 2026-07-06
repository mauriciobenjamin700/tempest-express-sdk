/**
 * `GracefulShutdown` — track in-flight requests and drain on shutdown,
 * mirroring `api.middlewares.graceful`.
 *
 * Wire {@link GracefulShutdown.middleware} into the app, then on `SIGTERM`
 * call {@link GracefulShutdown.beginDrain} (new non-exempt requests get `503`)
 * and `await` {@link GracefulShutdown.waitDrained} before closing the server —
 * so a rolling deploy never cuts an in-flight request mid-response.
 */

import type { RequestHandler } from "express";

/** Options for {@link GracefulShutdown}. */
export interface GracefulShutdownOptions {
  /** Max seconds to wait for in-flight requests to finish. Default `30`. */
  drainTimeoutSeconds?: number;
  /** `Retry-After` seconds on the 503 served while draining. Default `5`. */
  retryAfterSeconds?: number;
  /** Exact paths that keep being served while draining. */
  exemptPaths?: string[];
}

/** In-flight request tracker with a drain gate. */
export class GracefulShutdown {
  private readonly drainTimeoutSeconds: number;
  private readonly retryAfterSeconds: number;
  private readonly exempt: Set<string>;
  private inFlightCount = 0;
  private draining = false;
  private idleResolvers: Array<() => void> = [];

  constructor(options: GracefulShutdownOptions = {}) {
    this.drainTimeoutSeconds = options.drainTimeoutSeconds ?? 30;
    this.retryAfterSeconds = options.retryAfterSeconds ?? 5;
    this.exempt = new Set(options.exemptPaths ?? []);
  }

  /** Number of requests currently being served. */
  get inFlight(): number {
    return this.inFlightCount;
  }

  /** Whether draining has begun. */
  get isDraining(): boolean {
    return this.draining;
  }

  /** The Express middleware: counts in-flight requests, 503s while draining. */
  middleware(): RequestHandler {
    return (req, res, next) => {
      if (this.draining && !this.exempt.has(req.path)) {
        res.setHeader("Retry-After", String(this.retryAfterSeconds));
        res.setHeader("Connection", "close");
        res.status(503).json({
          detail: "Server is shutting down.",
          code: "SERVICE_UNAVAILABLE",
          details: {},
        });
        return;
      }
      this.inFlightCount += 1;
      // `finish` and `close` can both fire for one response — settle once.
      let settled = false;
      const settle = (): void => {
        if (settled) return;
        settled = true;
        this.release();
      };
      res.on("finish", settle);
      res.on("close", settle);
      next();
    };
  }

  private release(): void {
    this.inFlightCount -= 1;
    if (this.inFlightCount === 0) {
      const resolvers = this.idleResolvers;
      this.idleResolvers = [];
      for (const resolve of resolvers) resolve();
    }
  }

  /** Flip into draining mode (idempotent). New non-exempt requests get 503. */
  beginDrain(): void {
    this.draining = true;
  }

  /**
   * Wait until in-flight requests finish or the drain timeout elapses.
   *
   * @returns `true` if everything drained in time, `false` on timeout.
   */
  waitDrained(): Promise<boolean> {
    if (this.inFlightCount === 0) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.idleResolvers = this.idleResolvers.filter((r) => r !== onIdle);
        resolve(false);
      }, this.drainTimeoutSeconds * 1000);
      const onIdle = (): void => {
        clearTimeout(timer);
        resolve(true);
      };
      this.idleResolvers.push(onIdle);
    });
  }
}
