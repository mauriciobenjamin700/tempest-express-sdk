/**
 * Granular per-model, per-action access control, mirroring
 * `admin.permissions`.
 *
 * Out of the box every operator who can sign in (`isAdmin`) can do everything
 * the {@link AdminModel} flags allow. To narrow a principal to a subset of
 * models or actions — a "support" role that may view orders but never delete
 * them, an "editor" who may touch content models only — hand an
 * {@link AdminAccessPolicy} to `makeAdminRouter`.
 *
 * ```ts
 * const policy: AdminAccessPolicy = (user, admin, action) => {
 *   if (user.role === "superadmin") return true;
 *   if (user.role === "support") return action === AdminPermission.VIEW;
 *   return false;
 * };
 *
 * makeAdminRouter(site, { ..., accessPolicy: policy });
 * ```
 *
 * The policy **composes with** the `canCreate` / `canEdit` / `canDelete` flags
 * rather than replacing them: both have to allow an action. A denied `VIEW`
 * also hides the model from the dashboard and the sidebar, so an operator is
 * never shown a door that will answer `403`.
 */

import type { AdminModel } from "@/admin/config";

/** An admin action gated by an {@link AdminAccessPolicy}. */
export const AdminPermission = {
  VIEW: "view",
  CREATE: "create",
  EDIT: "edit",
  DELETE: "delete",
} as const;

/** An {@link AdminPermission} value. */
export type AdminPermission = (typeof AdminPermission)[keyof typeof AdminPermission];

/**
 * Decides whether `principal` may perform `action` on the model behind
 * `admin`. Sync or async; return truthy to allow.
 */
export type AdminAccessPolicy = (
  principal: unknown,
  admin: AdminModel,
  action: AdminPermission,
) => boolean | Promise<boolean>;
