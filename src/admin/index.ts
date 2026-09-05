/**
 * Admin: a server-rendered management panel plus a headless JSON API.
 *
 * {@link AdminSite} + {@link makeAdminRouter} mount the batteries-included HTML
 * panel — login, dashboard, list views with search/filters/sorting, and
 * auto-derived CRUD forms — over your `tempest-db-js` models.
 * {@link AdminJsonSite} + {@link makeAdminJsonRouter} are the headless
 * counterpart for projects that render the UI themselves.
 */

export {
  type CardCompute,
  type CardData,
  type MetricCard,
  type MetricPartition,
  type MetricTrend,
  type MetricValue,
  metricCard,
  partitionTotal,
  trendDirection,
  trendPercent,
} from "@/admin/dashboard";
export {
  type AdminInline,
  type AdminInlineOptions,
  adminInline,
} from "@/admin/inlines";
export {
  type AdminLens,
  type AdminLensOptions,
  adminLens,
} from "@/admin/lenses";
export {
  type AdminAccessPolicy,
  AdminPermission,
} from "@/admin/permissions";
export {
  type AdminAction,
  type AdminActionCategory,
  type AdminActionContext,
  type AdminActionHandler,
  type AdminActionOptions,
  type AdminActionResult,
  type BulkActionOption,
  adminAction,
} from "@/admin/actions";
export {
  MultipartLimitError,
  type ParseMultipartOptions,
  type ParsedMultipart,
  type UploadedFile,
  isMultipart,
  parseMultipart,
} from "@/admin/multipart";
export {
  type AdminFilterKind,
  type AdminSelectOption,
  type AdminWidget,
  type WidgetSpec,
  adminColumns,
  filterForColumn,
  foreignKeyTable,
  humanizeField,
  isColumnOptional,
  isSearchableColumn,
  widgetForColumn,
} from "@/admin/columns";
export {
  AdminModel,
  type AdminModelOptions,
  type AdminRow,
} from "@/admin/config";
export {
  type AdminFormField,
  type BuildFormFieldsOptions,
  type ParseFormBodyOptions,
  type ParsedAdminForm,
  buildFormFields,
  foreignKeyFields,
  foreignKeyLabel,
  formatCellValue,
  formatFieldValue,
  parseFormBody,
} from "@/admin/forms";
export {
  type AdminAuthBackend,
  type AdminMfaVerifier,
  UserModelAuthBackend,
  type UserModelAuthBackendOptions,
} from "@/admin/auth";
export {
  type AdminSession,
  AdminSessionStore,
  type AdminSessionStoreOptions,
  csrfTokenMatches,
} from "@/admin/session";
export {
  type AdminAutomapOptions,
  AdminSite,
  type AdminSiteOptions,
} from "@/admin/site";
export { ADMIN_CSS } from "@/admin/styles";
export {
  type AdminAuditEntryView,
  type AdminAuditView,
  type AdminBusinessCardView,
  type AdminDashboardCard,
  type AdminDashboardMetrics,
  type AdminDetailView,
  type AdminFilterView,
  type AdminFormView,
  type AdminImportView,
  type AdminInlineRowView,
  type AdminInlineView,
  type AdminListView,
  type AdminMessage,
  type AdminNavEntry,
  type AdminRenderContext,
  type AdminSortView,
  escapeHtml,
  renderDashboardPage,
  renderDetailPage,
  renderFormPage,
  renderImportPage,
  renderLayout,
  renderListPage,
  renderLoginPage,
  renderMfaPage,
} from "@/admin/templates";
export {
  type AdminTheme,
  type ResolvedAdminTheme,
  adminThemeCss,
  resolveAdminTheme,
} from "@/admin/theme";
export {
  type AdminRouterOptions,
  groupInlineSubmission,
  makeAdminRouter,
  parseCsv,
} from "@/admin/router";

export {
  AdminJsonSite,
  type AdminJsonField,
  type AdminJsonListQuery,
  type AdminJsonListResult,
  type AdminJsonResource,
} from "@/admin/json/site";
export {
  type AdminJsonRouterOptions,
  makeAdminJsonRouter,
} from "@/admin/json/router";
