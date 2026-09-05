/**
 * Headless admin: resource registry for the JSON admin API.
 *
 * The counterpart to the server-rendered panel in `@/admin/site`. Register one
 * {@link AdminJsonResource} per managed entity and {@link makeAdminJsonRouter}
 * exposes auto-derived CRUD + introspection endpoints your own frontend
 * (React, etc.) renders. Resources are callback-based, so they wire to a
 * `BaseService` — or any store — in a few lines and stay ORM-agnostic.
 *
 * Reach for this when the UI is yours; reach for {@link AdminSite} +
 * `makeAdminRouter` when you want the batteries-included HTML panel.
 */

import type { z } from "@/schemas/base";

/** A field descriptor a frontend uses to render list columns / form inputs. */
export interface AdminJsonField {
  /** Field name (property key). */
  name: string;
  /** Loose type hint for rendering (`string`, `number`, `boolean`, `date`, …). */
  type?: string;
  /** Whether the field is required on create. */
  required?: boolean;
  /** Whether the field is read-only (shown, never submitted). */
  readOnly?: boolean;
}

/** A paginated list result returned by {@link AdminJsonResource.list}. */
export interface AdminJsonListResult<T = unknown> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

/** Query parameters passed to {@link AdminJsonResource.list}. */
export interface AdminJsonListQuery {
  page: number;
  pageSize: number;
  /** Remaining query-string entries (domain filters). */
  filters: Record<string, string>;
}

/**
 * A managed resource. Only `name`, `fields` and `list`/`get` are required;
 * omit a write callback to make that operation unavailable (405).
 */
export interface AdminJsonResource<T = unknown> {
  /** URL-safe resource slug (e.g. `users`). */
  name: string;
  /** Field descriptors for list/detail/form rendering. */
  fields: AdminJsonField[];
  /** Return a page of records. */
  list(query: AdminJsonListQuery): Promise<AdminJsonListResult<T>>;
  /** Return one record by id, or `null` when absent. */
  get(id: string): Promise<T | null>;
  /** Create a record from validated input. */
  create?(data: unknown): Promise<T>;
  /** Update a record by id from validated input. */
  update?(id: string, data: unknown): Promise<T>;
  /** Delete a record by id. */
  remove?(id: string): Promise<void>;
  /** Zod schema validating the create body. */
  createSchema?: z.ZodType;
  /** Zod schema validating the update body. */
  updateSchema?: z.ZodType;
}

/** A registry of admin resources. */
export class AdminJsonSite {
  private readonly resources = new Map<string, AdminJsonResource>();

  /**
   * @param brand - Display name surfaced under `GET {prefix}/`.
   */
  constructor(readonly brand = "Admin") {}

  /**
   * Register a resource.
   *
   * @param resource - The resource config.
   * @returns The same resource (for chaining).
   */
  register<T>(resource: AdminJsonResource<T>): AdminJsonResource<T> {
    this.resources.set(resource.name, resource as AdminJsonResource);
    return resource;
  }

  /** Look up a resource by slug, or `null`. */
  get(name: string): AdminJsonResource | null {
    return this.resources.get(name) ?? null;
  }

  /** Every registered resource. */
  list(): AdminJsonResource[] {
    return [...this.resources.values()];
  }
}
