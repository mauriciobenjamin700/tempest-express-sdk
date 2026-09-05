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

import type { AdminAuthBackend } from "@/admin/auth";
import {
  adminColumns,
  filterForColumn,
  humanizeField,
  isSearchableColumn,
} from "@/admin/columns";
import type { AdminModel } from "@/admin/config";
import { buildFormFields, formatCellValue, parseFormBody } from "@/admin/forms";
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
import { resolveAdminTheme } from "@/admin/theme";
import { JSONLogger } from "@/core";
import type { AsyncEngine, AsyncSession, Condition, WhereInput } from "@/db";
import { and, or } from "@/db";
import { MetricsUtils } from "@/utils";
import express, { type Request, type Response, type Router } from "express";

const logger = new JSONLogger("tempest_express_sdk.admin.router");

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
}

/** The per-request state the authenticated handlers share. */
interface AdminRequestState {
  session: AdminSession;
  dbSession: AsyncSession;
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
  const context = (req: Request, session: AdminSession | null): AdminRenderContext => ({
    site,
    theme,
    prefix,
    session,
    currentPath: req.originalUrl.split("?")[0] ?? req.path,
    navModels: site.list().map((admin) => ({
      label: admin.verboseNamePlural(),
      url: `${prefix}/m/${admin.slug()}`,
    })),
    messages: flashFor(req),
  });

  /**
   * Resolve the fixed outcome code a redirect carries into a banner.
   *
   * @param req - The inbound request.
   * @returns The banners to render (empty when the request carries none).
   */
  const flashFor = (req: Request): AdminMessage[] => {
    const message = FLASH_MESSAGES[queryString(req.query.ok)];
    return message === undefined ? [] : [message];
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
    return { session, dbSession };
  };

  /**
   * Resolve the model configuration a URL slug names.
   *
   * @param req - The inbound request.
   * @param res - The outbound response.
   * @param state - The authenticated request state.
   * @returns The configuration, or `null` when a 404 was already sent.
   */
  const resolveAdmin = (
    req: Request,
    res: Response,
    state: AdminRequestState,
  ): AdminModel | null => {
    const admin = site.get(String(req.params.slug));
    if (admin === null) {
      html(res, renderNotFound(context(req, state.session)), 404);
      return null;
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
    html(res, renderNotFound(context(req, state.session)), 403);
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
      for (const admin of site.list()) {
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
          newUrl: admin.canCreate ? `${prefix}/m/${admin.slug()}/new` : null,
        });
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

      html(res, renderDashboardPage(context(req, state.session), cards, metrics));
    }),
  );

  router.get(
    `${prefix}/m/:slug`,
    guarded(async (req, res) => {
      const state = await authenticate(req, res);
      if (state === null) return;
      const admin = resolveAdmin(req, res, state);
      if (admin === null) return;
      html(res, await renderList(req, admin, state));
    }),
  );

  router.get(
    `${prefix}/m/:slug/new`,
    guarded(async (req, res) => {
      const state = await authenticate(req, res);
      if (state === null) return;
      const admin = resolveAdmin(req, res, state);
      if (admin === null) return;
      if (!admin.canCreate) {
        html(res, renderNotFound(context(req, state.session)), 404);
        return;
      }
      html(
        res,
        renderFormPage(context(req, state.session), {
          mode: "create",
          title: admin.verboseName(),
          fields: buildFormFields(admin),
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
      const admin = resolveAdmin(req, res, state);
      if (admin === null) return;
      if (!admin.canCreate) {
        html(res, renderNotFound(context(req, state.session)), 404);
        return;
      }
      if (!checkCsrf(req, res, state)) return;

      const body = req.body as Record<string, unknown>;
      const parsed = parseFormBody(admin, body);
      const rerender = (error: string | null, status: number): void => {
        html(
          res,
          renderFormPage(context(req, state.session), {
            mode: "create",
            title: admin.verboseName(),
            fields: buildFormFields(admin, { values: body, errors: parsed.errors }),
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
    `${prefix}/m/:slug/:identity`,
    guarded(async (req, res) => {
      const state = await authenticate(req, res);
      if (state === null) return;
      const admin = resolveAdmin(req, res, state);
      if (admin === null) return;
      const row = await findRow(admin, state.dbSession, String(req.params.identity));
      if (row === null) {
        html(res, renderNotFound(context(req, state.session)), 404);
        return;
      }
      const identity = String(row[admin.identityField]);
      html(
        res,
        renderDetailPage(context(req, state.session), {
          title: admin.verboseName(),
          identity,
          fields: admin
            .detailFieldNames()
            .map((name) => ({ label: name, value: formatCellValue(row[name]) })),
          backUrl: `${prefix}/m/${admin.slug()}`,
          editUrl: admin.canEdit ? `${prefix}/m/${admin.slug()}/${identity}/edit` : null,
          deleteUrl: admin.canDelete
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
      const admin = resolveAdmin(req, res, state);
      if (admin === null) return;
      const identity = String(req.params.identity);
      const row = admin.canEdit ? await findRow(admin, state.dbSession, identity) : null;
      if (row === null) {
        html(res, renderNotFound(context(req, state.session)), 404);
        return;
      }
      html(
        res,
        renderFormPage(context(req, state.session), {
          mode: "edit",
          title: admin.verboseName(),
          fields: buildFormFields(admin, { values: row }),
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
      const admin = resolveAdmin(req, res, state);
      if (admin === null) return;
      const identity = String(req.params.identity);
      if (!admin.canEdit) {
        html(res, renderNotFound(context(req, state.session)), 404);
        return;
      }
      if (!checkCsrf(req, res, state)) return;

      const body = req.body as Record<string, unknown>;
      const parsed = parseFormBody(admin, body);
      const rerender = (error: string | null, status: number): void => {
        html(
          res,
          renderFormPage(context(req, state.session), {
            mode: "edit",
            title: admin.verboseName(),
            fields: buildFormFields(admin, { values: body, errors: parsed.errors }),
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
      try {
        const changed = await admin
          .repository(state.dbSession)
          .update({ [admin.identityField]: identity } as never, parsed.data as never);
        if (changed === 0) {
          html(res, renderNotFound(context(req, state.session)), 404);
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
      const admin = resolveAdmin(req, res, state);
      if (admin === null) return;
      if (!admin.canDelete) {
        html(res, renderNotFound(context(req, state.session)), 404);
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
    const search = queryString(req.query.q);
    const page = Math.max(1, Number.parseInt(queryString(req.query.page), 10) || 1);
    const sortField = queryString(req.query.sort);
    const sortColumn = sortField in columns ? sortField : null;
    const ascending =
      sortColumn === null ? admin.orderAscending : queryString(req.query.dir) !== "desc";

    const conditions: (WhereInput<Record<string, unknown>> | Condition)[] = [];
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
      const value = queryString(req.query[`filter_${field}`]);
      if (value !== "") {
        conditions.push({
          [field]: column.type.kind === "boolean" ? value === "true" : value,
        });
      }
      filterViews.push({
        field,
        label: humanizeField(field),
        kind: spec.kind,
        value,
        valueFrom: "",
        valueTo: "",
        options: spec.options.map((option) => ({
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

    const where = conditions.length === 0 ? undefined : and(...conditions);
    const orderBy = sortColumn ?? admin.orderKey ?? undefined;
    const result = await admin.repository(state.dbSession).paginate({
      page,
      pageSize: admin.pageSize,
      ...(orderBy === undefined ? {} : { orderBy: orderBy as never }),
      ascending,
      ...(where === undefined ? {} : { filters: where as never }),
    });

    const displayed = admin.listDisplayNames();
    const baseQuery: Record<string, string> = { q: search };
    for (const view of filterViews) {
      if (view.kind === "daterange") {
        baseQuery[`filter_${view.field}_from`] = view.valueFrom;
        baseQuery[`filter_${view.field}_to`] = view.valueTo;
      } else {
        baseQuery[`filter_${view.field}`] = view.value;
      }
    }

    const sort: Record<string, AdminSortView> = {};
    for (const column of displayed) {
      if (!(column in columns)) continue;
      const active = (sortColumn ?? admin.orderKey) === column;
      const nextAscending = active ? !ascending : true;
      sort[column] = {
        url: `?${buildQuery({
          ...baseQuery,
          sort: column,
          dir: nextAscending ? "asc" : "desc",
        })}`,
        active,
        ascending,
      };
    }

    const pageUrl = (target: number): string =>
      `?${buildQuery({
        ...baseQuery,
        sort: sortColumn ?? undefined,
        dir: sortColumn === null ? undefined : ascending ? "asc" : "desc",
        page: target,
      })}`;

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
      searchable: searchable.length > 0,
      searchValue: search,
      filters: filterViews,
      sort,
      newUrl: admin.canCreate ? `${prefix}/m/${admin.slug()}/new` : null,
    };

    return renderListPage(context(req, state.session), view);
  }

  return router;
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
