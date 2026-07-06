/**
 * `makeToolSpecRouter` — a machine-readable capability manifest at the root
 * prefix, mirroring `api.routers.tool_spec`.
 *
 * Services expose a small manifest so callers discover capabilities without
 * parsing the full OpenAPI document. Pass a static object, a sync provider, or
 * an async provider (recomputed per request).
 */

import { Router } from "express";

/** The manifest, or a (possibly async) provider of it. */
export type SpecProvider =
  | Record<string, unknown>
  | (() => Record<string, unknown>)
  | (() => Promise<Record<string, unknown>>);

/** Options for {@link makeToolSpecRouter}. */
export interface ToolSpecOptions {
  /** Endpoint path. Default `"/tool-spec"`. */
  path?: string;
}

/**
 * Build a router serving the manifest at a root-prefix `GET` route.
 *
 * @param spec - A static object or a sync/async provider.
 * @param options - The endpoint path.
 * @returns An Express router with a single `GET` route.
 */
export function makeToolSpecRouter(
  spec: SpecProvider,
  options: ToolSpecOptions = {},
): Router {
  const router = Router();
  const path = options.path ?? "/tool-spec";

  router.get(path, (_req, res, next) => {
    Promise.resolve(typeof spec === "function" ? spec() : spec)
      .then((result) => res.json(result))
      .catch(next);
  });

  return router;
}
