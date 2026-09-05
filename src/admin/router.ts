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

import { randomUUID } from "node:crypto";
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
  isColumnOptional,
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
import type { AdminFormField } from "@/admin/forms";
import {
  buildFormFields,
  foreignKeyFields,
  foreignKeyLabel,
  formatCellValue,
  parseFormBody,
} from "@/admin/forms";
import type { AdminInline } from "@/admin/inlines";
import {
  type AdminLogEntry,
  filterLogEntries,
  renderLogEntriesJson,
  renderLogEntriesMarkdown,
  toLogEntry,
} from "@/admin/logs";
import {
  MultipartLimitError,
  type UploadedFile,
  isMultipart,
  parseMultipart,
} from "@/admin/multipart";
import { type AdminAccessPolicy, AdminPermission } from "@/admin/permissions";
import { type AdminSession, AdminSessionStore, csrfTokenMatches } from "@/admin/session";
import type { AdminSite } from "@/admin/site";
import {
  type SqlAuditEntry,
  type SqlAuditHook,
  SqlCapability,
  type SqlConsolePolicy,
  analyzeSql,
  checkSqlPolicy,
  loadSqlParser,
} from "@/admin/sqlConsole";
import { ADMIN_CSS } from "@/admin/styles";
import {
  type AdminDashboardCard,
  type AdminDashboardMetrics,
  type AdminFilterView,
  type AdminInlineRowView,
  type AdminInlineView,
  type AdminListView,
  type AdminMessage,
  type AdminRenderContext,
  type AdminSortView,
  renderDashboardPage,
  renderDetailPage,
  renderFormPage,
  renderImportPage,
  renderListPage,
  renderLoginPage,
  renderLogsPage,
  renderMfaPage,
  renderSqlPage,
} from "@/admin/templates";
import type {
  AdminAuditEntryView,
  AdminAuditView,
  AdminBusinessCardView,
} from "@/admin/templates";
import { resolveAdminTheme } from "@/admin/theme";
import { type LogSource, readLogEntries } from "@/api/logs";
import { JSONLogger } from "@/core";
import { BaseRepository } from "@/db";
import type { AsyncEngine, AsyncSession, Column, Condition, WhereInput } from "@/db";
import { and, or } from "@/db";
import { MetricsUtils } from "@/utils";
import express, { type Request, type Response, type Router } from "express";

const logger = new JSONLogger("tempest_express_sdk.admin.router");

/** Log source selectors the page offers. */
const LOG_SOURCES = ["all", "debug", "info", "warning", "error", "500"] as const;

/** Records per page on the logs page. */
const LOG_PAGE_SIZE = 50;

/** Cap on records a log export writes. */
const LOG_EXPORT_MAX = 500;

/** Cap on child rows an inline block renders. */
const INLINE_ROW_LIMIT = 50;

/** Cap on options an autocomplete search returns. */
const AUTOCOMPLETE_LIMIT = 20;

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
  /** Largest upload the panel accepts, in bytes. Default `10485760` (10 MB). */
  maxUploadBytes?: number;
  /**
   * Expose the application-logs page, reading the JSON files
   * `configureFileLogging` writes to this directory. Omitted keeps the page
   * off: the payload carries tracebacks and request metadata.
   */
  logDir?: string;
  /**
   * Expose the SQL console. Omitted keeps it off. Read the guard rails in
   * `@/admin/sqlConsole` before enabling it: the policy is defence in depth,
   * and the boundary that holds is the database user behind `run`.
   */
  sqlConsole?: AdminSqlConsoleOptions;
}

/** Configuration for the optional SQL console. */
export interface AdminSqlConsoleOptions {
  /** The rules enforced before anything runs. Defaults to read-only. */
  policy?: SqlConsolePolicy;
  /**
   * Executes an approved statement. Omitted runs it on the request's own
   * session — point this at a restricted database role instead whenever the
   * console can do more than read.
   */
  run?: (sql: string, session: AsyncSession) => Promise<Record<string, unknown>[]>;
  /** Parser dialect. Default `"postgresql"`. */
  dialect?: string;
  /** Called for every attempt, allowed or refused. */
  onAudit?: SqlAuditHook;
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
  const systemNav: { label: string; url: string }[] = [];
  if (options.logDir !== undefined) {
    systemNav.push({ label: "Logs", url: `${prefix}/logs` });
  }
  if (options.sqlConsole !== undefined) {
    systemNav.push({ label: "SQL console", url: `${prefix}/sql` });
  }
  const maxUploadBytes = options.maxUploadBytes ?? 10 * 1024 * 1024;
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
    navSystem: systemNav,
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

  if (options.logDir !== undefined) {
    const logDir = options.logDir;

    router.get(
      `${prefix}/logs`,
      guarded(async (req, res) => {
        const state = await authenticate(req, res);
        if (state === null) return;
        const { entries, source, search } = await readLogs(req, logDir);
        const page = Math.max(1, Number.parseInt(queryString(req.query.page), 10) || 1);
        const start = (page - 1) * LOG_PAGE_SIZE;
        const pages = Math.max(1, Math.ceil(entries.length / LOG_PAGE_SIZE));
        const exportUrl = (format: string): string =>
          `${prefix}/logs/export?${buildQuery({ source, q: search, format })}`;
        const pageUrl = (target: number): string =>
          `?${buildQuery({ source, q: search, page: target })}`;

        html(
          res,
          renderLogsPage(context(req, state.session, state.visible), {
            sources: LOG_SOURCES.map((value) => ({
              value,
              label: value === "500" ? "HTTP 500" : humanizeField(value),
              selected: value === source,
            })),
            query: search,
            rows: entries.slice(start, start + LOG_PAGE_SIZE).map((entry) => ({
              level: entry.level,
              timestamp: entry.timestamp,
              logger: entry.logger,
              message: entry.message,
              stack: entry.stack,
              context: Object.entries(entry.context).map(([key, value]) => ({
                key,
                value: typeof value === "string" ? value : JSON.stringify(value),
              })),
            })),
            total: entries.length,
            page,
            pages,
            prevUrl: page > 1 ? pageUrl(page - 1) : null,
            nextUrl: page < pages ? pageUrl(page + 1) : null,
            exportMarkdownUrl: exportUrl("md"),
            exportJsonUrl: exportUrl("json"),
            exportMax: LOG_EXPORT_MAX,
          }),
        );
      }),
    );

    router.get(
      `${prefix}/logs/export`,
      guarded(async (req, res) => {
        const state = await authenticate(req, res);
        if (state === null) return;
        const format = queryString(req.query.format) === "json" ? "json" : "md";
        const { entries, source, search } = await readLogs(req, logDir);
        const window = entries.slice(0, LOG_EXPORT_MAX);

        const payload =
          format === "json"
            ? renderLogEntriesJson(window)
            : renderLogEntriesMarkdown(window, {
                source,
                query: search,
                total: entries.length,
              });
        res
          .status(200)
          .type(format === "json" ? "application/json" : "text/markdown; charset=utf-8")
          .set("content-disposition", `attachment; filename="logs.${format}"`)
          .send(payload);
      }),
    );
  }

  if (options.sqlConsole !== undefined) {
    const console_ = options.sqlConsole;
    const policy = console_.policy ?? {};
    const dialect = console_.dialect ?? "postgresql";
    const capabilities = policy.capabilities ?? [SqlCapability.READ];
    const maxRows = policy.maxRows ?? 200;

    router.get(
      `${prefix}/sql`,
      guarded(async (req, res) => {
        const state = await authenticate(req, res);
        if (state === null) return;
        html(
          res,
          renderSqlPage(context(req, state.session, state.visible), {
            sql: "",
            capabilities: [...capabilities],
            error: null,
            columns: [],
            rows: [],
            rowCount: null,
            truncated: false,
            durationMs: null,
          }),
        );
      }),
    );

    router.post(
      `${prefix}/sql`,
      guarded(async (req, res) => {
        const state = await authenticate(req, res);
        if (state === null) return;
        if (!checkCsrf(req, res, state)) return;

        const body = req.body as Record<string, unknown>;
        const sql = typeof body.sql === "string" ? body.sql : "";
        const principal = backend.displayName(state.principal as never);

        const render = (view: {
          error: string | null;
          columns: string[];
          rows: string[][];
          rowCount: number | null;
          truncated: boolean;
          durationMs: number | null;
        }): void => {
          html(
            res,
            renderSqlPage(context(req, state.session, state.visible), {
              sql,
              capabilities: [...capabilities],
              ...view,
            }),
            view.error === null ? 200 : 400,
          );
        };

        const parser = await loadSqlParser();
        const analysis = analyzeSql(sql, dialect, parser);
        const verdict = checkSqlPolicy(analysis, policy);

        if (!verdict.allowed) {
          await audit(console_.onAudit, {
            sql,
            principal,
            allowed: false,
            reason: verdict.reason,
            analysis,
            durationMs: null,
            rowCount: null,
          });
          render({
            error: verdict.reason,
            columns: [],
            rows: [],
            rowCount: null,
            truncated: false,
            durationMs: null,
          });
          return;
        }

        const started = Date.now();
        let rows: Record<string, unknown>[];
        try {
          rows =
            console_.run === undefined
              ? await state.dbSession.raw(sql).all()
              : await console_.run(sql, state.dbSession);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await audit(console_.onAudit, {
            sql,
            principal,
            allowed: true,
            reason: message,
            analysis,
            durationMs: Date.now() - started,
            rowCount: null,
          });
          render({
            error: message,
            columns: [],
            rows: [],
            rowCount: null,
            truncated: false,
            durationMs: null,
          });
          return;
        }

        const durationMs = Date.now() - started;
        await audit(console_.onAudit, {
          sql,
          principal,
          allowed: true,
          reason: null,
          analysis,
          durationMs,
          rowCount: rows.length,
        });

        const window = rows.slice(0, maxRows);
        const columns = window.length === 0 ? [] : Object.keys(window[0] ?? {});
        render({
          error: null,
          columns,
          rows: window.map((row) =>
            columns.map((column) => formatCellValue(row[column])),
          ),
          rowCount: rows.length,
          truncated: rows.length > window.length,
          durationMs,
        });
      }),
    );
  }

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
            autocompleteUrls: autocompleteUrlsFor(admin),
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
      let uploadError: string | null = null;
      let submission: { fields: Record<string, unknown>; files: UploadedFile[] };
      try {
        submission = await readSubmission(req);
      } catch (error) {
        if (!(error instanceof MultipartLimitError)) throw error;
        submission = { fields: {}, files: [] };
        uploadError = error.message;
      }
      const body = submission.fields;
      if (uploadError === null && !csrfTokenMatches(state.session, body.csrf_token)) {
        html(res, renderNotFound(context(req, state.session, state.visible)), 403);
        return;
      }
      const parsed = parseFormBody(admin, body);
      await applyUploads(admin, parsed.data, parsed.errors, submission.files, true);
      const foreignKeyOptions = await foreignKeyOptionsFor(admin, state.dbSession);
      const autocompleteLabels = await autocompleteLabelsFor(
        admin,
        body,
        state.dbSession,
      );
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
              autocompleteUrls: autocompleteUrlsFor(admin),
              autocompleteLabels: autocompleteLabels,
            }),
            actionUrl: `${prefix}/m/${admin.slug()}/new`,
            backUrl: `${prefix}/m/${admin.slug()}`,
            error,
          }),
          status,
        );
      };

      if (uploadError !== null) {
        rerender(uploadError, 400);
        return;
      }
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
    `${prefix}/m/:slug/import`,
    guarded(async (req, res) => {
      const state = await authenticate(req, res);
      if (state === null) return;
      const admin = await resolveAdmin(req, res, state, AdminPermission.CREATE);
      if (admin === null) return;
      if (!admin.canImport) {
        html(res, renderNotFound(context(req, state.session, state.visible)), 404);
        return;
      }
      html(res, renderImport(req, state, admin, null, null, []));
    }),
  );

  router.post(
    `${prefix}/m/:slug/import`,
    guarded(async (req, res) => {
      const state = await authenticate(req, res);
      if (state === null) return;
      const admin = await resolveAdmin(req, res, state, AdminPermission.CREATE);
      if (admin === null) return;
      if (!admin.canImport) {
        html(res, renderNotFound(context(req, state.session, state.visible)), 404);
        return;
      }

      let submission: { fields: Record<string, unknown>; files: UploadedFile[] };
      try {
        submission = await readSubmission(req);
      } catch (error) {
        if (!(error instanceof MultipartLimitError)) throw error;
        html(res, renderImport(req, state, admin, error.message, null, []), 400);
        return;
      }
      if (!csrfTokenMatches(state.session, submission.fields.csrf_token)) {
        html(res, renderNotFound(context(req, state.session, state.visible)), 403);
        return;
      }

      const file = submission.files[0];
      if (file === undefined) {
        html(
          res,
          renderImport(req, state, admin, "Choose a CSV file to import.", null, []),
          400,
        );
        return;
      }

      let rows: Record<string, string>[];
      try {
        rows = parseCsv(file.data.toString("utf8"));
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Could not read the file as UTF-8 CSV.";
        html(res, renderImport(req, state, admin, message, null, []), 400);
        return;
      }

      const repository = admin.repository(state.dbSession);
      const actorId = backend.principalId(state.principal as never);
      const rowErrors: { row: number; message: string }[] = [];
      let created = 0;

      for (const [index, row] of rows.entries()) {
        const parsed = parseFormBody(admin, row, { uploadsAsText: true });
        const failures = Object.entries(parsed.errors);
        if (failures.length > 0) {
          rowErrors.push({
            row: index + 2,
            message: failures.map(([field, error]) => `${field}: ${error}`).join("; "),
          });
          continue;
        }
        stampActor(admin, parsed.data, actorId, true);
        try {
          await repository.create(parsed.data as never);
          created += 1;
        } catch (error) {
          rowErrors.push({
            row: index + 2,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      html(res, renderImport(req, state, admin, null, created, rowErrors));
    }),
  );

  router.get(
    `${prefix}/m/:slug/autocomplete/:field`,
    guarded(async (req, res) => {
      if (sessions.load(req) === null) {
        res.status(401).json({ options: [] });
        return;
      }
      const state = await authenticate(req, res);
      if (state === null) return;
      const admin = site.get(String(req.params.slug));
      const field = String(req.params.field);
      if (
        admin === null ||
        !admin.autocompleteFields.includes(field) ||
        !(await allows(state.principal, admin, AdminPermission.VIEW))
      ) {
        res.status(404).json({ options: [] });
        return;
      }

      const column = adminColumns(admin.model)[field];
      const table = column === undefined ? null : foreignKeyTable(column);
      const referenced = table === null ? null : site.get(table);
      if (referenced === null) {
        res.json({ options: [] });
        return;
      }

      const term = queryString(req.query.q);
      const searchable = referenced.searchFields.filter((name) => {
        const target = adminColumns(referenced.model)[name];
        return target !== undefined && isSearchableColumn(target);
      });
      const filters =
        term === "" || searchable.length === 0
          ? undefined
          : or(...searchable.map((name) => ({ [name]: { ilike: `%${term}%` } })));

      const page = await referenced.repository(state.dbSession).paginate({
        page: 1,
        pageSize: AUTOCOMPLETE_LIMIT,
        ...(filters === undefined ? {} : { filters: filters as never }),
      });

      res.json({
        options: (page.items as Record<string, unknown>[]).map((row) => ({
          value: String(row[referenced.identityField]),
          label: foreignKeyLabel(referenced, row),
        })),
      });
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
          inlines: await buildInlines(admin, row, state, identity),
          inlineError: null,
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
            autocompleteUrls: autocompleteUrlsFor(admin),
            autocompleteLabels: await autocompleteLabelsFor(admin, row, state.dbSession),
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
      let uploadError: string | null = null;
      let submission: { fields: Record<string, unknown>; files: UploadedFile[] };
      try {
        submission = await readSubmission(req);
      } catch (error) {
        if (!(error instanceof MultipartLimitError)) throw error;
        submission = { fields: {}, files: [] };
        uploadError = error.message;
      }
      const body = submission.fields;
      if (uploadError === null && !csrfTokenMatches(state.session, body.csrf_token)) {
        html(res, renderNotFound(context(req, state.session, state.visible)), 403);
        return;
      }
      const parsed = parseFormBody(admin, body);
      await applyUploads(admin, parsed.data, parsed.errors, submission.files, false);
      const foreignKeyOptions = await foreignKeyOptionsFor(admin, state.dbSession);
      const autocompleteLabels = await autocompleteLabelsFor(
        admin,
        body,
        state.dbSession,
      );
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
              autocompleteUrls: autocompleteUrlsFor(admin),
              autocompleteLabels: autocompleteLabels,
            }),
            actionUrl: `${prefix}/m/${admin.slug()}/${identity}/edit`,
            backUrl: `${prefix}/m/${admin.slug()}/${identity}`,
            error,
          }),
          status,
        );
      };

      if (uploadError !== null) {
        rerender(uploadError, 400);
        return;
      }
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
    `${prefix}/m/:slug/:identity/inlines/:child`,
    guarded(async (req, res) => {
      const state = await authenticate(req, res);
      if (state === null) return;
      const admin = await resolveAdmin(req, res, state);
      if (admin === null) return;
      if (!checkCsrf(req, res, state)) return;

      const childSlug = String(req.params.child);
      const inline = admin.inlines.find(
        (entry) => entry.slug === childSlug && entry.editable,
      );
      const childAdmin = inline === undefined ? null : site.get(childSlug);
      if (
        inline === undefined ||
        childAdmin === null ||
        !(await allows(state.principal, childAdmin, AdminPermission.EDIT))
      ) {
        html(res, renderNotFound(context(req, state.session, state.visible)), 404);
        return;
      }

      const identity = String(req.params.identity);
      const parent = await findRow(admin, state.dbSession, identity);
      if (parent === null) {
        html(res, renderNotFound(context(req, state.session, state.visible)), 404);
        return;
      }
      const parentId = parent[admin.identityField];

      const { rows: grouped, deletions } = groupInlineSubmission(
        req.body as Record<string, unknown>,
      );
      const names = inlineFieldNames(childAdmin, inline);
      const childRepo = childAdmin.repository(state.dbSession);
      const actorId = backend.principalId(state.principal as never);
      const canDelete =
        inline.canDelete &&
        (await allows(state.principal, childAdmin, AdminPermission.DELETE));

      const failed: InlineRowSubmission[] = [];
      let formError: string | null = null;

      /**
       * Return the child row for a key when it really belongs to this parent.
       *
       * A formset key arrives from the browser, so a crafted submission could
       * name a child of some other parent. Checking ownership here is what
       * keeps the page from becoming an edit surface for the whole table.
       *
       * @param key - The submitted row key.
       * @returns The owned row, or `null`.
       */
      const owned = async (key: string): Promise<Record<string, unknown> | null> =>
        (await childRepo.first({
          [childAdmin.identityField]: key,
          [inline.fkField]: parentId,
        } as never)) as Record<string, unknown> | null;

      for (const [key, values] of Object.entries(grouped)) {
        const isNew = key.startsWith("new");

        if (!isNew && canDelete && deletions.has(key)) {
          if ((await owned(key)) !== null) {
            await childRepo.delete({ [childAdmin.identityField]: key } as never);
          }
          continue;
        }
        if (isNew && Object.values(values).every((value) => value.trim() === "")) {
          continue;
        }

        const parsed = parseFormBody(childAdmin, values, { only: names });
        if (Object.keys(parsed.errors).length > 0) {
          failed.push({ key, values, errors: parsed.errors });
          continue;
        }

        try {
          if (isNew) {
            stampActor(childAdmin, parsed.data, actorId, true);
            await childRepo.create({
              ...parsed.data,
              [inline.fkField]: parentId,
            } as never);
          } else {
            if ((await owned(key)) === null) continue;
            stampActor(childAdmin, parsed.data, actorId, false);
            await childRepo.update(
              { [childAdmin.identityField]: key } as never,
              parsed.data as never,
            );
          }
        } catch (error) {
          formError = describeWriteFailure(childAdmin, error);
          failed.push({ key, values, errors: {} });
        }
      }

      if (failed.length > 0) {
        const fresh = (await findRow(admin, state.dbSession, identity)) ?? parent;
        html(
          res,
          renderDetailPage(context(req, state.session, state.visible), {
            title: admin.verboseName(),
            identity,
            audit: await buildAuditView(admin, fresh, state.dbSession),
            inlines: await buildInlines(admin, fresh, state, identity, {
              [childSlug]: failed,
            }),
            inlineError: formError ?? "Some inline rows could not be saved.",
            fields: admin
              .detailFieldNames()
              .map((name) => ({ label: name, value: formatCellValue(fresh[name]) })),
            backUrl: `${prefix}/m/${admin.slug()}`,
            editUrl: (await allows(state.principal, admin, AdminPermission.EDIT))
              ? `${prefix}/m/${admin.slug()}/${identity}/edit`
              : null,
            deleteUrl: (await allows(state.principal, admin, AdminPermission.DELETE))
              ? `${prefix}/m/${admin.slug()}/${identity}/delete`
              : null,
          }),
          400,
        );
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
   * Build the related-child blocks for a parent's detail view.
   *
   * A read-only inline packages the children as a table linking into the
   * child's own admin; an editable one — which needs the child registered,
   * editable and permitted for this principal — packages them as a formset
   * whose inputs are named `row.<key>.<column>`.
   *
   * @param admin - The parent configuration.
   * @param parent - The parent row.
   * @param state - The authenticated request state.
   * @param identity - The parent's identity, for the formset action URL.
   * @param overrides - On an error re-render, the submitted values and errors
   *   keyed by child slug, so the formset shows what the operator typed.
   * @returns One block per configured inline.
   */
  async function buildInlines(
    admin: AdminModel,
    parent: Record<string, unknown>,
    state: AdminRequestState,
    identity: string,
    overrides: Record<string, InlineRowSubmission[]> = {},
  ): Promise<AdminInlineView[]> {
    const parentId = parent[admin.identityField];
    const blocks: AdminInlineView[] = [];

    for (const inline of admin.inlines) {
      const childAdmin = site.get(inline.slug);
      const repository =
        childAdmin === null
          ? new BaseRepository(inline.model, state.dbSession)
          : childAdmin.repository(state.dbSession);
      const children = (await repository.list({
        [inline.fkField]: parentId,
      } as never)) as Record<string, unknown>[];

      const columns =
        inline.listDisplay ??
        childAdmin?.listDisplayNames() ??
        Object.keys(adminColumns(inline.model));
      const label =
        inline.label ?? childAdmin?.verboseNamePlural() ?? humanizeField(inline.slug);
      const visible = children.slice(0, INLINE_ROW_LIMIT);

      const editable =
        inline.editable &&
        childAdmin !== null &&
        (await allows(state.principal, childAdmin, AdminPermission.EDIT));

      const addUrl =
        childAdmin !== null &&
        (await allows(state.principal, childAdmin, AdminPermission.CREATE))
          ? `${prefix}/m/${inline.slug}/new`
          : null;

      if (!editable || childAdmin === null) {
        blocks.push({
          label,
          total: children.length,
          columns,
          editable: false,
          canDelete: false,
          addUrl,
          formAction: "",
          rows: visible.map((child) => ({
            key: String(child[childAdmin?.identityField ?? "id"]),
            cells: columns.map((column) => formatCellValue(child[column])),
            fields: [],
            url:
              childAdmin === null
                ? null
                : `${prefix}/m/${inline.slug}/${String(child[childAdmin.identityField])}`,
          })),
          newRow: null,
          truncated: children.length > visible.length,
        });
        continue;
      }

      const names = inlineFieldNames(childAdmin, inline);
      const submitted = overrides[inline.slug];
      const rows: AdminInlineRowView[] = [];

      if (submitted !== undefined) {
        for (const entry of submitted) {
          rows.push({
            key: entry.key,
            cells: [],
            fields: inlineFields(
              childAdmin,
              names,
              entry.key,
              entry.values,
              entry.errors,
            ),
            url: null,
          });
        }
      } else {
        for (const child of visible) {
          const key = String(child[childAdmin.identityField]);
          rows.push({
            key,
            cells: [],
            fields: inlineFields(childAdmin, names, key, child, {}),
            url: `${prefix}/m/${inline.slug}/${key}`,
          });
        }
      }

      blocks.push({
        label,
        total: children.length,
        columns: names.map(humanizeField),
        editable: true,
        canDelete: inline.canDelete && childAdmin.canDelete,
        addUrl,
        formAction: `${prefix}/m/${admin.slug()}/${identity}/inlines/${inline.slug}`,
        rows,
        newRow: {
          key: "new1",
          cells: [],
          fields: inlineFields(childAdmin, names, "new1", {}, {}),
          url: null,
        },
        truncated: children.length > visible.length,
      });
    }

    return blocks;
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
   * Read, normalize, filter and reverse the log records a request selects.
   *
   * Shared by the page and the export so the two can never disagree about what
   * the current selection contains.
   *
   * @param req - The inbound request.
   * @param dir - The log directory.
   * @returns The matching entries newest-first, plus the resolved selectors.
   */
  async function readLogs(
    req: Request,
    dir: string,
  ): Promise<{ entries: AdminLogEntry[]; source: LogSource; search: string }> {
    const requested = queryString(req.query.source);
    const source = (LOG_SOURCES as readonly string[]).includes(requested)
      ? (requested as LogSource)
      : "all";
    const search = queryString(req.query.q);
    const raw = await readLogEntries(dir, source);
    const entries = filterLogEntries(raw.map(toLogEntry), search);
    entries.reverse();
    return { entries, source, search };
  }

  /**
   * Render the CSV import page for a model.
   *
   * @param req - The inbound request.
   * @param state - The authenticated request state.
   * @param admin - The model configuration.
   * @param error - A form-level error, or `null`.
   * @param created - How many rows were created, or `null` before a submission.
   * @param rowErrors - Per-row failures.
   * @returns The full page.
   */
  function renderImport(
    req: Request,
    state: AdminRequestState,
    admin: AdminModel,
    error: string | null,
    created: number | null,
    rowErrors: { row: number; message: string }[],
  ): string {
    return renderImportPage(context(req, state.session, state.visible), {
      title: admin.verboseNamePlural(),
      actionUrl: `${prefix}/m/${admin.slug()}/import`,
      backUrl: `${prefix}/m/${admin.slug()}`,
      columns: admin.editableFieldNames(),
      error,
      created,
      rowErrors,
    });
  }

  /**
   * Read a submitted form, whether it arrived urlencoded or multipart.
   *
   * Express parses the urlencoded case on its own; a form carrying a file needs
   * the multipart parser, so this is the one place a handler asks for "the
   * fields and the files" and stops caring which encoding produced them.
   *
   * @param req - The inbound request.
   * @returns The text fields and any uploaded files.
   * @throws MultipartLimitError When a size or count limit is exceeded.
   */
  async function readSubmission(
    req: Request,
  ): Promise<{ fields: Record<string, unknown>; files: UploadedFile[] }> {
    if (!isMultipart(req)) {
      return { fields: (req.body ?? {}) as Record<string, unknown>, files: [] };
    }
    const parsed = await parseMultipart(req, { maxFileBytes: maxUploadBytes });
    return { fields: parsed.fields, files: parsed.files };
  }

  /**
   * Persist uploaded files and write their storage keys into the payload.
   *
   * On create a required upload column with no file is a field error; on edit
   * an absent file leaves the column out of the update entirely, so "no new
   * file" keeps the current one rather than clearing it.
   *
   * @param admin - The model configuration being written.
   * @param data - The coerced payload, mutated in place.
   * @param errors - Per-field errors, added to in place.
   * @param files - The uploaded files from this submission.
   * @param creating - Whether this is a create.
   */
  async function applyUploads(
    admin: AdminModel,
    data: Record<string, unknown>,
    errors: Record<string, string>,
    files: UploadedFile[],
    creating: boolean,
  ): Promise<void> {
    if (admin.uploadFields.length === 0) return;
    const storage = admin.uploadStorage;
    if (storage === null) return;
    const columns = adminColumns(admin.model);

    for (const field of admin.uploadFields) {
      const file = files.find((candidate) => candidate.field === field);
      if (file === undefined) {
        const column = columns[field];
        if (creating && column !== undefined && !isColumnOptional(column)) {
          errors[field] = "This field is required.";
        }
        continue;
      }
      const extension = file.filename.includes(".")
        ? `.${file.filename.split(".").pop()}`
        : "";
      const key = `${admin.slug()}/${field}/${randomUUID()}${extension}`;
      const saved = await storage.save(key, file.data, { contentType: file.contentType });
      data[field] = saved.key;
    }
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
      importUrl:
        admin.canImport && (await allows(state.principal, admin, AdminPermission.CREATE))
          ? `${prefix}/m/${admin.slug()}/import`
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
      if (admin.autocompleteFields.includes(field)) continue;
      const column = columns[field];
      if (column === undefined) continue;
      const related = await relatedOptions(column, dbSession);
      if (related !== null) options[field] = related;
    }
    return options;
  }

  /**
   * Return the search endpoint for each autocomplete column.
   *
   * @param admin - The model configuration.
   * @returns Endpoint URLs keyed by column.
   */
  function autocompleteUrlsFor(admin: AdminModel): Record<string, string> {
    const urls: Record<string, string> = {};
    for (const field of admin.autocompleteFields) {
      urls[field] = `${prefix}/m/${admin.slug()}/autocomplete/${field}`;
    }
    return urls;
  }

  /**
   * Resolve the current label for each autocomplete column of a row, so an
   * edit form opens showing the related row's name rather than its id.
   *
   * @param admin - The model configuration.
   * @param row - The record being edited, or `null` on create.
   * @param dbSession - The request's DB session.
   * @returns Labels keyed by column.
   */
  async function autocompleteLabelsFor(
    admin: AdminModel,
    row: Record<string, unknown> | null,
    dbSession: AsyncSession,
  ): Promise<Record<string, string>> {
    const labels: Record<string, string> = {};
    if (row === null) return labels;
    const columns = adminColumns(admin.model);
    for (const field of admin.autocompleteFields) {
      const value = row[field];
      if (value === null || value === undefined || value === "") continue;
      const column = columns[field];
      const table = column === undefined ? null : foreignKeyTable(column);
      const referenced = table === null ? null : site.get(table);
      if (referenced === null) continue;
      const related = (await referenced
        .repository(dbSession)
        .first({ [referenced.identityField]: value } as never)) as Record<
        string,
        unknown
      > | null;
      if (related !== null) labels[field] = foreignKeyLabel(referenced, related);
    }
    return labels;
  }

  return router;
}

/**
 * Group a posted formset body by row key.
 *
 * Inputs arrive named `row.<key>.<column>`, plus `row.<key>.__delete` for the
 * per-row delete checkbox. Anything else in the body — the CSRF token — is
 * ignored here.
 *
 * @param body - The parsed request body.
 * @returns The values keyed by row, and the row keys marked for deletion.
 */
export function groupInlineSubmission(body: Record<string, unknown>): {
  rows: Record<string, Record<string, string>>;
  deletions: Set<string>;
} {
  const rows: Record<string, Record<string, string>> = {};
  const deletions = new Set<string>();

  for (const [key, raw] of Object.entries(body)) {
    if (!key.startsWith("row.")) continue;
    const parts = key.split(".");
    if (parts.length !== 3) continue;
    const [, rowKey, field] = parts as [string, string, string];
    const value = typeof raw === "string" ? raw : "";

    if (field === "__delete") {
      if (!["", "false", "off", "0", "no"].includes(value.trim().toLowerCase())) {
        deletions.add(rowKey);
      }
      continue;
    }
    const row = rows[rowKey] ?? {};
    row[field] = value;
    rows[rowKey] = row;
  }

  return { rows, deletions };
}

/** One submitted inline row, kept for an error re-render. */
interface InlineRowSubmission {
  /** Row key — a child identity, or `new<n>` for an added row. */
  key: string;
  /** The raw submitted values, keyed by column. */
  values: Record<string, string>;
  /** Per-column errors. */
  errors: Record<string, string>;
}

/**
 * Return the columns an inline formset edits.
 *
 * The foreign key pointing back at the parent is held out: the row's parent is
 * the page it is on, and offering it as an input would let an operator move a
 * child to another parent by typing a UUID into a table cell.
 *
 * @param childAdmin - The child model's configuration.
 * @param inline - The inline configuration.
 * @returns The editable column keys.
 */
function inlineFieldNames(childAdmin: AdminModel, inline: AdminInline): string[] {
  return childAdmin
    .editableFieldNames()
    .filter(
      (name) =>
        name !== inline.fkField &&
        !childAdmin.uploadFields.includes(name) &&
        !childAdmin.autocompleteFields.includes(name),
    );
}

/**
 * Build the controls for one inline row, named `row.<key>.<column>`.
 *
 * @param childAdmin - The child model's configuration.
 * @param names - The columns this formset edits.
 * @param key - The row key.
 * @param values - Current values, keyed by column.
 * @param errors - Per-column errors.
 * @returns The row's fields, renamed for the formset.
 */
function inlineFields(
  childAdmin: AdminModel,
  names: string[],
  key: string,
  values: Record<string, unknown>,
  errors: Record<string, string>,
): AdminFormField[] {
  return buildFormFields(childAdmin, { values, errors })
    .filter((field) => names.includes(field.name))
    .map((field) => ({ ...field, name: `row.${key}.${field.name}` }));
}

/**
 * Hand one console attempt to the audit hook, never letting the hook's own
 * failure take the request down.
 *
 * An audit trail that can break the thing it audits gets turned off, so a
 * throwing hook is logged and swallowed.
 *
 * @param hook - The configured hook, or `undefined`.
 * @param entry - The attempt to record.
 */
async function audit(
  hook: SqlAuditHook | undefined,
  entry: SqlAuditEntry,
): Promise<void> {
  if (hook === undefined) return;
  try {
    await hook(entry);
  } catch (error) {
    logger.error("Admin SQL audit hook failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
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
 * Parse a CSV document into one record per row, keyed by the header.
 *
 * Implements RFC 4180 quoting rather than splitting on commas: a quoted field
 * may contain commas, newlines and doubled quotes, and an import that mangles
 * those silently corrupts exactly the rows a human took the trouble to quote.
 * The leading UTF-8 BOM Excel writes is stripped, because otherwise the first
 * header name never matches a column.
 *
 * @param text - The CSV document.
 * @returns One record per data row; `[]` when the file has only a header.
 * @throws Error When the document has no header row.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const header = rows.shift();
  if (header === undefined || header.length === 0) {
    throw new Error("The file has no header row.");
  }
  const keys = header.map((name) => name.trim());

  return rows
    .filter((entry) => entry.some((value) => value.trim() !== ""))
    .map((entry) =>
      Object.fromEntries(keys.map((key, position) => [key, entry[position] ?? ""])),
    );
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
