/**
 * The server-rendered admin panel router, mirroring `admin.router`.
 *
 * Mounts a Django-style panel over an {@link AdminSite}: operators sign in with
 * a row from the project's own database, then browse, search, filter, sort,
 * create, edit and delete every registered model. Nothing here is JSON — the
 * responses are HTML pages built by `@/admin/templates` and styled by the one
 * stylesheet this package serves.
 *
 * ```text
 * GET  {prefix}/static/admin.css       the bundled stylesheet
 * GET  {prefix}/login                  sign-in form
 * POST {prefix}/login                  credential check
 * GET  {prefix}/mfa                    TOTP challenge (backends with MFA)
 * POST {prefix}/mfa                    TOTP verification
 * POST {prefix}/logout                 drop the session
 * GET  {prefix}/                       dashboard: row counts + system metrics
 * GET  {prefix}/m/:slug                list view: search, filters, sort, pages
 * GET  {prefix}/m/:slug/new            create form
 * POST {prefix}/m/:slug/new            create
 * GET  {prefix}/m/:slug/:identity      detail view
 * GET  {prefix}/m/:slug/:identity/edit edit form
 * POST {prefix}/m/:slug/:identity/edit update
 * POST {prefix}/m/:slug/:identity/delete delete
 * ```
 *
 * Every state-changing POST carries the session's CSRF token and is rejected
 * with `403` when it does not match.
 */

import type {
  AdminAction,
  AdminActionContext,
  AdminActionResult,
  BulkActionOption,
} from "@/admin/actions";
import type { AdminAuthBackend } from "@/admin/auth";
import {
  type AdminSelectOption,
  adminColumns,
  filterForColumn,
  foreignKeyTable,
  humanizeField,
  isSearchableColumn,
} from "@/admin/columns";
import type { AdminModel } from "@/admin/config";
import {
  type CardData,
  type MetricCard,
  partitionTotal,
  trendDirection,
  trendPercent,
} from "@/admin/dashboard";
import {
  buildFormFields,
  foreignKeyFields,
  foreignKeyLabel,
  formatCellValue,
  parseFormBody,
} from "@/admin/forms";
import { type AdminAccessPolicy, AdminPermission } from "@/admin/permissions";
import { type AdminSession, AdminSessionStore, csrfTokenMatches } from "@/admin/session";
import type { AdminSite } from "@/admin/site";
import { ADMIN_CSS } from "@/admin/styles";
import {
  type AdminDashboardCard,
  type AdminDashboardMetrics,
  type AdminFilterView,
  type AdminListView,
  type AdminMessage,
  type AdminRenderContext,
  type AdminSortView,
  renderDashboardPage,
  renderDetailPage,
  renderFormPage,
  renderListPage,
  renderLoginPage,
  renderMfaPage,
} from "@/admin/templates";
import type {
  AdminAuditEntryView,
  AdminAuditView,
  AdminBusinessCardView,
} from "@/admin/templates";
import { resolveAdminTheme } from "@/admin/theme";
import { JSONLogger } from "@/core";
import { BaseRepository } from "@/db";
import type { AsyncEngine, AsyncSession, Column, Condition, WhereInput } from "@/db";
import { and, or } from "@/db";
import { MetricsUtils } from "@/utils";
import express, { type Request, type Response, type Router } from "express";

const logger = new JSONLogger("tempest_express_sdk.admin.router");

/** Cap on audit-history entries rendered on the detail view. */
const AUDIT_HISTORY_LIMIT = 50;

/** Cap on related rows pre-loaded into a foreign-key dropdown. */
const FK_OPTION_CAP = 1000;

/** Cap on the flash message length echoed back through the redirect query. */
const FLASH_MAX_LENGTH = 300;

/** Fixed outcome codes carried in the redirect query after a write. */
const FLASH_MESSAGES: Record<string, AdminMessage> = {
  created: { text: "Record created.", level: "success" },
  updated: { text: "Record updated.", level: "success" },
  deleted: { text: "Record deleted.", level: "success" },
};

/** Options for {@link makeAdminRouter}. */
export interface AdminRouterOptions {
  /** The engine the panel opens a session on for each request. */
  engine: AsyncEngine;
  /** How the login form turns credentials into a principal. */
  authBackend: AdminAuthBackend;
  /** HMAC key signing the session cookie. At least 32 characters. */
  secretKey: string;
  /** Mount prefix. Default `/admin`. */
  prefix?: string;
  /** Send the session cookie with `Secure`. Default `true` — turn it off only in local HTTP dev. */
  cookieSecure?: boolean;
  /** Session cookie name. Default `tempest_admin_session`. */
  cookieName?: string;
  /** Session lifetime in seconds. Default `28800` (8 hours). */
  sessionMaxAgeSeconds?: number;
  /** Show the CPU/memory panel on the dashboard. Default `true`. */
  showMetrics?: boolean;
  /**
   * Hard cap on rows the CSV/JSON export writes. Default `5000`. An export is
   * a full table scan streamed to a browser, so the cap is what keeps a curious
   * click on a large table from becoming an outage.
   */
  exportMaxRows?: number;
  /**
   * Granular access control layered on top of the `AdminModel` flags. Omitted
   * lets every signed-in operator do whatever those flags allow.
   */
  accessPolicy?: AdminAccessPolicy;
}

/** A request's resolved search, filters and ordering, shared by list + export. */
interface ResolvedListQuery {
  /** The free-text search term (empty when absent). */
  search: string;
  /** The text columns the search actually ran against. */
  searchable: string[];
  /** The combined `where` condition, or `undefined` for "everything". */
  where: Condition | WhereInput<Record<string, unknown>> | undefined;
  /** The ordering column, or `undefined` to leave it to the repository. */
  orderBy: string | undefined;
  /** Whether the ordering is ascending. */
  ascending: boolean;
  /** The column the request explicitly sorted by, or `null`. */
  sortColumn: string | null;
  /** View models for the filter bar. */
  filterViews: AdminFilterView[];
  /** Query-string parameters every generated link carries forward. */
  baseQuery: Record<string, string>;
  /** The active lens slug, or `""` when none was requested. */
  lens: string;
}

/** The per-request state the authenticated handlers share. */
interface AdminRequestState {
  session: AdminSession;
  dbSession: AsyncSession;
  principal: unknown;
  /** The registered models this principal is allowed to see. */
  visible: AdminModel[];
}

/**
 * Run a custom action, normalizing a handler that resolves to nothing.
 *
 * @param action - The registered action.
 * @param context - The context handed to the handler.
 * @returns The result to flash, or `null` when the handler reported none.
 */
async function runCustomAction(
  action: AdminAction,
  context: AdminActionContext,
): Promise<AdminActionResult | null> {
  return (await action.handler(context)) ?? null;
}

/**
 * Read the first value of a query parameter as a string.
 *
 * Express hands repeated parameters over as arrays; the panel's controls never
 * repeat, so the first value wins and anything else reads as absent.
 *
 * @param value - The raw query value.
 * @returns The trimmed string, or `""` when absent.
 */
function queryString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string") return value[0].trim();
  return "";
}

/**
 * Build a query string from defined, non-empty entries.
 *
 * @param entries - Parameter name/value pairs.
 * @returns The encoded query string, without a leading `?`.
 */
function buildQuery(entries: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined || value === "") continue;
    params.set(key, String(value));
  }
  return params.toString();
}

/**
 * Build the admin panel router.
 *
 * @param site - The registered {@link AdminSite}.
 * @param options - Engine, auth backend, signing key and cookie/appearance flags.
 * @returns An Express router serving the whole panel under its prefix.
 * @throws Error When the signing key is shorter than 32 characters.
 */
export function makeAdminRouter(site: AdminSite, options: AdminRouterOptions): Router {
  const prefix = (options.prefix ?? "/admin").replace(/\/$/, "");
  const theme = resolveAdminTheme(site.theme);
  const showMetrics = options.showMetrics ?? true;
  const exportMaxRows = options.exportMaxRows ?? 5000;
  const sessions = new AdminSessionStore({
    secret: options.secretKey,
    ...(options.cookieName === undefined ? {} : { cookieName: options.cookieName }),
    ...(options.sessionMaxAgeSeconds === undefined
      ? {}
      : { maxAgeSeconds: options.sessionMaxAgeSeconds }),
    ...(options.cookieSecure === undefined ? {} : { cookieSecure: options.cookieSecure }),
    cookiePath: prefix === "" ? "/" : prefix,
  });
  const backend = options.authBackend;
  const router = express.Router();

  router.use(prefix, express.urlencoded({ extended: false }));

  /**
   * Build the chrome context every page renders inside.
   *
   * @param req - The inbound request.
   * @param session - The active session, or `null` on the login/MFA pages.
   * @returns The render context.
   */
  const context = (
    req: Request,
    session: AdminSession | null,
    models: AdminModel[] = site.list(),
  ): AdminRenderContext => ({
    site,
    theme,
    prefix,
    session,
    currentPath: req.originalUrl.split("?")[0] ?? req.path,
    navModels: models.map((admin) => ({
      label: admin.verboseNamePlural(),
      url: `${prefix}/m/${admin.slug()}`,
    })),
    messages: flashFor(req),
  });

  /**
   * Ask the access policy whether a principal may perform an action.
   *
   * With no policy configured everything the `AdminModel` flags allow is
   * allowed; a policy narrows that further and never widens it, so the flags
   * stay the outer bound.
   *
   * @param principal - The authenticated principal.
   * @param admin - The model configuration being acted on.
   * @param action - The action being attempted.
   * @returns Whether the action may proceed.
   */
  const allows = async (
    principal: unknown,
    admin: AdminModel,
    action: AdminPermission,
  ): Promise<boolean> => {
    if (!flagAllows(admin, action)) return false;
    if (options.accessPolicy === undefined) return true;
    return Boolean(await options.accessPolicy(principal, admin, action));
  };

  /**
   * Resolve the fixed outcome code a redirect carries into a banner.
   *
   * @param req - The inbound request.
   * @returns The banners to render (empty when the request carries none).
   */
  const flashFor = (req: Request): AdminMessage[] => {
    const fixed = FLASH_MESSAGES[queryString(req.query.ok)];
    if (fixed !== undefined) return [fixed];
    const text = queryString(req.query.flash);
    if (text === "") return [];
    const level = queryString(req.query.level);
    return [
      {
        text: text.slice(0, FLASH_MAX_LENGTH),
        level: level === "error" || level === "warning" ? level : "success",
      },
    ];
  };

  /**
   * Send an HTML page.
   *
   * @param res - The outbound response.
   * @param html - The rendered document.
   * @param status - The status code. Default `200`.
   */
  const html = (res: Response, body: string, status = 200): void => {
    res.status(status).type("html").send(body);
  };

  /**
   * Wrap an async handler so a thrown error renders an HTML page instead of
   * falling through to the JSON error stack the rest of the app uses.
   *
   * @param handler - The handler to wrap.
   * @returns An Express handler that never rejects.
   */
  const guarded =
    (handler: (req: Request, res: Response) => Promise<void>) =>
    (req: Request, res: Response): void => {
      handler(req, res).catch((error: unknown) => {
        logger.error("Admin request failed", {
          path: req.originalUrl,
          error: error instanceof Error ? error.message : String(error),
        });
        if (res.headersSent) return;
        html(
          res,
          renderLoginPage(context(req, null), "Something went wrong. Please try again."),
          500,
        );
      });
    };

  /**
   * Resolve the session for an authenticated route, redirecting when it is
   * missing, expired, still awaiting MFA, or points at a principal that no
   * longer qualifies.
   *
   * @param req - The inbound request.
   * @param res - The outbound response.
   * @returns The request state, or `null` when a redirect was already sent.
   */
  const authenticate = async (
    req: Request,
    res: Response,
  ): Promise<AdminRequestState | null> => {
    const session = sessions.load(req);
    if (session === null) {
      res.redirect(`${prefix}/login`);
      return null;
    }
    const dbSession = options.engine.session();
    const principal = await backend.loadPrincipal(dbSession, session.subject);
    if (principal === null) {
      sessions.clear(res);
      res.redirect(`${prefix}/login`);
      return null;
    }
    if (!session.mfaPassed) {
      res.redirect(`${prefix}/mfa`);
      return null;
    }
    const visible: AdminModel[] = [];
    for (const admin of site.list()) {
      if (await allows(principal, admin, AdminPermission.VIEW)) visible.push(admin);
    }
    return { session, dbSession, principal, visible };
  };

  /**
   * Resolve the model configuration a URL slug names.
   *
   * @param req - The inbound request.
   * @param res - The outbound response.
   * @param state - The authenticated request state.
   * @returns The configuration, or `null` when a 404 was already sent.
   */
  const resolveAdmin = async (
    req: Request,
    res: Response,
    state: AdminRequestState,
    action: AdminPermission = AdminPermission.VIEW,
  ): Promise<AdminModel | null> => {
    const admin = site.get(String(req.params.slug));
    if (admin === null || !(await allows(state.principal, admin, AdminPermission.VIEW))) {
      html(res, renderNotFound(context(req, state.session, state.visible)), 404);
      return null;
    }
    if (action !== AdminPermission.VIEW) {
      if (!flagAllows(admin, action)) {
        html(res, renderNotFound(context(req, state.session, state.visible)), 404);
        return null;
      }
      if (!(await allows(state.principal, admin, action))) {
        html(res, renderNotFound(context(req, state.session, state.visible)), 403);
        return null;
      }
    }
    return admin;
  };

  /**
   * Render a "no such page" body inside the panel chrome.
   *
   * @param ctx - The render context.
   * @returns The full page.
   */
  const renderNotFound = (ctx: AdminRenderContext): string =>
    renderDashboardPage(
      { ...ctx, messages: [{ text: "Not found.", level: "error" }] },
      [],
      null,
    );

  /**
   * Reject a write whose CSRF token does not match the session's.
   *
   * @param req - The inbound request.
   * @param res - The outbound response.
   * @param state - The authenticated request state.
   * @returns `true` when the request may proceed.
   */
  const checkCsrf = (req: Request, res: Response, state: AdminRequestState): boolean => {
    const body = req.body as Record<string, unknown>;
    if (csrfTokenMatches(state.session, body?.csrf_token)) return true;
    html(res, renderNotFound(context(req, state.session, state.visible)), 403);
    return false;
  };

  router.get(`${prefix}/static/admin.css`, (_req, res) => {
    res.type("css").set("cache-control", "public, max-age=3600").send(ADMIN_CSS);
  });

  router.get(`${prefix}/login`, (req, res) => {
    html(res, renderLoginPage(context(req, null), null));
  });

  router.post(
    `${prefix}/login`,
    guarded(async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const identifier = typeof body.identifier === "string" ? body.identifier : "";
      const password = typeof body.password === "string" ? body.password : "";
      const dbSession = options.engine.session();
      const principal = await backend.authenticate(dbSession, identifier, password);
      if (principal === null) {
        html(res, renderLoginPage(context(req, null), "Invalid credentials."), 401);
        return;
      }
      const needsMfa = (await backend.mfaEnabled?.(principal)) ?? false;
      const session = sessions.issue(
        backend.principalId(principal),
        backend.displayName(principal),
        !needsMfa,
      );
      sessions.save(res, session);
      res.redirect(needsMfa ? `${prefix}/mfa` : `${prefix}/`);
    }),
  );

  router.get(`${prefix}/mfa`, (req, res) => {
    const session = sessions.load(req);
    if (session === null) {
      res.redirect(`${prefix}/login`);
      return;
    }
    if (session.mfaPassed) {
      res.redirect(`${prefix}/`);
      return;
    }
    html(res, renderMfaPage(context(req, null), null));
  });

  router.post(
    `${prefix}/mfa`,
    guarded(async (req, res) => {
      const session = sessions.load(req);
      if (session === null) {
        res.redirect(`${prefix}/login`);
        return;
      }
      const body = req.body as Record<string, unknown>;
      const code = typeof body.code === "string" ? body.code : "";
      const dbSession = options.engine.session();
      const principal = await backend.loadPrincipal(dbSession, session.subject);
      const verified =
        principal !== null && ((await backend.verifyMfa?.(principal, code)) ?? false);
      if (!verified) {
        html(res, renderMfaPage(context(req, null), "Invalid code."), 401);
        return;
      }
      sessions.save(res, { ...session, mfaPassed: true });
      res.redirect(`${prefix}/`);
    }),
  );

  router.post(
    `${prefix}/logout`,
    guarded(async (req, res) => {
      const session = sessions.load(req);
      if (
        session !== null &&
        !csrfTokenMatches(session, (req.body as Record<string, unknown>)?.csrf_token)
      ) {
        html(res, renderLoginPage(context(req, null), "Invalid request."), 403);
        return;
      }
      sessions.clear(res);
      res.redirect(`${prefix}/login`);
    }),
  );

  router.get(
    `${prefix}/`,
    guarded(async (req, res) => {
      const state = await authenticate(req, res);
      if (state === null) return;

      const cards: AdminDashboardCard[] = [];
      for (const admin of state.visible) {
        let count: number | null = null;
        try {
          count = await admin.repository(state.dbSession).count();
        } catch (error) {
          logger.warning("Admin dashboard count failed", {
            slug: admin.slug(),
            error: error instanceof Error ? error.message : String(error),
          });
        }
        cards.push({
          label: admin.verboseNamePlural(),
          count,
          url: `${prefix}/m/${admin.slug()}`,
          newUrl: (await allows(state.principal, admin, AdminPermission.CREATE))
            ? `${prefix}/m/${admin.slug()}/new`
            : null,
        });
      }

      const businessCards: AdminBusinessCardView[] = [];
      for (const card of site.dashboardCards) {
        businessCards.push(await computeBusinessCard(card, state.dbSession));
      }

      let metrics: AdminDashboardMetrics | null = null;
      if (showMetrics) {
        const snapshot = MetricsUtils.system();
        metrics = {
          cpuPercent: Math.round(snapshot.cpu.loadPercent),
          memoryPercent: Math.round(snapshot.memory.usedPercent),
          memoryUsedGb: (snapshot.memory.used / 1024 ** 3).toFixed(1),
          memoryTotalGb: (snapshot.memory.total / 1024 ** 3).toFixed(1),
        };
      }

      html(
        res,
        renderDashboardPage(
          context(req, state.session, state.visible),
          cards,
          metrics,
          businessCards,
        ),
      );
    }),
  );

  router.get(
    `${prefix}/m/:slug`,
    guarded(async (req, res) => {
      const state = await authenticate(req, res);
      if (state === null) return;
      const admin = await resolveAdmin(req, res, state);
      if (admin === null) return;
      html(res, await renderList(req, admin, state));
    }),
  );

  router.get(
    `${prefix}/m/:slug/new`,
    guarded(async (req, res) => {
      const state = await authenticate(req, res);
      if (state === null) return;
      const admin = await resolveAdmin(req, res, state, AdminPermission.CREATE);
      if (admin === null) return;
      if (!admin.canCreate) {
        html(res, renderNotFound(context(req, state.session, state.visible)), 404);
        return;
      }
      html(
        res,
        renderFormPage(context(req, state.session, state.visible), {
          mode: "create",
          title: admin.verboseName(),
          fields: buildFormFields(admin, {
            foreignKeyOptions: await foreignKeyOptionsFor(admin, state.dbSession),
          }),
          actionUrl: `${prefix}/m/${admin.slug()}/new`,
          backUrl: `${prefix}/m/${admin.slug()}`,
          error: null,
        }),
      );
    }),
  );

  router.post(
    `${prefix}/m/:slug/new`,
    guarded(async (req, res) => {
      const state = await authenticate(req, res);
      if (state === null) return;
      const admin = await resolveAdmin(req, res, state, AdminPermission.CREATE);
      if (admin === null) return;
      if (!admin.canCreate) {
        html(res, renderNotFound(context(req, state.session, state.visible)), 404);
        return;
      }
      if (!checkCsrf(req, res, state)) return;

      const body = req.body as Record<string, unknown>;
      const parsed = parseFormBody(admin, body);
      const foreignKeyOptions = await foreignKeyOptionsFor(admin, state.dbSession);
      const rerender = (error: string | null, status: number): void => {
        html(
          res,
          renderFormPage(context(req, state.session, state.visible), {
            mode: "create",
            title: admin.verboseName(),
            fields: buildFormFields(admin, {
              values: body,
              errors: parsed.errors,
              foreignKeyOptions,
            }),
            actionUrl: `${prefix}/m/${admin.slug()}/new`,
            backUrl: `${prefix}/m/${admin.slug()}`,
            error,
          }),
          status,
        );
      };

      if (Object.keys(parsed.errors).length > 0) {
        rerender("Please fix the highlighted fields.", 400);
        return;
      }
      stampActor(admin, parsed.data, backend.principalId(state.principal as never), true);
      try {
        await admin.repository(state.dbSession).create(parsed.data as never);
      } catch (error) {
        rerender(describeWriteFailure(admin, error), 400);
        return;
      }
      res.redirect(`${prefix}/m/${admin.slug()}?ok=created`);
    }),
  );

  router.get(
    `${prefix}/m/:slug/export.:format`,
    guarded(async (req, res) => {
      const state = await authenticate(req, res);
      if (state === null) return;
      const admin = await resolveAdmin(req, res, state);
      if (admin === null) return;
      const format = String(req.params.format);
      if (format !== "csv" && format !== "json") {
        html(res, renderNotFound(context(req, state.session, state.visible)), 404);
        return;
      }

      const query = await resolveListQuery(req, admin, state.dbSession);
      const result = await admin.repository(state.dbSession).paginate({
        page: 1,
        pageSize: exportMaxRows,
        ...(query.orderBy === undefined ? {} : { orderBy: query.orderBy as never }),
        ascending: query.ascending,
        ...(query.where === undefined ? {} : { filters: query.where as never }),
      });

      const columns = admin.listDisplayNames();
      const rows = result.items as Record<string, unknown>[];
      const payload = format === "csv" ? toCsv(columns, rows) : toJson(columns, rows);
      res
        .status(200)
        .type(format === "csv" ? "text/csv; charset=utf-8" : "application/json")
        .set("content-disposition", `attachment; filename="${admin.slug()}.${format}"`)
        .send(payload);
    }),
  );

  router.post(
    `${prefix}/m/:slug/bulk`,
    guarded(async (req, res) => {
      const state = await authenticate(req, res);
      if (state === null) return;
      const admin = await resolveAdmin(req, res, state);
      if (admin === null) return;
      if (!checkCsrf(req, res, state)) return;

      const body = req.body as Record<string, unknown>;
      const action = typeof body.action === "string" ? body.action : "";
      const raw = body.ids;
      const ids = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw])
        .filter((value): value is string => typeof value === "string")
        .filter((value) => value !== "");

      const listUrl = `${prefix}/m/${admin.slug()}`;
      const back = (message: string, level: AdminMessage["level"]): void => {
        res.redirect(`${listUrl}?${buildQuery({ flash: message, level })}`);
      };

      if (ids.length === 0) {
        back("No rows were selected.", "warning");
        return;
      }
      if (!bulkActionsFor(admin).some((option) => option.value === action)) {
        html(res, renderNotFound(context(req, state.session, state.visible)), 400);
        return;
      }

      const needed = action === "delete" ? AdminPermission.DELETE : AdminPermission.EDIT;
      if (!(await allows(state.principal, admin, needed))) {
        html(res, renderNotFound(context(req, state.session, state.visible)), 403);
        return;
      }

      const repository = admin.repository(state.dbSession);
      const scope = { [admin.identityField]: { in: ids } } as never;

      if (action.startsWith("custom:")) {
        const custom = admin.getAction(action.slice("custom:".length));
        if (custom === null) {
          html(res, renderNotFound(context(req, state.session, state.visible)), 400);
          return;
        }
        let result: AdminActionResult | null;
        try {
          result = await runCustomAction(custom, {
            ids,
            repository,
            dbSession: state.dbSession,
            request: req,
            session: state.session,
            principal: state.principal,
          });
        } catch (error) {
          logger.error("Admin action failed", {
            slug: admin.slug(),
            action: custom.name,
            error: error instanceof Error ? error.message : String(error),
          });
          back(
            `${custom.label} failed: ${error instanceof Error ? error.message : String(error)}`,
            "error",
          );
          return;
        }
        if (result === null) {
          res.redirect(listUrl);
          return;
        }
        back(result.message, result.category ?? "success");
        return;
      }

      if (action === "delete") {
        const removed = await repository.delete(scope);
        back(`Deleted ${removed} record${removed === 1 ? "" : "s"}.`, "success");
        return;
      }

      const active = action === "activate";
      const changed = await repository.update(scope, { isActive: active } as never);
      back(
        `${active ? "Activated" : "Deactivated"} ${changed} record${changed === 1 ? "" : "s"}.`,
        "success",
      );
    }),
  );

  router.get(
    `${prefix}/m/:slug/:identity`,
    guarded(async (req, res) => {
      const state = await authenticate(req, res);
      if (state === null) return;
      const admin = await resolveAdmin(req, res, state);
      if (admin === null) return;
      const row = await findRow(admin, state.dbSession, String(req.params.identity));
      if (row === null) {
        html(res, renderNotFound(context(req, state.session, state.visible)), 404);
        return;
      }
      const identity = String(row[admin.identityField]);
      html(
        res,
        renderDetailPage(context(req, state.session, state.visible), {
          title: admin.verboseName(),
          identity,
          audit: await buildAuditView(admin, row, state.dbSession),
          fields: admin
            .detailFieldNames()
            .map((name) => ({ label: name, value: formatCellValue(row[name]) })),
          backUrl: `${prefix}/m/${admin.slug()}`,
          editUrl: (await allows(state.principal, admin, AdminPermission.EDIT))
            ? `${prefix}/m/${admin.slug()}/${identity}/edit`
            : null,
          deleteUrl: (await allows(state.principal, admin, AdminPermission.DELETE))
            ? `${prefix}/m/${admin.slug()}/${identity}/delete`
            : null,
        }),
      );
    }),
  );

  router.get(
    `${prefix}/m/:slug/:identity/edit`,
    guarded(async (req, res) => {
      const state = await authenticate(req, res);
      if (state === null) return;
      const admin = await resolveAdmin(req, res, state, AdminPermission.EDIT);
      if (admin === null) return;
      const identity = String(req.params.identity);
      const row = admin.canEdit ? await findRow(admin, state.dbSession, identity) : null;
      if (row === null) {
        html(res, renderNotFound(context(req, state.session, state.visible)), 404);
        return;
      }
      html(
        res,
        renderFormPage(context(req, state.session, state.visible), {
          mode: "edit",
          title: admin.verboseName(),
          fields: buildFormFields(admin, {
            values: row,
            foreignKeyOptions: await foreignKeyOptionsFor(admin, state.dbSession),
          }),
          actionUrl: `${prefix}/m/${admin.slug()}/${identity}/edit`,
          backUrl: `${prefix}/m/${admin.slug()}/${identity}`,
          error: null,
        }),
      );
    }),
  );

  router.post(
    `${prefix}/m/:slug/:identity/edit`,
    guarded(async (req, res) => {
      const state = await authenticate(req, res);
      if (state === null) return;
      const admin = await resolveAdmin(req, res, state, AdminPermission.EDIT);
      if (admin === null) return;
      const identity = String(req.params.identity);
      if (!admin.canEdit) {
        html(res, renderNotFound(context(req, state.session, state.visible)), 404);
        return;
      }
      if (!checkCsrf(req, res, state)) return;

      const body = req.body as Record<string, unknown>;
      const parsed = parseFormBody(admin, body);
      const foreignKeyOptions = await foreignKeyOptionsFor(admin, state.dbSession);
      const rerender = (error: string | null, status: number): void => {
        html(
          res,
          renderFormPage(context(req, state.session, state.visible), {
            mode: "edit",
            title: admin.verboseName(),
            fields: buildFormFields(admin, {
              values: body,
              errors: parsed.errors,
              foreignKeyOptions,
            }),
            actionUrl: `${prefix}/m/${admin.slug()}/${identity}/edit`,
            backUrl: `${prefix}/m/${admin.slug()}/${identity}`,
            error,
          }),
          status,
        );
      };

      if (Object.keys(parsed.errors).length > 0) {
        rerender("Please fix the highlighted fields.", 400);
        return;
      }
      stampActor(
        admin,
        parsed.data,
        backend.principalId(state.principal as never),
        false,
      );
      try {
        const changed = await admin
          .repository(state.dbSession)
          .update({ [admin.identityField]: identity } as never, parsed.data as never);
        if (changed === 0) {
          html(res, renderNotFound(context(req, state.session, state.visible)), 404);
          return;
        }
      } catch (error) {
        rerender(describeWriteFailure(admin, error), 400);
        return;
      }
      res.redirect(`${prefix}/m/${admin.slug()}/${identity}?ok=updated`);
    }),
  );

  router.post(
    `${prefix}/m/:slug/:identity/delete`,
    guarded(async (req, res) => {
      const state = await authenticate(req, res);
      if (state === null) return;
      const admin = await resolveAdmin(req, res, state, AdminPermission.DELETE);
      if (admin === null) return;
      if (!admin.canDelete) {
        html(res, renderNotFound(context(req, state.session, state.visible)), 404);
        return;
      }
      if (!checkCsrf(req, res, state)) return;
      await admin
        .repository(state.dbSession)
        .delete({ [admin.identityField]: String(req.params.identity) } as never);
      res.redirect(`${prefix}/m/${admin.slug()}?ok=deleted`);
    }),
  );

  /**
   * Resolve an actor id into a display name through the auth backend.
   *
   * @param actor - The stored actor id, or `null`.
   * @param dbSession - The request's DB session.
   * @returns The principal's display name, the raw id when it no longer
   *   resolves, or `""` when the column was never set.
   */
  async function actorLabel(actor: unknown, dbSession: AsyncSession): Promise<string> {
    if (actor === null || actor === undefined || actor === "") return "";
    const principal = await backend.loadPrincipal(dbSession, String(actor));
    return principal === null ? String(actor) : backend.displayName(principal);
  }

  /**
   * Build the detail view's audit panel: timestamps, actors and — when an
   * `auditModel` is configured — the change timeline for this row.
   *
   * @param admin - The model configuration.
   * @param row - The record being shown.
   * @param dbSession - The request's DB session.
   * @returns The panel view model, or `null` when the model carries no audit
   *   columns and no timeline to show.
   */
  async function buildAuditView(
    admin: AdminModel,
    row: Record<string, unknown>,
    dbSession: AsyncSession,
  ): Promise<AdminAuditView | null> {
    const fields: { label: string; value: string }[] = [];
    for (const name of admin.auditFieldNames()) {
      const value =
        name === "createdBy" || name === "updatedBy"
          ? await actorLabel(row[name], dbSession)
          : formatCellValue(row[name]);
      fields.push({ label: humanizeField(name), value });
    }

    const history: AdminAuditEntryView[] = [];
    if (admin.auditModel !== null) {
      const entity = (admin.model as unknown as { name: string }).name;
      const entityId = String(row[admin.identityField]);
      const page = await new BaseRepository(admin.auditModel, dbSession).paginate({
        page: 1,
        pageSize: AUDIT_HISTORY_LIMIT,
        orderBy: "createdAt" as never,
        ascending: false,
        filters: { entity, entityId } as never,
      });
      for (const entry of page.items as Record<string, unknown>[]) {
        const changes = (entry.changes ?? {}) as Record<
          string,
          { before?: unknown; after?: unknown }
        >;
        history.push({
          action: String(entry.action ?? ""),
          at: formatCellValue(entry.createdAt),
          actor: (await actorLabel(entry.actor, dbSession)) || "—",
          changes: Object.entries(changes).map(([field, change]) => ({
            field,
            before: formatCellValue(change?.before),
            after: formatCellValue(change?.after),
          })),
          context:
            entry.context === null || entry.context === undefined
              ? null
              : JSON.stringify(entry.context, null, 2),
        });
      }
    }

    if (fields.length === 0 && history.length === 0) return null;
    return { fields, history };
  }

  /**
   * Look one row up by the configured identity column.
   *
   * @param admin - The model configuration.
   * @param dbSession - The request's DB session.
   * @param identity - The identity taken from the URL.
   * @returns The row as a plain record, or `null` when nothing matches.
   */
  async function findRow(
    admin: AdminModel,
    dbSession: AsyncSession,
    identity: string,
  ): Promise<Record<string, unknown> | null> {
    const row = await admin
      .repository(dbSession)
      .first({ [admin.identityField]: identity } as never);
    return (row as Record<string, unknown> | null) ?? null;
  }

  /**
   * Filter the bulk-action dropdown down to what this principal may run.
   *
   * Offering an action the policy will refuse trains operators to ignore
   * failures, so the option is removed rather than left to fail on submit.
   *
   * @param admin - The model configuration.
   * @param principal - The acting principal.
   * @returns The permitted options.
   */
  async function permittedBulkActions(
    admin: AdminModel,
    principal: unknown,
  ): Promise<BulkActionOption[]> {
    const permitted: BulkActionOption[] = [];
    for (const option of bulkActionsFor(admin)) {
      const needed =
        option.value === "delete" ? AdminPermission.DELETE : AdminPermission.EDIT;
      if (await allows(principal, admin, needed)) permitted.push(option);
    }
    return permitted;
  }

  /**
   * Render the list view for a model, applying the request's search, filters,
   * ordering and page.
   *
   * @param req - The inbound request.
   * @param admin - The model configuration.
   * @param state - The authenticated request state.
   * @returns The full page.
   */
  async function renderList(
    req: Request,
    admin: AdminModel,
    state: AdminRequestState,
  ): Promise<string> {
    const columns = adminColumns(admin.model);
    const query = await resolveListQuery(req, admin, state.dbSession);
    const page = Math.max(1, Number.parseInt(queryString(req.query.page), 10) || 1);

    const result = await admin.repository(state.dbSession).paginate({
      page,
      pageSize: admin.pageSize,
      ...(query.orderBy === undefined ? {} : { orderBy: query.orderBy as never }),
      ascending: query.ascending,
      ...(query.where === undefined ? {} : { filters: query.where as never }),
    });

    const displayed = admin.listDisplayNames();
    const sort: Record<string, AdminSortView> = {};
    for (const column of displayed) {
      if (!(column in columns)) continue;
      const active = (query.sortColumn ?? admin.orderKey) === column;
      const nextAscending = active ? !query.ascending : true;
      sort[column] = {
        url: `?${buildQuery({
          ...query.baseQuery,
          sort: column,
          dir: nextAscending ? "asc" : "desc",
        })}`,
        active,
        ascending: query.ascending,
      };
    }

    const sortParams = {
      sort: query.sortColumn ?? undefined,
      dir: query.sortColumn === null ? undefined : query.ascending ? "asc" : "desc",
    };
    const pageUrl = (target: number): string =>
      `?${buildQuery({ ...query.baseQuery, ...sortParams, page: target })}`;
    const exportQuery = buildQuery({ ...query.baseQuery, ...sortParams });
    const exportUrl = (format: string): string =>
      `${prefix}/m/${admin.slug()}/export.${format}${exportQuery === "" ? "" : `?${exportQuery}`}`;

    const view: AdminListView = {
      title: admin.verboseNamePlural(),
      columns: displayed,
      rows: (result.items as Record<string, unknown>[]).map((row) => {
        const identity = String(row[admin.identityField]);
        return {
          identity,
          cells: displayed.map((column) => formatCellValue(row[column])),
          url: `${prefix}/m/${admin.slug()}/${identity}`,
        };
      }),
      total: result.total,
      page: result.page,
      pages: result.pages,
      prevUrl: result.page > 1 ? pageUrl(result.page - 1) : null,
      nextUrl: result.page < result.pages ? pageUrl(result.page + 1) : null,
      searchable: query.searchable.length > 0,
      searchValue: query.search,
      filters: query.filterViews,
      sort,
      newUrl: (await allows(state.principal, admin, AdminPermission.CREATE))
        ? `${prefix}/m/${admin.slug()}/new`
        : null,
      bulkActions: await permittedBulkActions(admin, state.principal),
      bulkUrl: `${prefix}/m/${admin.slug()}/bulk`,
      exportCsvUrl: exportUrl("csv"),
      exportJsonUrl: exportUrl("json"),
      lenses:
        admin.lenses.length === 0
          ? []
          : [
              {
                label: "All",
                url: `?${buildQuery({ ...query.baseQuery, lens: undefined })}`,
                active: query.lens === "",
              },
              ...admin.lenses.map((entry) => ({
                label: entry.label,
                url: `?${buildQuery({ ...query.baseQuery, lens: entry.slug })}`,
                active: query.lens === entry.slug,
              })),
            ],
    };

    return renderListPage(context(req, state.session, state.visible), view);
  }

  /**
   * Resolve a request's search, filters and ordering into a `where` condition
   * plus the view models that render the filter bar.
   *
   * Shared by the list view and the export endpoint so both honor exactly the
   * same query: an export that quietly disagrees with the page it was taken
   * from is worse than no export at all.
   *
   * @param req - The inbound request.
   * @param admin - The model configuration.
   * @param dbSession - The request's DB session (used to load FK filter options).
   * @returns The condition, ordering, filter view models and the query-string
   *   parameters every generated link has to carry forward.
   */
  async function resolveListQuery(
    req: Request,
    admin: AdminModel,
    dbSession: AsyncSession,
  ): Promise<ResolvedListQuery> {
    const columns = adminColumns(admin.model);
    const search = queryString(req.query.q);
    const sortField = queryString(req.query.sort);
    const sortColumn = sortField in columns ? sortField : null;
    const lens = admin.getLens(queryString(req.query.lens));

    const conditions: (WhereInput<Record<string, unknown>> | Condition)[] = [];
    if (lens !== null && Object.keys(lens.filters).length > 0) {
      conditions.push(lens.filters);
    }
    const filterViews: AdminFilterView[] = [];

    for (const field of admin.listFilter) {
      const column = columns[field];
      if (column === undefined) continue;
      const spec = filterForColumn(column);

      if (spec.kind === "daterange") {
        const from = queryString(req.query[`filter_${field}_from`]);
        const to = queryString(req.query[`filter_${field}_to`]);
        const bounds: Record<string, unknown> = {};
        if (from !== "") bounds.gte = new Date(from);
        if (to !== "") bounds.lte = new Date(`${to}T23:59:59.999Z`);
        if (Object.keys(bounds).length > 0) conditions.push({ [field]: bounds });
        filterViews.push({
          field,
          label: humanizeField(field),
          kind: "daterange",
          value: "",
          valueFrom: from,
          valueTo: to,
          options: [],
        });
        continue;
      }

      const related = await relatedOptions(column, dbSession);
      const options = related ?? spec.options;
      const value = queryString(req.query[`filter_${field}`]);
      if (value !== "") {
        conditions.push({
          [field]: column.type.kind === "boolean" ? value === "true" : value,
        });
      }
      filterViews.push({
        field,
        label: humanizeField(field),
        kind: related === null ? spec.kind : "select",
        value,
        valueFrom: "",
        valueTo: "",
        options: options.map((option) => ({
          value: option.value,
          label: option.label,
          selected: option.value === value,
        })),
      });
    }

    const searchable = admin.searchFields.filter((field) => {
      const column = columns[field];
      return column !== undefined && isSearchableColumn(column);
    });
    if (search !== "" && searchable.length > 0) {
      conditions.push(
        or(...searchable.map((field) => ({ [field]: { ilike: `%${search}%` } }))),
      );
    }

    const baseQuery: Record<string, string> = { q: search };
    for (const view of filterViews) {
      if (view.kind === "daterange") {
        baseQuery[`filter_${view.field}_from`] = view.valueFrom;
        baseQuery[`filter_${view.field}_to`] = view.valueTo;
      } else {
        baseQuery[`filter_${view.field}`] = view.value;
      }
    }

    const lensOrder = lens?.orderBy ?? null;
    const lensDescending = lensOrder?.startsWith("-");
    const lensColumn = lensOrder === null ? null : lensOrder.replace(/^-/, "");
    const ascending =
      sortColumn !== null
        ? queryString(req.query.dir) !== "desc"
        : lensColumn !== null
          ? !lensDescending
          : admin.orderAscending;

    if (lens !== null) baseQuery.lens = lens.slug;

    return {
      search,
      searchable,
      where: conditions.length === 0 ? undefined : and(...conditions),
      orderBy: sortColumn ?? lensColumn ?? admin.orderKey ?? undefined,
      ascending,
      sortColumn,
      filterViews,
      baseQuery,
      lens: lens?.slug ?? "",
    };
  }

  /**
   * Load the `(value, label)` options for a foreign-key column whose target
   * model is registered on this site.
   *
   * A foreign key to an unmanaged table returns `null`, so the caller keeps the
   * plain identity input rather than offering an empty dropdown.
   *
   * @param column - The column to inspect.
   * @param dbSession - The request's DB session.
   * @returns The related-row options (capped), or `null` when unmanaged.
   */
  async function relatedOptions(
    column: Column<unknown>,
    dbSession: AsyncSession,
  ): Promise<AdminSelectOption[] | null> {
    const table = foreignKeyTable(column);
    if (table === null) return null;
    const referenced = site.get(table);
    if (referenced === null) return null;
    const rows = (await referenced.repository(dbSession).list()) as Record<
      string,
      unknown
    >[];
    return rows.slice(0, FK_OPTION_CAP).map((row) => ({
      value: String(row[referenced.identityField]),
      label: foreignKeyLabel(referenced, row),
    }));
  }

  /**
   * Load select options for every editable foreign key pointing at a model this
   * site manages, so the form shows related rows instead of raw identities.
   *
   * @param admin - The model configuration being rendered.
   * @param dbSession - The request's DB session.
   * @returns Options keyed by column (empty when the model has no managed FKs).
   */
  async function foreignKeyOptionsFor(
    admin: AdminModel,
    dbSession: AsyncSession,
  ): Promise<Record<string, AdminSelectOption[]>> {
    const columns = adminColumns(admin.model);
    const options: Record<string, AdminSelectOption[]> = {};
    for (const field of Object.keys(foreignKeyFields(admin))) {
      const column = columns[field];
      if (column === undefined) continue;
      const related = await relatedOptions(column, dbSession);
      if (related !== null) options[field] = related;
    }
    return options;
  }

  return router;
}

/**
 * Whether a configuration's own flags permit an action.
 *
 * Kept separate from the access policy because the two failures mean different
 * things: a flag turned off means the view does not exist (`404`), while a
 * policy refusal means it exists and this operator may not use it (`403`).
 *
 * @param admin - The model configuration.
 * @param action - The action being attempted.
 * @returns Whether the flags allow it.
 */
function flagAllows(admin: AdminModel, action: AdminPermission): boolean {
  if (action === AdminPermission.CREATE) return admin.canCreate;
  if (action === AdminPermission.EDIT) return admin.canEdit;
  if (action === AdminPermission.DELETE) return admin.canDelete;
  return true;
}

/**
 * Stamp `createdBy` / `updatedBy` with the acting operator.
 *
 * Only columns the model actually declares are touched, so a model without the
 * audit columns is unaffected — the panel never invents a field the table does
 * not have.
 *
 * @param admin - The model configuration being written.
 * @param data - The coerced payload, mutated in place.
 * @param actorId - The acting principal's id.
 * @param creating - `true` on create (stamps both), `false` on edit.
 */
function stampActor(
  admin: AdminModel,
  data: Record<string, unknown>,
  actorId: string,
  creating: boolean,
): void {
  const columns = adminColumns(admin.model);
  if (creating && "createdBy" in columns) data.createdBy = actorId;
  if ("updatedBy" in columns) data.updatedBy = actorId;
}

/**
 * Format a metric number for display, keeping integers integral.
 *
 * @param value - The raw value.
 * @returns The formatted text.
 */
function formatMetric(value: number | string): string {
  if (typeof value === "string") return value;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/**
 * Compute one dashboard card into its view model.
 *
 * A card whose `compute` throws comes back as an error card rather than
 * propagating: one broken query should not cost the operator every other
 * number on the dashboard.
 *
 * @param card - The registered card.
 * @param dbSession - The request's DB session.
 * @returns The view model the template renders.
 */
async function computeBusinessCard(
  card: MetricCard,
  dbSession: AsyncSession,
): Promise<AdminBusinessCardView> {
  const base = {
    label: card.label,
    unit: null as string | null,
    direction: "flat" as const,
    percent: null as string | null,
    previous: "",
    segments: [] as { label: string; value: string; percent: number }[],
    helpText: card.helpText ?? null,
  };

  let data: CardData;
  try {
    data = await card.compute(dbSession);
  } catch (error) {
    logger.warning("Admin dashboard card failed", {
      card: card.label,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ...base, kind: "value", value: "", error: "Could not compute this metric." };
  }

  if (data.kind === "partition") {
    const total = partitionTotal(data);
    return {
      ...base,
      kind: "partition",
      value: formatMetric(total),
      segments: data.segments.map((segment) => ({
        label: segment.label,
        value: formatMetric(segment.value),
        percent: total === 0 ? 0 : (segment.value / total) * 100,
      })),
      error: null,
    };
  }

  if (data.kind === "trend") {
    const percent = trendPercent(data);
    return {
      ...base,
      kind: "trend",
      value: formatMetric(data.value),
      unit: data.unit ?? null,
      direction: trendDirection(data),
      percent:
        percent === null ? null : `${percent >= 0 ? "+" : ""}${percent.toFixed(1)}%`,
      previous: formatMetric(data.previous),
      error: null,
    };
  }

  return {
    ...base,
    kind: "value",
    value: formatMetric(data.value),
    unit: data.unit ?? null,
    error: null,
  };
}

/**
 * Return the bulk actions a configuration offers, as dropdown options.
 *
 * Activation toggles need `canEdit` and an `isActive` column; delete needs
 * `canDelete`. Custom actions are namespaced `custom:<name>` so their values can
 * never collide with a built-in one.
 *
 * @param admin - The model configuration.
 * @returns The options (empty when no mutation is permitted).
 */
function bulkActionsFor(admin: AdminModel): BulkActionOption[] {
  const actions: BulkActionOption[] = [];
  const hasActiveFlag = "isActive" in adminColumns(admin.model);
  if (admin.canEdit && hasActiveFlag) {
    actions.push({ value: "activate", label: "Activate", dangerous: false });
    actions.push({ value: "deactivate", label: "Deactivate", dangerous: false });
  }
  if (admin.canDelete) {
    actions.push({ value: "delete", label: "Delete", dangerous: true });
  }
  for (const action of admin.customActions()) {
    actions.push({
      value: `custom:${action.name}`,
      label: action.label,
      dangerous: action.dangerous,
    });
  }
  return actions;
}

/**
 * Render one exported value into something CSV and JSON can both carry.
 *
 * @param value - The stored value.
 * @returns An ISO string for dates, a decimal string for `bigint`, base64 for
 *   binary, and the value unchanged otherwise.
 */
function exportValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
  return value;
}

/**
 * Quote one CSV field per RFC 4180.
 *
 * @param value - The already-exported value.
 * @returns The field text, quoted when it carries a comma, quote or newline.
 */
function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * Serialize rows to a CSV document with a header row.
 *
 * @param columns - Column keys, in header and value order.
 * @param rows - The rows to serialize.
 * @returns The CSV text, CRLF-delimited as the format specifies.
 */
function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const lines = [columns.map(csvField).join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvField(exportValue(row[column]))).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

/**
 * Serialize rows to a JSON array of column→value objects.
 *
 * @param columns - Column keys to include.
 * @param rows - The rows to serialize.
 * @returns The JSON text.
 */
function toJson(columns: string[], rows: Record<string, unknown>[]): string {
  return JSON.stringify(
    rows.map((row) =>
      Object.fromEntries(columns.map((column) => [column, exportValue(row[column])])),
    ),
    null,
    2,
  );
}

/**
 * Turn a rejected write into a message the operator can act on.
 *
 * A database that refuses a row — a unique index, a foreign key, a `NOT NULL` —
 * is a user error, not a server fault, so it comes back through the form with a
 * `400` instead of escaping as a `500`.
 *
 * @param admin - The model configuration whose write failed.
 * @param error - The thrown value.
 * @returns A human-readable message.
 */
function describeWriteFailure(admin: AdminModel, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `The database refused this ${admin.verboseName().toLowerCase()}: ${detail}`;
}
