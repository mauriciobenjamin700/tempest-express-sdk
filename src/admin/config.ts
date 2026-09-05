/**
 * Declarative admin configuration for one model, mirroring `admin.config`.
 *
 * Instantiate one {@link AdminModel} per managed model and hand it to
 * {@link AdminSite.register}. Unlike Django's class-based `ModelAdmin` this is
 * a plain typed instance — the constructor options are the contract, there is
 * no metaclass magic, and every default is derived from the model's own column
 * metadata so an unconfigured model is already browsable.
 */

import type { AdminAction } from "@/admin/actions";
import { adminColumns, humanizeField } from "@/admin/columns";
import {
  type AsyncSession,
  BaseRepository,
  type InferModel,
  type ModelClass,
} from "@/db";

/** Column keys the generic form never edits, whatever the model declares. */
const NEVER_EDITABLE: readonly string[] = [
  "id",
  "createdAt",
  "updatedAt",
  "hashedPassword",
];

/** Column keys hidden from the list view unless `listDisplay` says otherwise. */
const NEVER_LISTED: readonly string[] = ["hashedPassword"];

/** Configuration accepted by {@link AdminModel}. */
export interface AdminModelOptions<C extends ModelClass> {
  /** The model class to manage. */
  model: C;
  /** URL slug. Defaults to the model's `tablename`, so URLs track tables. */
  slug?: string;
  /** Columns shown in the list view. Defaults to every column but the password hash. */
  listDisplay?: readonly string[];
  /** Columns surfaced as filter controls above the list. */
  listFilter?: readonly string[];
  /** Text columns searched with `LIKE '%value%'` by the search box. */
  searchFields?: readonly string[];
  /** Columns shown but never editable in the create/edit form. */
  readonlyFields?: readonly string[];
  /** Default ordering: a column key, or `-column` for descending. */
  ordering?: string;
  /** Rows per page in the list view. Default `25`. */
  pageSize?: number;
  /** Column used to look one row up from the detail URL. Default `"id"`. */
  identityField?: string;
  /** Singular display name. Defaults to the humanized class name. */
  verboseName?: string;
  /** Plural display name. Defaults to `verboseName` + `"s"`. */
  verboseNamePlural?: string;
  /** Whether the create form + POST endpoint are exposed. Default `true`. */
  canCreate?: boolean;
  /** Whether the edit form + POST endpoint are exposed. Default `true`. */
  canEdit?: boolean;
  /** Whether the delete action is exposed. Default `true`. */
  canDelete?: boolean;
  /**
   * Custom bulk actions, built with `adminAction`. Each one joins the list
   * view's action dropdown alongside the built-in activate / deactivate /
   * delete and runs against the checked rows.
   */
  actions?: readonly AdminAction<C>[];
}

/**
 * The admin configuration for one model.
 *
 * ```ts
 * new AdminModel({
 *   model: UserModel,
 *   listDisplay: ["email", "isAdmin", "isActive", "createdAt"],
 *   listFilter: ["isActive", "isAdmin"],
 *   searchFields: ["email"],
 *   ordering: "-createdAt",
 * });
 * ```
 */
export class AdminModel<C extends ModelClass = ModelClass> {
  /** The managed model class. */
  readonly model: C;
  /** Columns surfaced as filter controls. */
  readonly listFilter: string[];
  /** Text columns the search box matches against. */
  readonly searchFields: string[];
  /** Columns locked in the create/edit form. */
  readonlyFields: string[];
  /** Default ordering column, or `null` to leave it to the repository. */
  readonly orderKey: string | null;
  /** Whether {@link AdminModel.orderKey} sorts ascending. */
  readonly orderAscending: boolean;
  /** Rows per page in the list view. */
  readonly pageSize: number;
  /** Column used to look a single row up from the detail URL. */
  readonly identityField: string;
  /** Whether the create form is exposed. */
  readonly canCreate: boolean;
  /** Whether the edit form is exposed. */
  readonly canEdit: boolean;
  /** Whether the delete action is exposed. */
  readonly canDelete: boolean;

  private readonly actions = new Map<string, AdminAction>();
  private readonly slugOverride: string | null;
  private readonly listDisplayOverride: string[] | null;
  private readonly verboseNameOverride: string | null;
  private readonly verboseNamePluralOverride: string | null;

  /**
   * Build and validate the configuration.
   *
   * @param options - The declarative configuration. See {@link AdminModelOptions}.
   * @throws Error When a referenced column does not exist on the model.
   */
  constructor(options: AdminModelOptions<C>) {
    this.model = options.model;
    this.slugOverride = options.slug ?? null;
    this.listDisplayOverride =
      options.listDisplay === undefined ? null : [...options.listDisplay];
    this.listFilter = [...(options.listFilter ?? [])];
    this.searchFields = [...(options.searchFields ?? [])];
    this.readonlyFields = [...(options.readonlyFields ?? [])];
    this.pageSize = options.pageSize ?? 25;
    this.identityField = options.identityField ?? "id";
    this.verboseNameOverride = options.verboseName ?? null;
    this.verboseNamePluralOverride = options.verboseNamePlural ?? null;
    this.canCreate = options.canCreate ?? true;
    this.canEdit = options.canEdit ?? true;
    this.canDelete = options.canDelete ?? true;

    for (const action of options.actions ?? []) {
      if (this.actions.has(action.name)) {
        throw new Error(
          `Duplicate admin action name "${action.name}" on ${this.model.tablename}`,
        );
      }
      this.actions.set(action.name, action as AdminAction);
    }

    const known = new Set(this.columnNames());
    for (const [option, names] of [
      ["listDisplay", this.listDisplayOverride ?? []],
      ["listFilter", this.listFilter],
      ["searchFields", this.searchFields],
      ["readonlyFields", this.readonlyFields],
      ["identityField", [this.identityField]],
    ] as const) {
      for (const name of names) {
        if (!known.has(name)) {
          throw new Error(
            `AdminModel(${this.model.tablename}).${option} references unknown column ` +
              `"${name}"; available: ${[...known].join(", ")}`,
          );
        }
      }
    }

    const ordering =
      options.ordering ?? (known.has("createdAt") ? "-createdAt" : undefined);
    if (ordering === undefined) {
      this.orderKey = null;
      this.orderAscending = true;
    } else {
      const descending = ordering.startsWith("-");
      const key = descending ? ordering.slice(1) : ordering;
      if (!known.has(key)) {
        throw new Error(
          `AdminModel(${this.model.tablename}).ordering references unknown column "${key}"`,
        );
      }
      this.orderKey = key;
      this.orderAscending = !descending;
    }
  }

  /**
   * Return the URL slug the model is exposed under.
   *
   * @returns The configured slug, or the model's table name.
   */
  slug(): string {
    return this.slugOverride ?? this.model.tablename;
  }

  /**
   * Return the singular display name.
   *
   * @returns The configured name, or the humanized class name without its
   *   trailing `Model`.
   */
  verboseName(): string {
    if (this.verboseNameOverride !== null) return this.verboseNameOverride;
    const className = (this.model as unknown as { name: string }).name;
    return humanizeField(className.replace(/Model$/, ""));
  }

  /**
   * Return the plural display name.
   *
   * @returns The configured plural, or the singular with an `s`.
   */
  verboseNamePlural(): string {
    return this.verboseNamePluralOverride ?? `${this.verboseName()}s`;
  }

  /**
   * Return every column key on the model, in declaration order.
   *
   * @returns The column keys.
   */
  columnNames(): string[] {
    return Object.keys(adminColumns(this.model));
  }

  /**
   * Return the columns the list view renders.
   *
   * @returns The configured `listDisplay`, or every column but the password hash.
   */
  listDisplayNames(): string[] {
    if (this.listDisplayOverride !== null) return [...this.listDisplayOverride];
    return this.columnNames().filter((name) => !NEVER_LISTED.includes(name));
  }

  /**
   * Return the columns the detail view renders.
   *
   * Unlike {@link AdminModel.listDisplayNames}, this is not narrowed by
   * `listDisplay`: the list view is a scannable summary, but the detail view is
   * where an operator goes to see the whole record, so trimming it there would
   * hide data with nowhere else to read it.
   *
   * @returns Every column but the password hash, in declaration order.
   */
  detailFieldNames(): string[] {
    return this.columnNames().filter((name) => !NEVER_LISTED.includes(name));
  }

  /**
   * Return the columns a create/edit form exposes.
   *
   * Excludes the primary key, the managed timestamps, the password hash and
   * anything listed in `readonlyFields` — none of which a user edits directly
   * through the generic form.
   *
   * @returns The editable column keys, in declaration order.
   */
  editableFieldNames(): string[] {
    const skip = new Set([...this.readonlyFields, ...NEVER_EDITABLE]);
    return this.columnNames().filter((name) => !skip.has(name));
  }

  /**
   * Return the registered custom actions, in declaration order.
   *
   * @returns The actions passed via `actions` (empty when none). The model
   *   type is erased here, the way {@link AdminSite} erases it when it stores a
   *   configuration — a registry keyed by slug cannot stay generic.
   */
  customActions(): AdminAction[] {
    return [...this.actions.values()];
  }

  /**
   * Look a custom action up by name.
   *
   * @param name - The action identifier (its submitted form value).
   * @returns The action, or `null` when nothing matches.
   */
  getAction(name: string): AdminAction | null {
    return this.actions.get(name) ?? null;
  }

  /**
   * Build a repository for this model bound to a session.
   *
   * @param session - The session the repository runs its statements on.
   * @returns A repository over {@link AdminModel.model}.
   */
  repository(session: AsyncSession): BaseRepository<C> {
    return new BaseRepository(this.model, session);
  }
}

/** The row type a configured {@link AdminModel} reads and writes. */
export type AdminRow<A> = A extends AdminModel<infer C> ? InferModel<C> : never;
