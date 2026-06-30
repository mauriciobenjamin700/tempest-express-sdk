/**
 * Attempt throttling, mirroring `utils.throttle`.
 *
 * Sliding-window attempt counter for flows that must resist brute force
 * (login, OTP, code verification). The default {@link MemoryThrottleBackend} is
 * process-local; swap in a shared backend (e.g. Redis) for multi-instance
 * deployments by implementing {@link ThrottleBackend}.
 */

/** The outcome of recording or inspecting an attempt. */
export interface ThrottleStatus {
  /** Whether the attempt is allowed (budget not yet exhausted). */
  allowed: boolean;
  /** Remaining attempts in the current window (never negative). */
  remaining: number;
  /** Seconds until the window resets (`0` when allowed). */
  retryAfterSeconds: number;
}

/** Pluggable storage of attempt timestamps per key. */
export interface ThrottleBackend {
  /** Record an attempt at `now` (epoch ms) and return timestamps in-window. */
  hit(key: string, windowMs: number, now: number): Promise<number[]>;
  /** Read the in-window attempt timestamps without recording a new one. */
  peek(key: string, windowMs: number, now: number): Promise<number[]>;
  /** Clear all recorded attempts for `key`. */
  reset(key: string): Promise<void>;
}

/** Process-local {@link ThrottleBackend} backed by a `Map`. */
export class MemoryThrottleBackend implements ThrottleBackend {
  private readonly store = new Map<string, number[]>();

  private window(key: string, windowMs: number, now: number): number[] {
    const cutoff = now - windowMs;
    const kept = (this.store.get(key) ?? []).filter((ts) => ts > cutoff);
    this.store.set(key, kept);
    return kept;
  }

  async hit(key: string, windowMs: number, now: number): Promise<number[]> {
    const kept = this.window(key, windowMs, now);
    kept.push(now);
    this.store.set(key, kept);
    return kept;
  }

  async peek(key: string, windowMs: number, now: number): Promise<number[]> {
    return this.window(key, windowMs, now);
  }

  async reset(key: string): Promise<void> {
    this.store.delete(key);
  }
}

/** Options for {@link AttemptThrottle}. */
export interface AttemptThrottleOptions {
  /** Maximum attempts allowed within the window. */
  maxAttempts: number;
  /** Sliding-window length in seconds. */
  windowSeconds: number;
  /** Storage backend. Defaults to a {@link MemoryThrottleBackend}. */
  backend?: ThrottleBackend;
}

/** A sliding-window attempt limiter keyed by an arbitrary string. */
export class AttemptThrottle {
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private readonly backend: ThrottleBackend;

  /**
   * @param options - Budget, window and optional backend.
   */
  constructor(options: AttemptThrottleOptions) {
    this.maxAttempts = options.maxAttempts;
    this.windowMs = options.windowSeconds * 1000;
    this.backend = options.backend ?? new MemoryThrottleBackend();
  }

  /** Build a status from a set of in-window attempt timestamps. */
  private status(attempts: number[], now: number): ThrottleStatus {
    const allowed = attempts.length <= this.maxAttempts;
    const remaining = Math.max(0, this.maxAttempts - attempts.length);
    let retryAfterSeconds = 0;
    if (!allowed && attempts.length > 0) {
      const oldest = Math.min(...attempts);
      retryAfterSeconds = Math.max(0, Math.ceil((oldest + this.windowMs - now) / 1000));
    }
    return { allowed, remaining, retryAfterSeconds };
  }

  /**
   * Inspect the current budget for `key` without recording an attempt.
   *
   * @param key - The throttle key (e.g. `login:<ip>`).
   * @returns The current status.
   */
  async check(key: string): Promise<ThrottleStatus> {
    const now = Date.now();
    return this.status(await this.backend.peek(key, this.windowMs, now), now);
  }

  /**
   * Record an attempt for `key` and return the resulting status.
   *
   * @param key - The throttle key.
   * @returns The status after recording the attempt.
   */
  async hit(key: string): Promise<ThrottleStatus> {
    const now = Date.now();
    return this.status(await this.backend.hit(key, this.windowMs, now), now);
  }

  /**
   * Clear all recorded attempts for `key` (e.g. after a successful login).
   *
   * @param key - The throttle key.
   */
  async reset(key: string): Promise<void> {
    await this.backend.reset(key);
  }
}
