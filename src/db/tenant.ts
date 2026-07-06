/**
 * `TenantScopedRepository` — a `BaseRepository` that can't leak across tenants,
 * mirroring `db.tenant`.
 *
 * In a shared-schema multi-tenant database every tenant's rows live in the same
 * table, told apart by a `tenantId` column. Forget one `WHERE tenant_id = ?` and
 * tenant A reads (or deletes) tenant B's data. This repository binds a tenant id
 * at construction and injects it into every read filter and every write — the
 * scoping is invisible at the call site.
 */

import {
  BaseRepository,
  type InferInsert,
  type InferModel,
  type ModelClass,
  type PaginationFilter,
  type PaginationResult,
  RecordNotFound,
  type WhereInput,
} from "tempest-db-js";

/**
 * A repository whose every operation is scoped to a single tenant. Use it
 * exactly like {@link BaseRepository}.
 *
 * ```ts
 * const repo = new TenantScopedRepository(OrderModel, session, tenantId);
 * await repo.list();                 // WHERE tenant_id = tenantId
 * await repo.create({ total: "10" }); // tenant_id stamped automatically
 * ```
 *
 * @typeParam C - the model class (must declare the tenant column).
 */
export class TenantScopedRepository<
  C extends ModelClass,
  TF extends string = "tenantId",
> extends BaseRepository<C> {
  private readonly tenantId: unknown;
  private readonly tenantField: string;
  private readonly modelClass: C;

  /**
   * @param model - The model class (must have the `tenantField` column).
   * @param session - The async session.
   * @param tenantId - The tenant every operation is scoped to.
   * @param tenantField - Name of the tenant column. Default `"tenantId"`.
   */
  constructor(
    model: C,
    session: ConstructorParameters<typeof BaseRepository<C>>[1],
    tenantId: unknown,
    tenantField: TF = "tenantId" as TF,
  ) {
    super(model, session);
    this.modelClass = model;
    this.tenantId = tenantId;
    this.tenantField = tenantField;
  }

  /** Merge the tenant predicate into a filter object. */
  private scoped(filters?: WhereInput<InferModel<C>>): WhereInput<InferModel<C>> {
    return { ...(filters ?? {}), [this.tenantField]: this.tenantId } as WhereInput<
      InferModel<C>
    >;
  }

  /** Stamp the tenant id onto an insert payload. */
  private stamped<T extends Record<string, unknown>>(data: T): T {
    return { ...data, [this.tenantField]: this.tenantId };
  }

  override list(filters?: WhereInput<InferModel<C>>): Promise<InferModel<C>[]> {
    return super.list(this.scoped(filters));
  }

  override first(filters?: WhereInput<InferModel<C>>): Promise<InferModel<C> | null> {
    return super.first(this.scoped(filters));
  }

  override exists(filters: WhereInput<InferModel<C>>): Promise<boolean> {
    return super.exists(this.scoped(filters));
  }

  override count(filters?: WhereInput<InferModel<C>>): Promise<number> {
    return super.count(this.scoped(filters));
  }

  /** Fetch by id **within the tenant**; throws `RecordNotFound` across tenants. */
  override async getById(id: unknown): Promise<InferModel<C>> {
    const row = await super.first(this.scoped({ id } as WhereInput<InferModel<C>>));
    if (row === null) {
      throw new RecordNotFound(
        (this.modelClass as { tablename?: string }).tablename ?? "row",
        id,
      );
    }
    return row;
  }

  override getByIdOrNull(id: unknown): Promise<InferModel<C> | null> {
    return super.first(this.scoped({ id } as WhereInput<InferModel<C>>));
  }

  /** Insert one row; the tenant id is stamped for you (don't pass it). */
  override create(data: Omit<InferInsert<C>, TF>): Promise<InferModel<C>> {
    return super.create(this.stamped(data as Record<string, unknown>) as InferInsert<C>);
  }

  /** Insert many rows; the tenant id is stamped onto each. */
  override createMany(
    data: readonly Omit<InferInsert<C>, TF>[],
  ): Promise<InferModel<C>[]> {
    return super.createMany(
      data.map((d) => this.stamped(d as Record<string, unknown>) as InferInsert<C>),
    );
  }

  override update(
    filters: WhereInput<InferModel<C>>,
    set: Partial<InferModel<C>>,
  ): Promise<number> {
    // Never let a caller move a row to another tenant.
    const { [this.tenantField]: _drop, ...safeSet } = set as Record<string, unknown>;
    return super.update(this.scoped(filters), safeSet as Partial<InferModel<C>>);
  }

  override delete(filters: WhereInput<InferModel<C>>): Promise<number> {
    return super.delete(this.scoped(filters));
  }

  override paginate(
    filter: PaginationFilter<InferModel<C>> = {},
  ): Promise<PaginationResult<InferModel<C>>> {
    return super.paginate({ ...filter, filters: this.scoped(filter.filters) });
  }
}
