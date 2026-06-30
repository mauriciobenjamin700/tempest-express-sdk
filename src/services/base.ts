/**
 * Generic async service over a `tempest-db-js` repository.
 *
 * Mirrors `services.base.BaseService`: a thin business-logic layer wrapping a
 * `BaseRepository`. Unlike a pure pass-through, every read method maps the raw
 * ORM row through {@link ResponseMapper} into the response shape routers and
 * controllers consume — that mapping is the layer's reason to exist. Override
 * methods that need orchestration (multi-repository writes, side effects,
 * domain rules); leave the rest.
 */

import type {
  BaseRepository,
  InferInsert,
  InferModel,
  ModelClass,
  PaginationResult,
  RepositoryPaginationFilter,
  WhereInput,
} from "@/db";

/** Maps a raw ORM row to the response shape (sync or async). */
export type ResponseMapper<C extends ModelClass, Resp> = (
  row: InferModel<C>,
) => Resp | Promise<Resp>;

export class BaseService<C extends ModelClass, Resp> {
  /**
   * @param repository - The repository to delegate persistence to.
   * @param mapToResponse - Maps a raw row to the response shape.
   */
  constructor(
    protected readonly repository: BaseRepository<C>,
    protected readonly mapToResponse: ResponseMapper<C, Resp>,
  ) {}

  /** Map a batch of rows to responses, preserving order. */
  protected mapMany(rows: InferModel<C>[]): Promise<Resp[]> {
    return Promise.all(rows.map((row) => this.mapToResponse(row)));
  }

  /**
   * Fetch a single record by primary key and map it.
   *
   * @param id - The primary-key value.
   * @returns The mapped response.
   * @throws {RecordNotFound} When no row matches (404 convention).
   */
  async getById(id: unknown): Promise<Resp> {
    return this.mapToResponse(await this.repository.getById(id));
  }

  /**
   * List records matching `filters` (or all), mapped to responses.
   *
   * @param filters - Optional filter conditions.
   * @returns The mapped responses; `[]` when nothing matches.
   */
  async list(filters?: WhereInput<InferModel<C>>): Promise<Resp[]> {
    return this.mapMany(await this.repository.list(filters));
  }

  /**
   * Count records matching `filters` (or the whole table).
   *
   * @param filters - Optional filter conditions.
   * @returns The matching row count.
   */
  async count(filters?: WhereInput<InferModel<C>>): Promise<number> {
    return this.repository.count(filters);
  }

  /**
   * Insert one record and map the created row.
   *
   * @param data - The insert payload.
   * @returns The mapped, created response.
   */
  async create(data: InferInsert<C>): Promise<Resp> {
    return this.mapToResponse(await this.repository.create(data));
  }

  /**
   * Update records matching `filters`.
   *
   * @param filters - Which rows to update.
   * @param set - The partial column values to write.
   * @returns The number of rows affected.
   */
  async update(
    filters: WhereInput<InferModel<C>>,
    set: Partial<InferModel<C>>,
  ): Promise<number> {
    return this.repository.update(filters, set);
  }

  /**
   * Delete records matching `filters`.
   *
   * @param filters - Which rows to delete.
   * @returns The number of rows affected.
   */
  async delete(filters: WhereInput<InferModel<C>>): Promise<number> {
    return this.repository.delete(filters);
  }

  /**
   * Fetch a page of records with the items mapped to responses.
   *
   * @param filter - Page, size, ordering and filters.
   * @returns The page envelope with mapped items.
   */
  async paginate(
    filter: RepositoryPaginationFilter<InferModel<C>> = {},
  ): Promise<PaginationResult<Resp>> {
    const page = await this.repository.paginate(filter);
    return { ...page, items: await this.mapMany(page.items) };
  }
}
