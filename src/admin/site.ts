/**
 * Admin site registry, mirroring `admin.site` — the analog of Django's
 * `AdminSite`.
 *
 * A project instantiates one site, registers its {@link AdminModel}
 * configurations (one at a time with {@link AdminSite.register}, or all at
 * once with {@link AdminSite.automap}), and hands the site to
 * `makeAdminRouter`.
 */

import { AdminModel, type AdminModelOptions } from "@/admin/config";
import type { AdminTheme } from "@/admin/theme";
import { Model, type ModelClass } from "@/db";

/** Branding and appearance options for an {@link AdminSite}. */
export interface AdminSiteOptions {
  /** Text used in the page `<title>` and the dashboard heading. Default `"Admin"`. */
  title?: string;
  /** Centered header brand. Falls back to `title`. */
  brand?: string;
  /** Dashboard subtitle. Default `"Site administration"`. */
  indexSubtitle?: string;
  /** Optional outbound "View site" link rendered in the header. */
  siteUrl?: string;
  /** Typed appearance overrides. Omitted keeps the stock look. */
  theme?: AdminTheme;
}

/** Options accepted by {@link AdminSite.automap}. */
export interface AdminAutomapOptions
  extends Omit<AdminModelOptions<ModelClass>, "model"> {
  /** Models to skip — each entry is the model class or its table name. */
  exclude?: readonly (ModelClass | string)[];
  /**
   * When `true` (default), a model whose slug is already registered is left
   * untouched, so a hand-tuned {@link AdminModel} can be registered first.
   * When `false`, a collision throws, as {@link AdminSite.register} does.
   */
  skipRegistered?: boolean;
}

/**
 * Whether a value is a usable model class — a constructor extending `Model`
 * that declares a non-empty `tablename`.
 *
 * Abstract bases (`BaseModel`, `BaseUserModel` and friends) declare no table
 * name, so they are filtered out exactly as the Python `automap` skips them.
 *
 * @param value - The candidate value, typically a module namespace entry.
 * @returns `true` when the value can be registered.
 */
function isConcreteModel(value: unknown): value is ModelClass {
  if (typeof value !== "function") return false;
  const proto: unknown = (value as { prototype?: unknown }).prototype;
  if (typeof proto !== "object" || proto === null) return false;
  if (!(proto instanceof Model)) return false;
  const tablename: unknown = (value as { tablename?: unknown }).tablename;
  return typeof tablename === "string" && tablename.length > 0;
}

/**
 * The registry of {@link AdminModel} configurations a panel exposes.
 *
 * ```ts
 * const site = new AdminSite({ title: "MyApp Admin", brand: "myapp-admin" });
 * site.register({ model: UserModel, searchFields: ["email"] });
 * site.automap(models);
 * ```
 */
export class AdminSite {
  /** Text used in the page `<title>` and the dashboard heading. */
  readonly title: string;
  /** Centered header brand, or `null` to fall back to {@link AdminSite.title}. */
  readonly brand: string | null;
  /** Dashboard subtitle. */
  readonly indexSubtitle: string;
  /** Outbound "View site" link, or `null`. */
  readonly siteUrl: string | null;
  /** Typed appearance overrides. */
  readonly theme: AdminTheme;

  private readonly registry = new Map<string, AdminModel>();

  /**
   * Initialize the site.
   *
   * @param options - Branding and appearance. See {@link AdminSiteOptions}.
   */
  constructor(options: AdminSiteOptions = {}) {
    this.title = options.title ?? "Admin";
    this.brand = options.brand ?? null;
    this.indexSubtitle = options.indexSubtitle ?? "Site administration";
    this.siteUrl = options.siteUrl ?? null;
    this.theme = options.theme ?? {};
  }

  /**
   * Return the centered header brand text.
   *
   * @returns {@link AdminSite.brand} when set, otherwise {@link AdminSite.title}.
   */
  brandText(): string {
    return this.brand ?? this.title;
  }

  /**
   * Register a model configuration under its slug.
   *
   * @param admin - An {@link AdminModel} instance, or the options to build one.
   * @returns The registered instance, so the call can be chained or assigned.
   * @throws Error When another configuration already holds the same slug.
   */
  register<C extends ModelClass>(
    admin: AdminModel<C> | AdminModelOptions<C>,
  ): AdminModel<C> {
    const config = admin instanceof AdminModel ? admin : new AdminModel(admin);
    const slug = config.slug();
    const existing = this.registry.get(slug);
    if (existing !== undefined) {
      throw new Error(
        `AdminModel for slug "${slug}" is already registered ` +
          `(${existing.model.tablename}); refusing to overwrite with ` +
          `${config.model.tablename}`,
      );
    }
    this.registry.set(slug, config as AdminModel);
    return config;
  }

  /**
   * Remove a previously registered configuration.
   *
   * @param slug - The slug to drop.
   * @throws Error When no configuration is registered under the slug.
   */
  unregister(slug: string): void {
    if (!this.registry.delete(slug)) {
      throw new Error(`No AdminModel registered for slug "${slug}"`);
    }
  }

  /**
   * Look a configuration up by slug.
   *
   * @param slug - The admin slug.
   * @returns The configuration, or `null` when nothing matches.
   */
  get(slug: string): AdminModel | null {
    return this.registry.get(slug) ?? null;
  }

  /**
   * Return every registered configuration, ordered by display name.
   *
   * @returns The configurations (empty when nothing is registered).
   */
  list(): AdminModel[] {
    return [...this.registry.values()].sort((left, right) =>
      left
        .verboseNamePlural()
        .toLowerCase()
        .localeCompare(right.verboseNamePlural().toLowerCase()),
    );
  }

  /**
   * Register every concrete model found in `source` at once.
   *
   * The batch counterpart to {@link AdminSite.register}: instead of one call
   * per table, hand it the models barrel and every model class declaring a
   * `tablename` is wrapped in a default {@link AdminModel}.
   *
   * ```ts
   * import * as models from "./db/models";
   *
   * site.automap(models);
   * site.automap([UserModel, OrderModel], { pageSize: 50 });
   * ```
   *
   * @param source - An array of model classes, or a module namespace object
   *   whose values are swept (non-model entries are ignored).
   * @param options - `exclude`, `skipRegistered` and any {@link AdminModel}
   *   option applied uniformly to every model discovered here.
   * @returns The configurations newly registered by this call.
   * @throws Error When `skipRegistered` is `false` and a slug collides.
   */
  automap(
    source: readonly unknown[] | Record<string, unknown>,
    options: AdminAutomapOptions = {},
  ): AdminModel[] {
    const { exclude = [], skipRegistered = true, ...adminOptions } = options;
    const excluded = new Set(
      exclude.map((entry) => (typeof entry === "string" ? entry : entry.tablename)),
    );
    const candidates = Array.isArray(source) ? source : Object.values(source);
    const registered: AdminModel[] = [];

    for (const candidate of candidates) {
      if (!isConcreteModel(candidate)) continue;
      if (excluded.has(candidate.tablename)) continue;
      const config = new AdminModel({ ...adminOptions, model: candidate });
      if (skipRegistered && this.registry.get(config.slug()) !== undefined) continue;
      registered.push(this.register(config));
    }
    return registered.sort((left, right) => left.slug().localeCompare(right.slug()));
  }
}
