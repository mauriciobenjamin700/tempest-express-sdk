/**
 * Prometheus `/metrics` router, mirroring `api.routers.metrics`.
 *
 * Serves {@link MetricsUtils.toPrometheus} as `text/plain`. Optionally includes
 * GPU metrics (via `nvidia-smi`) and can be guarded so the endpoint stays on the
 * internal network / behind auth.
 */

import { MetricsUtils } from "@/utils/metrics";
import { type RequestHandler, type Router, Router as createRouter } from "express";

/** Options for {@link makeMetricsRouter}. */
export interface MetricsRouterOptions {
  /** Route path. Default `/metrics`. */
  path?: string;
  /** Include GPU metrics via `nvidia-smi` (adds a subprocess call). Default `false`. */
  includeGpu?: boolean;
  /** Optional guard middleware (e.g. internal-network or token check). */
  guard?: RequestHandler;
}

/**
 * Build the Prometheus metrics router.
 *
 * @param options - Path, GPU toggle and optional guard.
 * @returns An Express router exposing the metrics endpoint.
 */
export function makeMetricsRouter(options: MetricsRouterOptions = {}): Router {
  const path = options.path ?? "/metrics";
  const router = createRouter();
  if (options.guard) router.use(path, options.guard);

  router.get(path, async (_req, res) => {
    const gpus = options.includeGpu ? await MetricsUtils.gpus() : [];
    res.type("text/plain").send(MetricsUtils.toPrometheus(MetricsUtils.system(), gpus));
  });

  return router;
}
