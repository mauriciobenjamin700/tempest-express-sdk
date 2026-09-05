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

import type { BulkActionOption } from "@/admin/actions";
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

/** One business-metric card, already computed and formatted for rendering. */
export interface AdminBusinessCardView {
  /** The card heading. */
  label: string;
  /** Which shape to render. */
  kind: "value" | "trend" | "partition";
  /** Headline value (`value` and `trend` cards). */
  value: string;
  /** Optional unit suffix. */
  unit: string | null;
  /** Trend direction (`trend` cards). */
  direction: "up" | "down" | "flat";
  /** Formatted percentage change, or `null` when there is no baseline. */
  percent: string | null;
  /** Previous-period value, as text (`trend` cards). */
  previous: string;
  /** Segments with their share of the total (`partition` cards). */
  segments: { label: string; value: string; percent: number }[];
  /** Optional sub-label. */
  helpText: string | null;
  /** Set when the card's compute threw, so the dashboard still renders. */
  error: string | null;
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
  businessCards: AdminBusinessCardView[] = [],
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

  const business =
    businessCards.length > 0
      ? `<div class="tempest-admin-cards" aria-label="Business metrics">${businessCards
          .map(renderBusinessCard)
          .join("")}</div>`
      : "";

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
  ${business}
  ${models}
</section>`;
  return renderLayout(context, context.site.title, body);
}

/**
 * Render one business-metric card.
 *
 * A card whose compute threw renders as the card with an error line rather
 * than taking the dashboard down: one broken query should not cost the
 * operator every other number on the page.
 *
 * @param card - The computed card view model.
 * @returns The card markup.
 */
function renderBusinessCard(card: AdminBusinessCardView): string {
  const help =
    card.helpText !== null
      ? `<span class="tempest-admin-card__help">${escapeHtml(card.helpText)}</span>`
      : "";

  if (card.error !== null) {
    return `<article class="tempest-admin-card tempest-admin-card--value">
      <span class="tempest-admin-card__label">${escapeHtml(card.label)}</span>
      <span class="tempest-admin-card__value">—</span>
      <span class="tempest-admin-card__help">${escapeHtml(card.error)}</span>
    </article>`;
  }

  const unit = card.unit !== null ? ` <small>${escapeHtml(card.unit)}</small>` : "";

  if (card.kind === "partition") {
    const parts = card.segments
      .map(
        (segment) => `<li>
        <span class="tempest-admin-card__part-label">${escapeHtml(segment.label)}</span>
        <span class="tempest-admin-card__part-bar"><span style="width: ${Math.round(segment.percent)}%"></span></span>
        <span class="tempest-admin-card__part-value">${escapeHtml(segment.value)}</span>
      </li>`,
      )
      .join("");
    return `<article class="tempest-admin-card tempest-admin-card--partition">
      <span class="tempest-admin-card__label">${escapeHtml(card.label)}</span>
      <ul class="tempest-admin-card__parts">${parts}</ul>
      ${help}
    </article>`;
  }

  if (card.kind === "trend") {
    const arrow = card.direction === "up" ? "▲" : card.direction === "down" ? "▼" : "▬";
    return `<article class="tempest-admin-card tempest-admin-card--trend">
      <span class="tempest-admin-card__label">${escapeHtml(card.label)}</span>
      <span class="tempest-admin-card__value">${escapeHtml(card.value)}${unit}</span>
      <span class="tempest-admin-card__trend tempest-admin-card__trend--${escapeHtml(card.direction)}">
        ${arrow} ${card.percent === null ? "—" : escapeHtml(card.percent)}
        <small>vs prev ${escapeHtml(card.previous)}</small>
      </span>
      ${help}
    </article>`;
  }

  return `<article class="tempest-admin-card tempest-admin-card--value">
      <span class="tempest-admin-card__label">${escapeHtml(card.label)}</span>
      <span class="tempest-admin-card__value">${escapeHtml(card.value)}${unit}</span>
      ${help}
    </article>`;
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
  /** URL of the CSV import page, or `null` when import is disabled. */
  importUrl: string | null;
  /** Bulk actions offered above the table. Empty hides the whole bulk UI. */
  bulkActions: BulkActionOption[];
  /** URL the bulk form posts to. */
  bulkUrl: string;
  /** URL exporting the current result set as CSV. */
  exportCsvUrl: string;
  /** URL exporting the current result set as JSON. */
  exportJsonUrl: string;
  /** Saved-preset tabs rendered above the table. Empty hides the strip. */
  lenses: { label: string; url: string; active: boolean }[];
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
  const bulk = view.bulkActions.length > 0 && context.session !== null;
  const checkColumn = bulk ? 1 : 0;

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
          .map((row) => {
            const check = bulk
              ? `<td class="tempest-admin-list__check"><input type="checkbox" name="ids" value="${escapeHtml(row.identity)}" data-row-check aria-label="Select row"></td>`
              : "";
            const cells = row.cells
              .map((cell) => `<td>${escapeHtml(cell)}</td>`)
              .join("");
            return `<tr>${check}${cells}<td><a href="${escapeHtml(row.url)}">View</a></td></tr>`;
          })
          .join("")
      : `<tr><td colspan="${view.columns.length + 1 + checkColumn}">No records.</td></tr>`;

  const bulkBar = bulk
    ? `<form method="post" action="${escapeHtml(view.bulkUrl)}" class="tempest-admin-bulk" onsubmit="return confirm('Apply the selected action to the checked rows?');">
    <input type="hidden" name="csrf_token" value="${escapeHtml(context.session?.csrfToken)}">
    <div class="tempest-admin-bulk__bar">
      <select name="action" aria-label="Bulk action">
        ${view.bulkActions
          .map(
            (action) =>
              `<option value="${escapeHtml(action.value)}">${escapeHtml(action.label)}${action.dangerous ? " ⚠" : ""}</option>`,
          )
          .join("")}
      </select>
      <button type="submit">Apply to selected</button>
    </div>`
    : "";

  const selectAllScript = bulk
    ? `<script>
    (function () {
      var master = document.querySelector('[data-select-all]');
      if (!master) return;
      master.addEventListener('change', function () {
        document.querySelectorAll('[data-row-check]').forEach(function (box) {
          box.checked = master.checked;
        });
      });
    })();
  </script>`
    : "";

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
      ${view.importUrl !== null ? `<a href="${escapeHtml(view.importUrl)}">Import CSV</a>` : ""}
      <a href="${escapeHtml(view.exportCsvUrl)}">Export CSV</a>
      <a href="${escapeHtml(view.exportJsonUrl)}">Export JSON</a>
    </div>
  </div>
  ${
    view.lenses.length > 0
      ? `<nav class="tempest-admin-lenses" aria-label="Lenses">${view.lenses
          .map(
            (lens) =>
              `<a class="tempest-admin-lens${lens.active ? " tempest-admin-lens--active" : ""}" href="${escapeHtml(lens.url)}">${escapeHtml(lens.label)}</a>`,
          )
          .join("")}</nav>`
      : ""
  }
  ${bulkBar}
  <div class="tempest-admin-table-wrap">
    <table class="tempest-admin-list__table">
      <thead><tr>${bulk ? '<th class="tempest-admin-list__check"><input type="checkbox" data-select-all aria-label="Select all"></th>' : ""}${headers}<th>Actions</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  ${bulk ? "</form>" : ""}
  ${selectAllScript}
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

/** One entry in the detail view's change timeline. */
export interface AdminAuditEntryView {
  /** The mutation kind (`create` / `update` / `delete`). */
  action: string;
  /** When it happened, already formatted. */
  at: string;
  /** Who did it — a resolved display name, or the raw actor id. */
  actor: string;
  /** The per-field diff. */
  changes: { field: string; before: string; after: string }[];
  /** Extra metadata the writer recorded, as JSON text, or `null`. */
  context: string | null;
}

/** The "who and when" panel below a record's fields. */
export interface AdminAuditView {
  /** Timestamp and actor rows, already resolved and formatted. */
  fields: { label: string; value: string }[];
  /** The change timeline, newest first. Empty when there is none to show. */
  history: AdminAuditEntryView[];
}

/** One row inside an inline block. */
export interface AdminInlineRowView {
  /** Row key — the child's identity, or `new<n>` for the blank add row. */
  key: string;
  /** Formatted cells, for a read-only inline. */
  cells: string[];
  /** Editable controls, for an editable inline. */
  fields: AdminFormField[];
  /** Link into the child's own admin, or `null` when it has none. */
  url: string | null;
}

/** A related-child block on the detail view. */
export interface AdminInlineView {
  /** Section heading. */
  label: string;
  /** How many child rows exist in total. */
  total: number;
  /** Column headings. */
  columns: string[];
  /** Whether the rows render as an editable formset. */
  editable: boolean;
  /** Whether an editable row offers a delete checkbox. */
  canDelete: boolean;
  /** URL of the child's create form, pre-filled with the parent key. */
  addUrl: string | null;
  /** URL the formset posts to. */
  formAction: string;
  /** The child rows. */
  rows: AdminInlineRowView[];
  /** The blank add row, for an editable inline. */
  newRow: AdminInlineRowView | null;
  /** Whether more rows exist than the block renders. */
  truncated: boolean;
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
  /** The audit panel, or `null` when the model carries no audit columns. */
  audit: AdminAuditView | null;
  /** Related-child blocks rendered below the fields. */
  inlines: AdminInlineView[];
  /** A form-level error from an inline submission, or `null`. */
  inlineError: string | null;
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

  const auditPanel = view.audit === null ? "" : renderAuditPanel(view.audit);

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
  ${view.inlines.map((inline) => renderInline(inline, context.session?.csrfToken ?? "", view.inlineError)).join("")}
  ${auditPanel}
</section>`;
  return renderLayout(context, `${view.title} · ${view.identity}`, body);
}

/**
 * Render one editable inline cell — the same widgets the full form uses, sized
 * for a table row.
 *
 * @param field - The field view model, already named `row.<key>.<column>`.
 * @returns The control markup plus its error slot.
 */
function renderInlineCell(field: AdminFormField): string {
  const required = field.required ? " required" : "";
  const name = escapeHtml(field.name);
  const value = escapeHtml(field.value);

  let control: string;
  switch (field.widget) {
    case "checkbox":
      control = `<input type="checkbox" name="${name}" value="true"${field.checked ? " checked" : ""}>`;
      break;
    case "textarea":
    case "json":
      control = `<textarea name="${name}" rows="2"${required}>${value}</textarea>`;
      break;
    case "select": {
      const blank = field.required ? "" : '<option value="">— none —</option>';
      const options = field.options
        .map(
          (option) =>
            `<option value="${escapeHtml(option.value)}"${option.value === field.value ? " selected" : ""}>${escapeHtml(option.label)}</option>`,
        )
        .join("");
      control = `<select name="${name}"${required}>${blank}${options}</select>`;
      break;
    }
    case "number":
      control = `<input type="number" name="${name}" value="${value}"${field.step !== null ? ` step="${escapeHtml(field.step)}"` : ""}${required}>`;
      break;
    case "datetime":
      control = `<input type="datetime-local" name="${name}" value="${value}"${required}>`;
      break;
    case "date":
      control = `<input type="date" name="${name}" value="${value}"${required}>`;
      break;
    case "time":
      control = `<input type="time" name="${name}" value="${value}"${required}>`;
      break;
    default:
      control = `<input type="text" name="${name}" value="${value}"${required}>`;
  }

  const error =
    field.error !== null
      ? `<small class="tempest-admin-form__field-error">${escapeHtml(field.error)}</small>`
      : "";
  return `${control}${error}`;
}

/**
 * Render one related-child block.
 *
 * A read-only inline is a table with a link per row into the child's own
 * admin. An editable one is a formset whose inputs are named
 * `row.<key>.<column>`, plus one blank row so adding a child never means
 * leaving the parent.
 *
 * @param inline - The prepared inline view model.
 * @param csrfToken - The session's CSRF token, for the formset.
 * @param error - A form-level error to show above an editable formset.
 * @returns The block markup.
 */
function renderInline(
  inline: AdminInlineView,
  csrfToken: string,
  error: string | null,
): string {
  const heading = `<header class="tempest-admin-inline__header">
      <h2>${escapeHtml(inline.label)}${inline.total > 0 ? ` <span class="tempest-admin-inline__count">(${escapeHtml(inline.total)})</span>` : ""}</h2>
      ${inline.addUrl !== null ? `<a class="tempest-admin-btn" href="${escapeHtml(inline.addUrl)}">Add</a>` : ""}
    </header>`;

  const more = inline.truncated
    ? `<p class="tempest-admin-inline__more"><em>Showing the first ${escapeHtml(inline.rows.length)} of ${escapeHtml(inline.total)}.</em></p>`
    : "";

  if (!inline.editable) {
    if (inline.rows.length === 0) {
      return `<section class="tempest-admin-inline">${heading}<p><em>No related records.</em></p></section>`;
    }
    const head = `<tr>${inline.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}<th></th></tr>`;
    const body = inline.rows
      .map(
        (row) =>
          `<tr>${row.cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}<td>${
            row.url === null ? "" : `<a href="${escapeHtml(row.url)}">View</a>`
          }</td></tr>`,
      )
      .join("");
    return `<section class="tempest-admin-inline">
      ${heading}
      <div class="tempest-admin-inline__scroll">
        <table class="tempest-admin-inline__table">
          <thead>${head}</thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      ${more}
    </section>`;
  }

  const head = `<tr>${inline.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}${
    inline.canDelete ? "<th>Delete</th>" : ""
  }</tr>`;

  const renderRow = (row: AdminInlineRowView, isNew: boolean): string =>
    `<tr${isNew ? ' class="tempest-admin-inline__new"' : ""}>${row.fields
      .map((field) => `<td>${renderInlineCell(field)}</td>`)
      .join("")}${
      inline.canDelete
        ? `<td class="tempest-admin-inline__del">${
            isNew
              ? ""
              : `<input type="checkbox" name="row.${escapeHtml(row.key)}.__delete" value="true">`
          }</td>`
        : ""
    }</tr>`;

  const rows = inline.rows.map((row) => renderRow(row, false)).join("");
  const blank = inline.newRow === null ? "" : renderRow(inline.newRow, true);

  return `<section class="tempest-admin-inline">
    ${heading}
    ${error !== null ? `<p class="tempest-admin-form__error">${escapeHtml(error)}</p>` : ""}
    <form method="post" action="${escapeHtml(inline.formAction)}" class="tempest-admin-inline__form">
      <input type="hidden" name="csrf_token" value="${escapeHtml(csrfToken)}">
      <div class="tempest-admin-inline__scroll">
        <table class="tempest-admin-inline__table">
          <thead>${head}</thead>
          <tbody>${rows}${blank}</tbody>
        </table>
      </div>
      <div class="tempest-admin-form__actions">
        <button type="submit">Save ${escapeHtml(inline.label)}</button>
      </div>
    </form>
    ${more}
  </section>`;
}

/**
 * Render the audit panel: timestamps, actors and the change timeline.
 *
 * Each history entry is a `<details>` so a record with a long history stays
 * scannable — the same reason the logs page collapses tracebacks — and it needs
 * no JavaScript to expand.
 *
 * @param audit - The resolved audit view model.
 * @returns The panel markup.
 */
function renderAuditPanel(audit: AdminAuditView): string {
  const rows = audit.fields
    .map(
      (field) =>
        `<dt>${escapeHtml(field.label)}</dt><dd>${field.value === "" ? "<em>—</em>" : escapeHtml(field.value)}</dd>`,
    )
    .join("");

  const history =
    audit.history.length > 0
      ? `<ol class="tempest-admin-history">${audit.history
          .map((entry) => {
            const changes =
              entry.changes.length > 0
                ? `<table class="tempest-admin-history__changes"><thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>${entry.changes
                    .map(
                      (change) =>
                        `<tr><td>${escapeHtml(change.field)}</td><td>${escapeHtml(change.before)}</td><td>${escapeHtml(change.after)}</td></tr>`,
                    )
                    .join("")}</tbody></table>`
                : "<p><em>No field changes recorded.</em></p>";
            const context =
              entry.context !== null
                ? `<pre class="tempest-admin-detail__json">${escapeHtml(entry.context)}</pre>`
                : "";
            return `<li class="tempest-admin-history__item">
        <details>
          <summary>
            <span class="tempest-admin-history__action">${escapeHtml(entry.action)}</span>
            <span class="tempest-admin-history__actor">${escapeHtml(entry.actor)}</span>
            <span class="tempest-admin-history__at">${escapeHtml(entry.at)}</span>
          </summary>
          ${changes}
          ${context}
        </details>
      </li>`;
          })
          .join("")}</ol>`
      : "";

  return `<section class="tempest-admin-audit">
    <h2>Audit</h2>
    <dl class="tempest-admin-detail__fields">${rows}</dl>
    ${history}
  </section>`;
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
    case "file":
      control = `<label><span>${label}${field.required ? " *" : ""}</span><input type="file" name="${name}"${required}></label>${
        field.value === ""
          ? ""
          : `<small class="tempest-admin-form__hint">Current: ${value} — choose a file to replace it.</small>`
      }`;
      break;
    case "autocomplete":
      control = `<label><span>${label}${field.required ? " *" : ""}</span>
        <div class="tempest-admin-ac" data-ac data-ac-url="${escapeHtml(field.autocompleteUrl)}">
          <input type="text" class="tempest-admin-ac__search" value="${escapeHtml(field.displayLabel)}" placeholder="Search…" autocomplete="off" data-ac-search>
          <input type="hidden" name="${name}" value="${value}"${required} data-ac-value>
          <ul class="tempest-admin-ac__results" data-ac-results hidden></ul>
        </div>
      </label>`;
      break;
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
  <form method="post" action="${escapeHtml(view.actionUrl)}" class="tempest-admin-form__form"${
    view.fields.some((field) => field.widget === "file")
      ? ' enctype="multipart/form-data"'
      : ""
  }>
    <input type="hidden" name="csrf_token" value="${escapeHtml(context.session.csrfToken)}">
    ${view.fields.map(renderFormField).join("")}
    <div class="tempest-admin-form__actions">
      <button type="submit">${view.mode === "create" ? "Create" : "Save"}</button>
      <a href="${escapeHtml(view.backUrl)}" class="tempest-admin-form__cancel">Cancel</a>
    </div>
  </form>
  ${view.fields.some((field) => field.widget === "autocomplete") ? AUTOCOMPLETE_SCRIPT : ""}
</section>`;
  return renderLayout(context, `${heading} · ${context.site.title}`, body);
}

/** The outcome of a CSV import, as the page renders it. */
export interface AdminImportView {
  /** Plural display name of the model being imported into. */
  title: string;
  /** URL the upload form posts to. */
  actionUrl: string;
  /** URL of the list view. */
  backUrl: string;
  /** The column headers the CSV is expected to carry. */
  columns: string[];
  /** A form-level error, or `null`. */
  error: string | null;
  /** How many rows were created, or `null` before the first submission. */
  created: number | null;
  /** Per-row failures, numbered as the spreadsheet numbers them. */
  rowErrors: { row: number; message: string }[];
}

/**
 * Render the CSV import page.
 *
 * Row numbers start at 2 because row 1 is the header, so the numbers line up
 * with what the operator sees in their spreadsheet.
 *
 * @param context - The shared chrome data (with an active session).
 * @param view - The prepared import view model.
 * @returns The full page.
 * @throws Error When called without a session, since the form needs a CSRF token.
 */
export function renderImportPage(
  context: AdminRenderContext,
  view: AdminImportView,
): string {
  if (context.session === null) throw new Error("The import page requires a session");

  const summary =
    view.created === null
      ? ""
      : `<p class="tempest-admin-import__summary">Created ${escapeHtml(view.created)} record${view.created === 1 ? "" : "s"}.</p>`;

  const failures =
    view.rowErrors.length > 0
      ? `<table class="tempest-admin-import__errors"><thead><tr><th>Row</th><th>Problem</th></tr></thead><tbody>${view.rowErrors
          .map(
            (failure) =>
              `<tr><td>${escapeHtml(failure.row)}</td><td>${escapeHtml(failure.message)}</td></tr>`,
          )
          .join("")}</tbody></table>`
      : "";

  const body = `<section class="tempest-admin-import">
  <header class="tempest-admin-detail__header">
    <h1>Import ${escapeHtml(view.title)}</h1>
    <a href="${escapeHtml(view.backUrl)}">← Back</a>
  </header>
  ${view.error !== null ? `<p class="tempest-admin-form__error">${escapeHtml(view.error)}</p>` : ""}
  ${summary}
  ${failures}
  <form method="post" action="${escapeHtml(view.actionUrl)}" class="tempest-admin-form__form" enctype="multipart/form-data">
    <input type="hidden" name="csrf_token" value="${escapeHtml(context.session.csrfToken)}">
    <div class="tempest-admin-form__field">
      <label>
        <span>CSV file *</span>
        <input type="file" name="file" accept=".csv,text/csv" required>
      </label>
      <small class="tempest-admin-form__hint">
        UTF-8, comma-separated, with a header row. Recognised columns:
        <code>${escapeHtml(view.columns.join(", "))}</code>. Unknown columns are ignored.
      </small>
    </div>
    <div class="tempest-admin-form__actions">
      <button type="submit">Import</button>
      <a href="${escapeHtml(view.backUrl)}" class="tempest-admin-form__cancel">Cancel</a>
    </div>
  </form>
</section>`;
  return renderLayout(context, `Import ${view.title} · ${context.site.title}`, body);
}

/**
 * The only page script the panel ships beyond the bulk select-all: a debounced
 * search box for foreign keys whose target table is too large to pre-load.
 *
 * The FastAPI SDK reaches for HTMX from a CDN here. This is ~30 lines of
 * vanilla DOM instead, because a CDN script is a third-party request on an
 * operator console — one an air-gapped deployment cannot make and a strict CSP
 * has to whitelist — and the behaviour needed is one fetch and one list.
 */
const AUTOCOMPLETE_SCRIPT = `<script>
(function () {
  document.querySelectorAll("[data-ac]").forEach(function (box) {
    var search = box.querySelector("[data-ac-search]");
    var value = box.querySelector("[data-ac-value]");
    var results = box.querySelector("[data-ac-results]");
    var url = box.getAttribute("data-ac-url");
    var timer = null;

    function close() {
      results.hidden = true;
      results.innerHTML = "";
    }

    function pick(option) {
      value.value = option.value;
      search.value = option.label;
      close();
    }

    function run() {
      var term = search.value.trim();
      fetch(url + "?q=" + encodeURIComponent(term), { credentials: "same-origin" })
        .then(function (response) { return response.ok ? response.json() : { options: [] }; })
        .then(function (payload) {
          results.innerHTML = "";
          (payload.options || []).forEach(function (option) {
            var item = document.createElement("li");
            item.textContent = option.label;
            item.setAttribute("role", "option");
            item.addEventListener("mousedown", function (event) {
              event.preventDefault();
              pick(option);
            });
            results.appendChild(item);
          });
          results.hidden = results.children.length === 0;
        })
        .catch(close);
    }

    search.addEventListener("input", function () {
      value.value = "";
      window.clearTimeout(timer);
      timer = window.setTimeout(run, 250);
    });
    search.addEventListener("focus", run);
    search.addEventListener("blur", function () { window.setTimeout(close, 150); });
  });
})();
</script>`;
