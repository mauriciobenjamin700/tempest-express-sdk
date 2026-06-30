/**
 * Feature-flag service + Express guard, mirroring `flags.service` /
 * `flags.dependencies`.
 */

import { NotFoundException } from "@/exceptions/http";
import type { FeatureFlagBackend, FlagContext } from "@/flags/backends";
import type { RequestHandler } from "express";

/** Evaluates flags against a backend, applying a default when undecided. */
export class FeatureFlags {
  /**
   * @param backend - The resolving backend.
   * @param defaultEnabled - Value used when the backend returns `null`.
   */
  constructor(
    private readonly backend: FeatureFlagBackend,
    private readonly defaultEnabled = false,
  ) {}

  /**
   * Whether `flag` is enabled for the given context.
   *
   * @param flag - The flag name.
   * @param context - Optional evaluation context.
   * @returns `true` when enabled (or default when the backend is undecided).
   */
  async isEnabled(flag: string, context?: FlagContext): Promise<boolean> {
    const answer = await this.backend.resolve(flag, context);
    return answer ?? this.defaultEnabled;
  }
}

/**
 * Build middleware that rejects with 404 when `flag` is disabled (hiding the
 * route entirely, the common kill-switch behavior).
 *
 * @param flags - The flag service.
 * @param flag - The flag name to gate on.
 * @returns An Express middleware.
 */
export function makeFlagGuard(flags: FeatureFlags, flag: string): RequestHandler {
  return (_req, _res, next) => {
    flags
      .isEnabled(flag)
      .then((enabled) => {
        if (enabled) next();
        else next(new NotFoundException({ message: "Not found", details: { flag } }));
      })
      .catch(next);
  };
}
