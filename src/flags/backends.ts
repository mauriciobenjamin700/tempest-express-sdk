/**
 * Feature-flag backends, mirroring `flags.backends`.
 *
 * A flag resolves to a boolean given a flag name and optional context. Backends
 * are composable — {@link CompositeFeatureFlagBackend} tries each in order and
 * returns the first definitive answer.
 */

/** Arbitrary evaluation context (user id, roles, attributes). */
export type FlagContext = Record<string, unknown>;

/** Resolves a flag to enabled/disabled, or `null` when it has no opinion. */
export interface FeatureFlagBackend {
  /** Resolve `flag`; `null` defers to the next backend. */
  resolve(flag: string, context?: FlagContext): Promise<boolean | null> | boolean | null;
}

/** Coerce a loose value (`"1"`, `"true"`, `"on"`, …) to a boolean. */
export function coerceFlag(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    return ["1", "true", "on", "yes", "enabled"].includes(value.trim().toLowerCase());
  }
  return false;
}

/** In-memory backend backed by a `Map`, ideal for tests and overrides. */
export class MemoryFeatureFlagBackend implements FeatureFlagBackend {
  private readonly flags = new Map<string, boolean>();

  /**
   * @param initial - Initial flag → enabled map.
   */
  constructor(initial: Record<string, boolean> = {}) {
    for (const [flag, enabled] of Object.entries(initial)) this.flags.set(flag, enabled);
  }

  /** Set or override a flag. */
  set(flag: string, enabled: boolean): void {
    this.flags.set(flag, enabled);
  }

  resolve(flag: string): boolean | null {
    return this.flags.has(flag) ? (this.flags.get(flag) as boolean) : null;
  }
}

/** Reads flags from env vars, e.g. flag `new-ui` → `FLAG_NEW_UI`. */
export class EnvFeatureFlagBackend implements FeatureFlagBackend {
  /**
   * @param env - Environment source (defaults to `process.env`).
   * @param prefix - Env var prefix. Default `FLAG_`.
   */
  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly prefix = "FLAG_",
  ) {}

  private key(flag: string): string {
    return this.prefix + flag.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  }

  resolve(flag: string): boolean | null {
    const raw = this.env[this.key(flag)];
    return raw === undefined ? null : coerceFlag(raw);
  }
}

/** Tries each backend in order; first non-`null` answer wins. */
export class CompositeFeatureFlagBackend implements FeatureFlagBackend {
  /**
   * @param backends - Backends in priority order.
   */
  constructor(private readonly backends: FeatureFlagBackend[]) {}

  async resolve(flag: string, context?: FlagContext): Promise<boolean | null> {
    for (const backend of this.backends) {
      const answer = await backend.resolve(flag, context);
      if (answer !== null) return answer;
    }
    return null;
  }
}
