/**
 * Generic controller bridging routers and services.
 *
 * Mirrors `controllers.base.BaseController`. Per the SDK layering
 * (router → controller → service → repository), controllers are an intentional
 * abstraction boundary kept present even when no orchestration is required, so
 * the import graph stays uniform across services. Override a method when one
 * endpoint must call several services or apply cross-cutting policy; otherwise
 * the thin delegations stand in for the boundary.
 */

import type {
  InferInsert,
  InferModel,
  ModelClass,
  PaginationResult,
  RepositoryPaginationFilter,
  WhereInput,
} from "@/db";
import type { BaseService } from "@/services/base";

export class BaseController<C extends ModelClass, Resp> {
  /**
   * @param service - The service the controller delegates to.
   */
  constructor(protected readonly service: BaseService<C, Resp>) {}

  /**
   * Fetch one record by primary key.
   *
   * @param id - The primary-key value.
   * @returns The mapped response.
   */
  getById(id: unknown): Promise<Resp> {
    return this.service.getById(id);
  }

  /**
   * List records matching `filters`.
   *
   * @param filters - Optional filter conditions.
   * @returns The mapped responses.
   */
  list(filters?: WhereInput<InferModel<C>>): Promise<Resp[]> {
    return this.service.list(filters);
  }

  /**
   * Count records matching `filters`.
   *
   * @param filters - Optional filter conditions.
   * @returns The matching row count.
   */
  count(filters?: WhereInput<InferModel<C>>): Promise<number> {
    return this.service.count(filters);
  }

  /**
   * Create a record.
   *
   * @param data - The insert payload.
   * @returns The mapped, created response.
   */
  create(data: InferInsert<C>): Promise<Resp> {
    return this.service.create(data);
  }

  /**
   * Update records matching `filters`.
   *
   * @param filters - Which rows to update.
   * @param set - The partial column values to write.
   * @returns The number of rows affected.
   */
  update(
    filters: WhereInput<InferModel<C>>,
    set: Partial<InferModel<C>>,
  ): Promise<number> {
    return this.service.update(filters, set);
  }

  /**
   * Delete records matching `filters`.
   *
   * @param filters - Which rows to delete.
   * @returns The number of rows affected.
   */
  delete(filters: WhereInput<InferModel<C>>): Promise<number> {
    return this.service.delete(filters);
  }

  /**
   * Fetch a page of records.
   *
   * @param filter - Page, size, ordering and filters.
   * @returns The page envelope with mapped items.
   */
  paginate(
    filter: RepositoryPaginationFilter<InferModel<C>> = {},
  ): Promise<PaginationResult<Resp>> {
    return this.service.paginate(filter);
  }
}
