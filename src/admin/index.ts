/** Admin JSON API: resource registry + auto-derived CRUD router. */

export {
  AdminSite,
  type AdminField,
  type AdminListQuery,
  type AdminListResult,
  type AdminResource,
} from "@/admin/site";
export {
  type AdminRouterOptions,
  makeAdminRouter,
} from "@/admin/router";
