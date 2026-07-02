/**
 * Admin site + resource registry, mirroring `admin.site` / `admin.config`.
 *
 * The FastAPI SDK ships a server-rendered (jinja) admin UI. Here the admin is a
 * typed **JSON API**: register one {@link AdminResource} per managed entity and
 * {@link makeAdminRouter} exposes auto-derived CRUD + introspection endpoints a
 * frontend (React, etc.) renders. Resources are callback-based, so they wire to
 * a `BaseService` — or any store — in a few lines and stay ORM-agnostic.
 */

import type { z } from "@/schemas/base";

/** A field descriptor a frontend uses to render list columns / form inputs. */
export interface AdminField {
  /** Field name (property key). */
  name: string;
  /** Loose type hint for rendering (`string`, `number`, `boolean`, `date`, …). */
  type?: string;
  /** Whether the field is required on create. */
  required?: boolean;
  /** Whether the field is read-only (shown, never submitted). */
  readOnly?: boolean;
}

/** A paginated list result returned by {@link AdminResource.list}. */
export interface AdminListResult<T = unknown> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

/** Query parameters passed to {@link AdminResource.list}. */
export interface AdminListQuery {
  page: number;
  pageSize: number;
  /** Remaining query-string entries (domain filters). */
  filters: Record<string, string>;
}

/**
 * A managed resource. Only `name`, `fields` and `list`/`get` are required;
 * omit a write callback to make that operation unavailable (405).
 */
export interface AdminResource<T = unknown> {
  /** URL-safe resource slug (e.g. `users`). */
  name: string;
  /** Field descriptors for list/detail/form rendering. */
  fields: AdminField[];
  /** Return a page of records. */
  list(query: AdminListQuery): Promise<AdminListResult<T>>;
  /** Return one record by id, or `null` when absent. */
  get(id: string): Promise<T | null>;
  /** Create a record from validated input. */
  create?(data: unknown): Promise<T>;
  /** Update a record by id from validated input. */
  update?(id: string, data: unknown): Promise<T>;
  /** Delete a record by id. */
  remove?(id: string): Promise<void>;
  /** Zod schema validating the create body. */
  createSchema?: z.ZodTypeAny;
  /** Zod schema validating the update body. */
  updateSchema?: z.ZodTypeAny;
}

/** A registry of admin resources. */
export class AdminSite {
  private readonly resources = new Map<string, AdminResource>();

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
  register<T>(resource: AdminResource<T>): AdminResource<T> {
    this.resources.set(resource.name, resource as AdminResource);
    return resource;
  }

  /** Look up a resource by slug, or `null`. */
  get(name: string): AdminResource | null {
    return this.resources.get(name) ?? null;
  }

  /** Every registered resource. */
  list(): AdminResource[] {
    return [...this.resources.values()];
  }
}
