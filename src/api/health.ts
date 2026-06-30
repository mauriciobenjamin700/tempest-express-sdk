/**
 * Health-check router, mirroring `api.routers.health`.
 *
 * A meta endpoint mounted at the root prefix (not under `/api`). Returns a
 * small JSON status payload and runs any registered async checks, surfacing
 * their pass/fail under `checks` and degrading the HTTP status to 503 when any
 * check fails.
 */

import { type Router, Router as createRouter } from "express";

/** A named async health probe returning `true` when healthy. */
export interface HealthCheck {
  /** Probe name, surfaced under `checks`. */
  name: string;
  /** The probe; resolves `true` when the dependency is healthy. */
  check: () => Promise<boolean> | boolean;
}

/** Options for {@link makeHealthRouter}. */
export interface HealthRouterOptions {
  /** Route path within the router. Default `/health`. */
  path?: string;
  /** Optional dependency probes (e.g. database, cache). */
  checks?: HealthCheck[];
}

/**
 * Build a health-check router.
 *
 * @param options - Path and dependency probes.
 * @returns An Express router exposing the health endpoint.
 */
export function makeHealthRouter(options: HealthRouterOptions = {}): Router {
  const path = options.path ?? "/health";
  const checks = options.checks ?? [];
  const router = createRouter();

  router.get(path, async (_req, res) => {
    const results: Record<string, boolean> = {};
    let healthy = true;
    for (const probe of checks) {
      let ok = false;
      try {
        ok = await probe.check();
      } catch {
        ok = false;
      }
      results[probe.name] = ok;
      if (!ok) healthy = false;
    }
    res.status(healthy ? 200 : 503).json({
      status: healthy ? "ok" : "degraded",
      checks: results,
    });
  });

  return router;
}
