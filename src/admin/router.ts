/**
 * Admin JSON router, mirroring `admin.router.make_admin_router`.
 *
 * Exposes auto-derived CRUD + introspection over an {@link AdminSite}:
 *
 * ```text
 * GET    {prefix}/                    site brand + resource list
 * GET    {prefix}/:resource/_meta     resource field descriptors
 * GET    {prefix}/:resource           paginated list
 * GET    {prefix}/:resource/:id       detail (404 when absent)
 * POST   {prefix}/:resource           create (405 if unsupported)
 * PATCH  {prefix}/:resource/:id        update (405 if unsupported)
 * DELETE {prefix}/:resource/:id        delete (405 if unsupported)
 * ```
 *
 * Pass a `guard` middleware (e.g. JWT + `requireRoles("admin")`) to protect it.
 */

import type { AdminResource, AdminSite } from "@/admin/site";
import { AppException } from "@/exceptions/base";
import { NotFoundException } from "@/exceptions/http";
import { type RequestHandler, type Router, Router as createRouter } from "express";

const PAGINATION_KEYS = new Set(["page", "pageSize"]);

/** Options for {@link makeAdminRouter}. */
export interface AdminRouterOptions {
  /** Route prefix. Default `/admin`. */
  prefix?: string;
  /** Guard middleware applied to every admin route (auth). */
  guard?: RequestHandler;
}

/** Raised (405) when a resource does not support a write operation. */
function methodNotAllowed(operation: string): AppException {
  return new AppException({
    message: `Operation not allowed: ${operation}`,
    code: "METHOD_NOT_ALLOWED",
    statusCode: 405,
  });
}

/** Resolve a resource by slug or raise 404. */
function requireResource(site: AdminSite, name: string): AdminResource {
  const resource = site.get(name);
  if (!resource) throw new NotFoundException({ message: `Unknown resource: ${name}` });
  return resource;
}

/**
 * Build the admin router.
 *
 * @param site - The registered {@link AdminSite}.
 * @param options - Prefix and guard middleware.
 * @returns An Express router with the admin endpoints mounted.
 */
export function makeAdminRouter(
  site: AdminSite,
  options: AdminRouterOptions = {},
): Router {
  const prefix = (options.prefix ?? "/admin").replace(/\/$/, "");
  const router = createRouter();
  if (options.guard) router.use(prefix, options.guard);

  router.get(prefix, (_req, res) => {
    res.json({
      brand: site.brand,
      resources: site.list().map((r) => ({ name: r.name, fields: r.fields })),
    });
  });

  router.get(`${prefix}/:resource/_meta`, (req, res) => {
    const resource = requireResource(site, req.params.resource);
    res.json({
      name: resource.name,
      fields: resource.fields,
      operations: {
        create: Boolean(resource.create),
        update: Boolean(resource.update),
        remove: Boolean(resource.remove),
      },
    });
  });

  router.get(`${prefix}/:resource`, async (req, res) => {
    const resource = requireResource(site, req.params.resource);
    const filters: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.query)) {
      if (!PAGINATION_KEYS.has(key) && typeof value === "string") filters[key] = value;
    }
    const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
    const pageSize = Math.max(
      1,
      Number.parseInt(String(req.query.pageSize ?? "20"), 10) || 20,
    );
    res.json(await resource.list({ page, pageSize, filters }));
  });

  router.get(`${prefix}/:resource/:id`, async (req, res) => {
    const resource = requireResource(site, req.params.resource);
    const record = await resource.get(req.params.id);
    if (record === null) throw new NotFoundException({ message: "Record not found" });
    res.json(record);
  });

  router.post(`${prefix}/:resource`, async (req, res) => {
    const resource = requireResource(site, req.params.resource);
    if (!resource.create) throw methodNotAllowed("create");
    const data = resource.createSchema ? resource.createSchema.parse(req.body) : req.body;
    res.status(201).json(await resource.create(data));
  });

  router.patch(`${prefix}/:resource/:id`, async (req, res) => {
    const resource = requireResource(site, req.params.resource);
    if (!resource.update) throw methodNotAllowed("update");
    const data = resource.updateSchema ? resource.updateSchema.parse(req.body) : req.body;
    res.json(await resource.update(req.params.id, data));
  });

  router.delete(`${prefix}/:resource/:id`, async (req, res) => {
    const resource = requireResource(site, req.params.resource);
    if (!resource.remove) throw methodNotAllowed("remove");
    await resource.remove(req.params.id);
    res.status(204).end();
  });

  return router;
}
