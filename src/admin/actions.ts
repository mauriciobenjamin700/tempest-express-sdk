/**
 * Custom admin actions — operator-defined bulk operations, mirroring
 * `admin.actions`.
 *
 * The panel ships three built-in bulk operations (activate / deactivate /
 * delete). Anything domain-specific — "send welcome email", "mark as shipped",
 * "recalculate totals" — is a *custom action*: a handler registered on an
 * {@link AdminModel} through `actions`, which shows up in the list view's
 * bulk-action dropdown and runs against the checked rows.
 *
 * ```ts
 * const sendWelcome = adminAction(
 *   { label: "Send welcome email" },
 *   async ({ ids, repository }) => {
 *     const users = await repository.list({ id: { in: ids } });
 *     for (const user of users) await mailer.sendWelcome(user.email);
 *     return { message: `Sent ${users.length} welcome emails.` };
 *   },
 * );
 *
 * site.register(new AdminModel({ model: UserModel, actions: [sendWelcome] }));
 * ```
 *
 * The Python SDK attaches this metadata with an `@admin_action` decorator.
 * Here {@link adminAction} returns the descriptor instead: the handler stays a
 * plain function you can call and unit-test directly (`action.handler(ctx)`),
 * and there is no decorator syntax to enable in a consumer's build.
 */

import type { AdminSession } from "@/admin/session";
import type { AsyncSession, BaseRepository, ModelClass } from "@/db";
import type { Request } from "express";

/** Banner style a custom action's message is flashed with. */
export type AdminActionCategory = "success" | "error" | "warning";

/** Everything a custom action handler needs to do its work. */
export interface AdminActionContext<C extends ModelClass = ModelClass> {
  /** Identity values of the rows the operator checked. */
  ids: string[];
  /** Repository for this admin's model, bound to the request's DB session. */
  repository: BaseRepository<C>;
  /** The request's DB session, for work beyond the repository. */
  dbSession: AsyncSession;
  /** The inbound request. */
  request: Request;
  /** The authenticated admin session. */
  session: AdminSession;
  /** The resolved admin principal that triggered the action. */
  principal: unknown;
}

/** The outcome of a custom action, flashed on the list view. */
export interface AdminActionResult {
  /** Human-readable result shown to the operator. */
  message: string;
  /** Banner style. Default `"success"`. */
  category?: AdminActionCategory;
}

/** The function a custom action runs. Return `null` to flash nothing. */
export type AdminActionHandler<C extends ModelClass = ModelClass> = (
  context: AdminActionContext<C>,
) => Promise<AdminActionResult | null>;

/** A registered custom action: metadata plus handler. */
export interface AdminAction<C extends ModelClass = ModelClass> {
  /** Stable identifier (the submitted form value); unique per model. */
  name: string;
  /** Text shown in the bulk-action dropdown. */
  label: string;
  /** The handler to run against the checked rows. */
  handler: AdminActionHandler<C>;
  /** Whether the UI marks this as destructive (a stronger confirm prompt). */
  dangerous: boolean;
}

/** Metadata accepted by {@link adminAction}. */
export interface AdminActionOptions {
  /** Dropdown label shown to the operator. */
  label: string;
  /** Stable identifier (the submitted form value). Defaults to a slug of `label`. */
  name?: string;
  /** Flag a destructive action, for a stronger confirm prompt. */
  dangerous?: boolean;
}

/**
 * Slugify a label into a stable action identifier.
 *
 * @param label - The human-readable label.
 * @returns A lowercase, hyphenated identifier.
 */
function slugify(label: string): string {
  return (
    label
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "action"
  );
}

/**
 * Describe a custom bulk action.
 *
 * @param options - Label, optional stable name and the destructive flag.
 * @param handler - The async function run against the checked rows.
 * @returns The action descriptor to pass to `AdminModel({ actions: [...] })`.
 * @throws Error When the resolved name is empty.
 */
export function adminAction<C extends ModelClass = ModelClass>(
  options: AdminActionOptions,
  handler: AdminActionHandler<C>,
): AdminAction<C> {
  const name = options.name ?? slugify(options.label);
  if (name === "") throw new Error("adminAction requires a non-empty name or label");
  return {
    name,
    label: options.label,
    handler,
    dangerous: options.dangerous ?? false,
  };
}

/** A bulk-action option rendered in the list view's dropdown. */
export interface BulkActionOption {
  /** Submitted form value. Custom actions are namespaced `custom:<name>`. */
  value: string;
  /** Dropdown label. */
  label: string;
  /** Whether the action is destructive. */
  dangerous: boolean;
}
