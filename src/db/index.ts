/**
 * Database layer — re-exports `tempest-db-js`.
 *
 * The DB foundation (declarative models, typed columns, query/mutation
 * builders, the async engine and `BaseRepository`) is owned by `tempest-db-js`.
 * This SDK re-exports its public surface so consumers import everything from a
 * single place (`tempest-express-sdk`) and the service/controller layer below
 * can build on a typed `BaseRepository`.
 *
 * `tempest-db-js` is a required peer dependency — install it alongside this
 * SDK (`npm i tempest-express-sdk tempest-db-js`).
 */

export {
  BaseModel,
  createdByColumn,
  deletedAtColumn,
  tableNameFor,
  updatedByColumn,
} from "@/db/model";

export {
  AsyncEngine,
  AsyncResult,
  AsyncSession,
  type AsyncDriver,
  BaseRepository,
  type BelongsTo,
  type ColType,
  Column,
  type ColumnFlags,
  type CompiledQuery,
  type CondNode,
  type Condition,
  type Dialect,
  DeleteBuilder,
  type DeleteNode,
  type EngineOptions,
  type Executable,
  type HasMany,
  type InferInsert,
  type InferModel,
  InsertBuilder,
  type InsertNode,
  Model,
  type ModelClass,
  NodeSqliteDriver,
  NoResultError,
  type Operator,
  type OrderTerm,
  type PaginationFilter as RepositoryPaginationFilter,
  type PaginationResult,
  type ParsedDatabaseUrl,
  PostgresDialect,
  type QueryNode,
  RecordNotFound,
  type Relation,
  type RelationValue,
  type Returning,
  type RowOf,
  type SelectNode,
  SelectBuilder,
  type SortDirection,
  SqliteDialect,
  SyncEngine,
  SyncSession,
  UpdateBuilder,
  type UpdateNode,
  type WhereArg,
  type WhereInput,
  type WithRelations,
  and,
  belongsTo,
  column,
  columnsOf,
  createEngine,
  createSyncEngine,
  del,
  detectDialect,
  getDialect,
  hasMany,
  insert,
  join,
  loadRelations,
  not,
  or,
  parseDatabaseUrl,
  select,
  sql,
  update,
} from "tempest-db-js";
