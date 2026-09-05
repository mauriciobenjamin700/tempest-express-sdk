/**
 * HTML rendering for the admin panel — the analog of the FastAPI SDK's jinja
 * templates, written as plain typed functions.
 *
 * There is no template engine and no external asset: every page is a string
 * built from a view model the router prepares, and the only stylesheet is the
 * one this package serves. That keeps the panel dependency-free (a template
 * engine would be a runtime dependency every consumer inherits) and keeps the
 * markup type-checked against the data that fills it.
 *
 * Every value interpolated into markup goes through {@link escapeHtml}.
 */

import type { AdminFormField } from "@/admin/forms";
import type { AdminSession } from "@/admin/session";
import type { AdminSite } from "@/admin/site";
import { type ResolvedAdminTheme, adminThemeCss } from "@/admin/theme";

/**
 * Escape a value for safe interpolation into HTML text or an attribute.
 *
 * @param value - The value to escape.
 * @returns The escaped text.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** One entry in the sidebar's model list. */
export interface AdminNavEntry {
  /** Display label. */
  label: string;
  /** Absolute URL of the model's list view. */
  url: string;
}

/** A banner shown above the page content. */
export interface AdminMessage {
  /** Message text. */
  text: string;
  /** Severity, driving the banner color: `success`, `error` or `warning`. */
  level: "success" | "error" | "warning";
}

/** Everything the chrome needs, shared by every page. */
export interface AdminRenderContext {
  /** The registered site (branding + models). */
  site: AdminSite;
  /** The site's theme, with defaults resolved. */
  theme: ResolvedAdminTheme;
  /** The router's mount prefix, without a trailing slash. */
  prefix: string;
  /** The active session, or `null` on the login and MFA pages. */
  session: AdminSession | null;
  /** The current request path, used to highlight the active sidebar item. */
  currentPath: string;
  /** Sidebar entries, one per registered model. */
  navModels: AdminNavEntry[];
  /** Banners rendered above the content. */
  messages: AdminMessage[];
}

/**
 * Wrap page content in the panel chrome: header, sidebar, footer and theme.
 *
 * The sidebar is off-canvas below 768px, opened by a checkbox the burger label
 * toggles — pure CSS, so the panel needs no JavaScript to be navigable.
 *
 * @param context - The shared chrome data.
 * @param title - The page `<title>`.
 * @param body - The already-escaped content markup.
 * @returns A complete HTML document.
 */
export function renderLayout(
  context: AdminRenderContext,
  title: string,
  body: string,
): string {
  const { site, theme, prefix, session, currentPath, navModels, messages } = context;
  const authed = session !== null;
  const indexUrl = `${prefix}/`;

  const navLink = (url: string, label: string, active: boolean): string =>
    `<a href="${escapeHtml(url)}" class="tempest-admin-sidebar__link${
      active ? " tempest-admin-sidebar__link--active" : ""
    }">${escapeHtml(label)}</a>`;

  const sidebar = authed
    ? `<label for="tempest-nav-toggle" class="tempest-admin-scrim" aria-hidden="true"></label>
    <aside class="tempest-admin-sidebar">
      <nav class="tempest-admin-sidebar__nav" aria-label="Admin navigation">
        ${navLink(indexUrl, "Dashboard", currentPath === indexUrl)}
        ${
          navModels.length > 0
            ? `<span class="tempest-admin-sidebar__heading">Models</span>${navModels
                .map((entry) =>
                  navLink(entry.url, entry.label, currentPath.startsWith(entry.url)),
                )
                .join("")}`
            : ""
        }
      </nav>
    </aside>`
    : "";

  const brand =
    theme.logoUrl !== null
      ? `<img src="${escapeHtml(theme.logoUrl)}" alt="${escapeHtml(theme.logoAlt)}" class="tempest-admin-header__logo">`
      : escapeHtml(site.brandText());

  const headerNav = authed
    ? `<nav class="tempest-admin-header__nav">
      <span class="tempest-admin-header__user">${escapeHtml(session.displayName)}</span>
      ${site.siteUrl !== null ? `<a href="${escapeHtml(site.siteUrl)}">View site</a>` : ""}
      <form method="post" action="${escapeHtml(`${prefix}/logout`)}" class="tempest-admin-header__logout">
        <input type="hidden" name="csrf_token" value="${escapeHtml(session.csrfToken)}">
        <button type="submit">Logout</button>
      </form>
    </nav>`
    : "";

  const banners =
    messages.length > 0
      ? `<ul class="tempest-admin-messages">${messages
          .map(
            (message) =>
              `<li class="tempest-admin-messages__item tempest-admin-messages__item--${escapeHtml(
                message.level,
              )}">${escapeHtml(message.text)}</li>`,
          )
          .join("")}</ul>`
      : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  ${theme.faviconUrl !== null ? `<link rel="icon" href="${escapeHtml(theme.faviconUrl)}">` : ""}
  <link rel="stylesheet" href="${escapeHtml(`${prefix}/static/admin.css`)}">
  <style>${adminThemeCss(theme)}</style>
  ${theme.customCssUrl !== null ? `<link rel="stylesheet" href="${escapeHtml(theme.customCssUrl)}">` : ""}
</head>
<body>
  ${authed ? '<input type="checkbox" id="tempest-nav-toggle" class="tempest-admin-navtoggle" hidden>' : ""}
  <header class="tempest-admin-header">
    <div class="tempest-admin-header__left">
      ${
        authed
          ? `<label for="tempest-nav-toggle" class="tempest-admin-burger" aria-label="Toggle navigation"><span></span><span></span><span></span></label>`
          : ""
      }
      <div class="tempest-admin-header__brand"><a href="${escapeHtml(indexUrl)}">${brand}</a></div>
    </div>
    ${headerNav}
  </header>
  <div class="tempest-admin-layout">
    ${sidebar}
    <main class="tempest-admin-main">
      ${banners}
      ${body}
    </main>
  </div>
  <footer class="tempest-admin-footer"><small>${escapeHtml(theme.footerText)}</small></footer>
</body>
</html>`;
}

/**
 * Render the sign-in page.
 *
 * @param context - The shared chrome data (with no session).
 * @param error - An error to show above the form, or `null`.
 * @returns The full page.
 */
export function renderLoginPage(
  context: AdminRenderContext,
  error: string | null,
): string {
  const body = `<section class="tempest-admin-login">
  <h1>Sign in</h1>
  <p>${escapeHtml(context.site.indexSubtitle)}</p>
  ${error !== null ? `<p class="tempest-admin-login__error" role="alert">${escapeHtml(error)}</p>` : ""}
  <form method="post" action="${escapeHtml(`${context.prefix}/login`)}" class="tempest-admin-login__form">
    <label><span>Email</span><input type="email" name="identifier" autocomplete="username" required autofocus></label>
    <label><span>Password</span><input type="password" name="password" autocomplete="current-password" required></label>
    <button type="submit">Sign in</button>
  </form>
</section>`;
  return renderLayout(context, `Sign in · ${context.site.title}`, body);
}

/**
 * Render the TOTP challenge shown between the password check and the panel.
 *
 * @param context - The shared chrome data (with no completed session).
 * @param error - An error to show above the form, or `null`.
 * @returns The full page.
 */
export function renderMfaPage(context: AdminRenderContext, error: string | null): string {
  const body = `<section class="tempest-admin-login">
  <h1>Two-factor code</h1>
  <p>Enter the 6-digit code from your authenticator app.</p>
  ${error !== null ? `<p class="tempest-admin-login__error" role="alert">${escapeHtml(error)}</p>` : ""}
  <form method="post" action="${escapeHtml(`${context.prefix}/mfa`)}" class="tempest-admin-login__form">
    <label><span>Code</span><input type="text" name="code" inputmode="numeric" autocomplete="one-time-code" required autofocus></label>
    <button type="submit">Verify</button>
  </form>
</section>`;
  return renderLayout(context, `Two-factor · ${context.site.title}`, body);
}

/** One model card on the dashboard. */
export interface AdminDashboardCard {
  /** Plural display name. */
  label: string;
  /** Row count, or `null` when counting failed. */
  count: number | null;
  /** URL of the list view. */
  url: string;
  /** URL of the create form, or `null` when creation is disabled. */
  newUrl: string | null;
}

/** The system metrics panel on the dashboard. */
export interface AdminDashboardMetrics {
  /** CPU load as a percentage of available cores. */
  cpuPercent: number;
  /** Memory used, as a percentage. */
  memoryPercent: number;
  /** Memory used, in GB. */
  memoryUsedGb: string;
  /** Memory total, in GB. */
  memoryTotalGb: string;
}

/**
 * Render the dashboard: one card per registered model plus the optional system
 * metrics panel.
 *
 * @param context - The shared chrome data.
 * @param cards - One entry per registered model.
 * @param metrics - The system metrics panel, or `null` when disabled.
 * @returns The full page.
 */
export function renderDashboardPage(
  context: AdminRenderContext,
  cards: AdminDashboardCard[],
  metrics: AdminDashboardMetrics | null,
): string {
  const metricsPanel =
    metrics === null
      ? ""
      : `<div class="tempest-admin-stats" aria-label="System metrics">
    <div class="tempest-admin-stat">
      <span class="tempest-admin-stat__label">CPU</span>
      <span class="tempest-admin-stat__value">${escapeHtml(metrics.cpuPercent)}%</span>
    </div>
    <div class="tempest-admin-stat">
      <span class="tempest-admin-stat__label">Memory</span>
      <span class="tempest-admin-stat__value">${escapeHtml(metrics.memoryPercent)}%</span>
      <span class="tempest-admin-stat__sub">${escapeHtml(metrics.memoryUsedGb)} / ${escapeHtml(metrics.memoryTotalGb)} GB</span>
    </div>
  </div>`;

  const models =
    cards.length > 0
      ? `<div class="tempest-admin-models">${cards
          .map(
            (card) => `<article class="tempest-admin-model-card">
      <header class="tempest-admin-model-card__head">
        <h2>${escapeHtml(card.label)}</h2>
        ${card.count !== null ? `<span class="tempest-admin-model-card__count">${escapeHtml(card.count)}</span>` : ""}
      </header>
      <div class="tempest-admin-model-card__actions">
        <a href="${escapeHtml(card.url)}">Browse</a>
        ${card.newUrl !== null ? `<a href="${escapeHtml(card.newUrl)}">+ New</a>` : ""}
      </div>
    </article>`,
          )
          .join("")}</div>`
      : "<p>No models registered. Register an <code>AdminModel</code> on the <code>AdminSite</code> to populate this dashboard.</p>";

  const body = `<section class="tempest-admin-dashboard">
  <h1>${escapeHtml(context.site.title)}</h1>
  <p>${escapeHtml(context.site.indexSubtitle)}</p>
  ${metricsPanel}
  ${models}
</section>`;
  return renderLayout(context, context.site.title, body);
}

/** A filter control rendered above the list view. */
export interface AdminFilterView {
  /** Column key the control filters on. */
  field: string;
  /** Human-readable label. */
  label: string;
  /** Which control to render. */
  kind: "select" | "daterange" | "text";
  /** Current value for `select` and `text` controls. */
  value: string;
  /** Lower bound for a `daterange` control. */
  valueFrom: string;
  /** Upper bound for a `daterange` control. */
  valueTo: string;
  /** Options for a `select` control. */
  options: { value: string; label: string; selected: boolean }[];
}

/** A clickable column header's sort state. */
export interface AdminSortView {
  /** URL that applies (or flips) this column's ordering. */
  url: string;
  /** Whether the list is currently ordered by this column. */
  active: boolean;
  /** Whether the current ordering is ascending. */
  ascending: boolean;
}

/** The view model the list page renders. */
export interface AdminListView {
  /** Plural display name shown as the heading. */
  title: string;
  /** Column keys rendered as table columns. */
  columns: string[];
  /** One entry per row: its identity plus the formatted cells. */
  rows: { identity: string; cells: string[]; url: string }[];
  /** Total matching rows, across all pages. */
  total: number;
  /** Current page number, 1-based. */
  page: number;
  /** Total page count. */
  pages: number;
  /** URL of the previous page, or `null` on the first page. */
  prevUrl: string | null;
  /** URL of the next page, or `null` on the last page. */
  nextUrl: string | null;
  /** Whether a search box is rendered. */
  searchable: boolean;
  /** Current search text. */
  searchValue: string;
  /** Filter controls. */
  filters: AdminFilterView[];
  /** Sort state per column key. */
  sort: Record<string, AdminSortView>;
  /** URL of the create form, or `null` when creation is disabled. */
  newUrl: string | null;
}

/**
 * Render one filter control.
 *
 * @param filter - The filter view model.
 * @returns The control's markup.
 */
function renderFilter(filter: AdminFilterView): string {
  const name = `filter_${filter.field}`;
  if (filter.kind === "select") {
    const options = filter.options
      .map(
        (option) =>
          `<option value="${escapeHtml(option.value)}"${option.selected ? " selected" : ""}>${escapeHtml(option.label)}</option>`,
      )
      .join("");
    return `<label><span>${escapeHtml(filter.label)}</span><select name="${escapeHtml(name)}"><option value="">— any —</option>${options}</select></label>`;
  }
  if (filter.kind === "daterange") {
    return `<label><span>${escapeHtml(filter.label)}</span><span class="tempest-admin-list__daterange">
      <input type="date" name="${escapeHtml(`${name}_from`)}" value="${escapeHtml(filter.valueFrom)}" aria-label="${escapeHtml(filter.label)} from">
      <input type="date" name="${escapeHtml(`${name}_to`)}" value="${escapeHtml(filter.valueTo)}" aria-label="${escapeHtml(filter.label)} to">
    </span></label>`;
  }
  return `<label><span>${escapeHtml(filter.label)}</span><input type="text" name="${escapeHtml(name)}" value="${escapeHtml(filter.value)}"></label>`;
}

/**
 * Render the paginated list view, with its search box, filters and sortable
 * column headers.
 *
 * @param context - The shared chrome data.
 * @param view - The prepared list view model.
 * @returns The full page.
 */
export function renderListPage(context: AdminRenderContext, view: AdminListView): string {
  const headers = view.columns
    .map((column) => {
      const state = view.sort[column];
      if (state === undefined) return `<th>${escapeHtml(column)}</th>`;
      const arrow = state.active ? (state.ascending ? "▲" : "▼") : "↕";
      return `<th><a class="tempest-sort${state.active ? " tempest-sort--active" : ""}" href="${escapeHtml(state.url)}"><span>${escapeHtml(column)}</span><span class="tempest-sort__arrow" aria-hidden="true">${arrow}</span></a></th>`;
    })
    .join("");

  const rows =
    view.rows.length > 0
      ? view.rows
          .map(
            (row) =>
              `<tr>${row.cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}<td><a href="${escapeHtml(row.url)}">View</a></td></tr>`,
          )
          .join("")
      : `<tr><td colspan="${view.columns.length + 1}">No records.</td></tr>`;

  const hasControls = view.searchable || view.filters.length > 0;
  const body = `<section class="tempest-admin-list">
  <header class="tempest-admin-list__header">
    <h1>${escapeHtml(view.title)}</h1>
    <p>${escapeHtml(view.total)} record${view.total === 1 ? "" : "s"}.</p>
  </header>
  <div class="tempest-admin-list__toolbar">
    <form method="get" class="tempest-admin-list__filters">
      ${view.searchable ? `<input type="search" name="q" value="${escapeHtml(view.searchValue)}" placeholder="Search…" aria-label="Search">` : ""}
      ${view.filters.map(renderFilter).join("")}
      ${hasControls ? '<button type="submit">Apply</button>' : ""}
    </form>
    <div class="tempest-admin-list__actions">
      ${view.newUrl !== null ? `<a class="tempest-admin-list__new" href="${escapeHtml(view.newUrl)}">+ New</a>` : ""}
    </div>
  </div>
  <div class="tempest-admin-table-wrap">
    <table class="tempest-admin-list__table">
      <thead><tr>${headers}<th>Actions</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  ${
    view.pages > 1
      ? `<nav class="tempest-admin-list__pagination" aria-label="Pagination">
    ${view.prevUrl !== null ? `<a href="${escapeHtml(view.prevUrl)}">← Prev</a>` : ""}
    <span>Page ${escapeHtml(view.page)} of ${escapeHtml(view.pages)}</span>
    ${view.nextUrl !== null ? `<a href="${escapeHtml(view.nextUrl)}">Next →</a>` : ""}
  </nav>`
      : ""
  }
</section>`;
  return renderLayout(context, `${view.title} · ${context.site.title}`, body);
}

/** The view model the detail page renders. */
export interface AdminDetailView {
  /** Singular display name. */
  title: string;
  /** The row's identity, shown next to the title. */
  identity: string;
  /** One `(label, value)` pair per column. */
  fields: { label: string; value: string }[];
  /** URL of the list view. */
  backUrl: string;
  /** URL of the edit form, or `null` when editing is disabled. */
  editUrl: string | null;
  /** URL the delete form posts to, or `null` when deletion is disabled. */
  deleteUrl: string | null;
}

/**
 * Render the single-record detail view.
 *
 * @param context - The shared chrome data (with an active session).
 * @param view - The prepared detail view model.
 * @returns The full page.
 * @throws Error When called without a session, since the write forms need a CSRF token.
 */
export function renderDetailPage(
  context: AdminRenderContext,
  view: AdminDetailView,
): string {
  if (context.session === null) throw new Error("The detail view requires a session");
  const csrf = escapeHtml(context.session.csrfToken);
  const fields = view.fields
    .map(
      (field) =>
        `<dt>${escapeHtml(field.label)}</dt><dd>${field.value === "" ? "<em>—</em>" : escapeHtml(field.value)}</dd>`,
    )
    .join("");

  const body = `<section class="tempest-admin-detail">
  <header class="tempest-admin-detail__header">
    <h1>${escapeHtml(view.title)} · ${escapeHtml(view.identity)}</h1>
    <div class="tempest-admin-detail__actions">
      <a href="${escapeHtml(view.backUrl)}">← Back to list</a>
      ${view.editUrl !== null ? `<a class="tempest-admin-btn" href="${escapeHtml(view.editUrl)}">Edit</a>` : ""}
      ${
        view.deleteUrl !== null
          ? `<form method="post" action="${escapeHtml(view.deleteUrl)}" class="tempest-admin-detail__delete" onsubmit="return confirm('Delete this record? This cannot be undone.');">
        <input type="hidden" name="csrf_token" value="${csrf}">
        <button type="submit" class="tempest-admin-btn--danger">Delete</button>
      </form>`
          : ""
      }
    </div>
  </header>
  <dl class="tempest-admin-detail__fields">${fields}</dl>
</section>`;
  return renderLayout(context, `${view.title} · ${view.identity}`, body);
}

/** The view model the create/edit form renders. */
export interface AdminFormView {
  /** Whether the form creates a new record or edits an existing one. */
  mode: "create" | "edit";
  /** Singular display name. */
  title: string;
  /** The controls to render. */
  fields: AdminFormField[];
  /** URL the form posts to. */
  actionUrl: string;
  /** URL of the page to return to. */
  backUrl: string;
  /** A form-level error shown above the fields, or `null`. */
  error: string | null;
}

/**
 * Render one form control.
 *
 * @param field - The field view model.
 * @returns The control's markup, wrapped in its label and error slot.
 */
function renderFormField(field: AdminFormField): string {
  const required = field.required ? " required" : "";
  const name = escapeHtml(field.name);
  const value = escapeHtml(field.value);
  const label = escapeHtml(field.label);

  let control: string;
  switch (field.widget) {
    case "checkbox":
      control = `<label class="tempest-admin-form__check"><input type="checkbox" name="${name}" value="true"${field.checked ? " checked" : ""}><span>${label}</span></label>`;
      break;
    case "textarea":
      control = `<label><span>${label}${field.required ? " *" : ""}</span><textarea name="${name}" rows="4"${required}>${value}</textarea></label>`;
      break;
    case "json":
      control = `<label><span>${label}${field.required ? " *" : ""}</span><textarea name="${name}" rows="6" class="tempest-admin-form__json" spellcheck="false"${required}>${value}</textarea><small class="tempest-admin-form__hint">JSON — must parse (e.g. <code>{}</code>, <code>[]</code>, <code>"text"</code>).</small></label>`;
      break;
    case "select": {
      const blank = field.required ? "" : '<option value="">— none —</option>';
      const options = field.options
        .map(
          (option) =>
            `<option value="${escapeHtml(option.value)}"${option.value === field.value ? " selected" : ""}>${escapeHtml(option.label)}</option>`,
        )
        .join("");
      control = `<label><span>${label}${field.required ? " *" : ""}</span><select name="${name}"${required}>${blank}${options}</select></label>`;
      break;
    }
    case "number":
      control = `<label><span>${label}${field.required ? " *" : ""}</span><input type="number" name="${name}" value="${value}"${field.step !== null ? ` step="${escapeHtml(field.step)}"` : ""}${required}></label>`;
      break;
    case "datetime":
      control = `<label><span>${label}${field.required ? " *" : ""}</span><input type="datetime-local" name="${name}" value="${value}"${required}></label>`;
      break;
    case "date":
      control = `<label><span>${label}${field.required ? " *" : ""}</span><input type="date" name="${name}" value="${value}"${required}></label>`;
      break;
    case "time":
      control = `<label><span>${label}${field.required ? " *" : ""}</span><input type="time" name="${name}" value="${value}"${required}></label>`;
      break;
    default:
      control = `<label><span>${label}${field.required ? " *" : ""}</span><input type="text" name="${name}" value="${value}"${required}></label>`;
  }

  const error =
    field.error !== null
      ? `<small class="tempest-admin-form__field-error">${escapeHtml(field.error)}</small>`
      : "";
  return `<div class="tempest-admin-form__field${field.error !== null ? " tempest-admin-form__field--error" : ""}">${control}${error}</div>`;
}

/**
 * Render the create/edit form.
 *
 * @param context - The shared chrome data (with an active session).
 * @param view - The prepared form view model.
 * @returns The full page.
 * @throws Error When called without a session, since the form needs a CSRF token.
 */
export function renderFormPage(context: AdminRenderContext, view: AdminFormView): string {
  if (context.session === null) throw new Error("The admin form requires a session");
  const heading = view.mode === "create" ? `New ${view.title}` : `Edit ${view.title}`;
  const body = `<section class="tempest-admin-form">
  <header class="tempest-admin-detail__header">
    <h1>${escapeHtml(heading)}</h1>
    <a href="${escapeHtml(view.backUrl)}">← Back</a>
  </header>
  ${view.error !== null ? `<p class="tempest-admin-form__error">${escapeHtml(view.error)}</p>` : ""}
  <form method="post" action="${escapeHtml(view.actionUrl)}" class="tempest-admin-form__form">
    <input type="hidden" name="csrf_token" value="${escapeHtml(context.session.csrfToken)}">
    ${view.fields.map(renderFormField).join("")}
    <div class="tempest-admin-form__actions">
      <button type="submit">${view.mode === "create" ? "Create" : "Save"}</button>
      <a href="${escapeHtml(view.backUrl)}" class="tempest-admin-form__cancel">Cancel</a>
    </div>
  </form>
</section>`;
  return renderLayout(context, `${heading} · ${context.site.title}`, body);
}
