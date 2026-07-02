/**
 * Resilient HTTP client, mirroring `utils.http_client`.
 *
 * Wraps the native `fetch` with a retry policy (exponential backoff) and a
 * per-host circuit breaker: after N consecutive failures the breaker opens and
 * requests to that host fail fast with {@link CircuitOpenError} until a cooldown
 * elapses. No external dependency.
 */

/** Raised when the per-host circuit breaker is open. */
export class CircuitOpenError extends Error {
  constructor(readonly host: string) {
    super(`Circuit breaker is open for host ${host}`);
    this.name = "CircuitOpenError";
  }
}

/** Retry configuration for {@link HTTPClient}. */
export class RetryPolicy {
  /**
   * @param maxRetries - Additional attempts after the first. Default 2.
   * @param baseDelayMs - Base backoff in ms (doubles each attempt). Default 100.
   * @param retryOn - HTTP status codes that trigger a retry. Default 5xx + 429.
   */
  constructor(
    readonly maxRetries = 2,
    readonly baseDelayMs = 100,
    readonly retryOn: number[] = [429, 500, 502, 503, 504],
  ) {}

  /** Backoff delay in ms before `attempt` (0-indexed). */
  sleepFor(attempt: number): number {
    return this.baseDelayMs * 2 ** attempt;
  }
}

interface BreakerState {
  failures: number;
  openUntil: number;
}

/** Options for {@link HTTPClient}. */
export interface HTTPClientOptions {
  /** Prepended to relative request paths. */
  baseUrl?: string;
  /** Headers merged into every request. */
  defaultHeaders?: Record<string, string>;
  /** Per-request timeout in ms. Default 30000. */
  timeoutMs?: number;
  /** Retry configuration. */
  retryPolicy?: RetryPolicy;
  /** Consecutive failures before the breaker opens. Default 5. */
  breakerThreshold?: number;
  /** Breaker cooldown in ms once open. Default 30000. */
  breakerCooldownMs?: number;
}

/** A `fetch` wrapper with retries and a per-host circuit breaker. */
export class HTTPClient {
  private readonly baseUrl: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly retryPolicy: RetryPolicy;
  private readonly breakerThreshold: number;
  private readonly breakerCooldownMs: number;
  private readonly breakers = new Map<string, BreakerState>();

  /**
   * @param options - Base URL, headers, timeout, retry and breaker settings.
   */
  constructor(options: HTTPClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "";
    this.defaultHeaders = options.defaultHeaders ?? {};
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.retryPolicy = options.retryPolicy ?? new RetryPolicy();
    this.breakerThreshold = options.breakerThreshold ?? 5;
    this.breakerCooldownMs = options.breakerCooldownMs ?? 30000;
  }

  private resolve(url: string): string {
    return this.baseUrl && !/^https?:\/\//.test(url) ? `${this.baseUrl}${url}` : url;
  }

  private hostOf(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  }

  private breakerCheck(host: string): void {
    const state = this.breakers.get(host);
    if (state && state.openUntil > Date.now()) throw new CircuitOpenError(host);
  }

  private breakerRecord(host: string, failed: boolean): void {
    const state = this.breakers.get(host) ?? { failures: 0, openUntil: 0 };
    if (failed) {
      state.failures += 1;
      if (state.failures >= this.breakerThreshold) {
        state.openUntil = Date.now() + this.breakerCooldownMs;
        state.failures = 0;
      }
    } else {
      state.failures = 0;
      state.openUntil = 0;
    }
    this.breakers.set(host, state);
  }

  /**
   * Perform a request with retries and breaker protection.
   *
   * @param method - HTTP method.
   * @param url - Absolute URL or a path resolved against `baseUrl`.
   * @param init - Extra `fetch` init (headers, body, …).
   * @returns The `Response`.
   * @throws {CircuitOpenError} When the per-host breaker is open.
   */
  async request(method: string, url: string, init: RequestInit = {}): Promise<Response> {
    const target = this.resolve(url);
    const host = this.hostOf(target);
    this.breakerCheck(host);

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retryPolicy.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(target, {
          ...init,
          method,
          headers: { ...this.defaultHeaders, ...(init.headers ?? {}) },
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (this.retryPolicy.retryOn.includes(response.status)) {
          this.breakerRecord(host, true);
          if (attempt < this.retryPolicy.maxRetries) {
            await this.sleep(this.retryPolicy.sleepFor(attempt));
            continue;
          }
          return response;
        }
        this.breakerRecord(host, false);
        return response;
      } catch (error) {
        clearTimeout(timer);
        lastError = error;
        this.breakerRecord(host, true);
        if (attempt < this.retryPolicy.maxRetries) {
          await this.sleep(this.retryPolicy.sleepFor(attempt));
          continue;
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Request failed");
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** GET request. */
  get(url: string, init?: RequestInit): Promise<Response> {
    return this.request("GET", url, init);
  }
  /** POST request. */
  post(url: string, init?: RequestInit): Promise<Response> {
    return this.request("POST", url, init);
  }
  /** PUT request. */
  put(url: string, init?: RequestInit): Promise<Response> {
    return this.request("PUT", url, init);
  }
  /** PATCH request. */
  patch(url: string, init?: RequestInit): Promise<Response> {
    return this.request("PATCH", url, init);
  }
  /** DELETE request. */
  delete(url: string, init?: RequestInit): Promise<Response> {
    return this.request("DELETE", url, init);
  }
}
