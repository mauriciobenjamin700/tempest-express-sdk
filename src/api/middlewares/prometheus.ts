/**
 * `HttpMetrics` + `prometheusMiddleware` — per-request Prometheus metrics,
 * mirroring the FastAPI `PrometheusMiddleware`.
 *
 * Complements the system `/metrics` router (`MetricsUtils.toPrometheus`, which
 * reports process/host gauges) with **per-request** instrumentation: a request
 * counter labelled by method/path/status and a latency histogram. Everything is
 * in-process and dependency-free; expose it with {@link HttpMetrics.render}.
 */

import type { RequestHandler } from "express";

/** Default histogram buckets in seconds (Prometheus client defaults). */
const DEFAULT_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
] as const;

interface HistogramState {
  bucketCounts: number[];
  sum: number;
  count: number;
}

/**
 * In-process HTTP request metrics: a labelled request counter and a latency
 * histogram, rendered as Prometheus text.
 */
export class HttpMetrics {
  private readonly buckets: number[];
  /** `method|status` → count. */
  private readonly requestTotals = new Map<string, number>();
  /** `method|route` → histogram. */
  private readonly durations = new Map<string, HistogramState>();

  constructor(options: { buckets?: number[] } = {}) {
    this.buckets = [...(options.buckets ?? DEFAULT_BUCKETS)].sort((a, b) => a - b);
  }

  /**
   * Record one completed request.
   *
   * @param method - HTTP method.
   * @param route - The route pattern (or path) — keep cardinality bounded.
   * @param status - Response status code.
   * @param durationSeconds - Wall-clock request duration in seconds.
   */
  observe(method: string, route: string, status: number, durationSeconds: number): void {
    const totalKey = `${method}|${status}`;
    this.requestTotals.set(totalKey, (this.requestTotals.get(totalKey) ?? 0) + 1);

    const durKey = `${method}|${route}`;
    let hist = this.durations.get(durKey);
    if (!hist) {
      hist = { bucketCounts: new Array(this.buckets.length).fill(0), sum: 0, count: 0 };
      this.durations.set(durKey, hist);
    }
    hist.sum += durationSeconds;
    hist.count += 1;
    for (let i = 0; i < this.buckets.length; i += 1) {
      const upper = this.buckets[i];
      if (upper !== undefined && durationSeconds <= upper) {
        hist.bucketCounts[i] = (hist.bucketCounts[i] ?? 0) + 1;
      }
    }
  }

  /** Render the collected metrics as Prometheus exposition text. */
  render(): string {
    const lines: string[] = [];
    lines.push("# HELP http_requests_total Total HTTP requests.");
    lines.push("# TYPE http_requests_total counter");
    for (const [key, value] of this.requestTotals) {
      const [method = "", status = ""] = key.split("|");
      lines.push(
        `http_requests_total{method="${esc(method)}",status="${esc(status)}"} ${value}`,
      );
    }

    lines.push("# HELP http_request_duration_seconds HTTP request latency.");
    lines.push("# TYPE http_request_duration_seconds histogram");
    for (const [key, hist] of this.durations) {
      const [method = "", route = ""] = key.split("|");
      const labels = `method="${esc(method)}",route="${esc(route)}"`;
      // `bucketCounts[i]` is already the cumulative count of observations
      // <= buckets[i], which is exactly the `le` semantics Prometheus wants.
      for (let i = 0; i < this.buckets.length; i += 1) {
        lines.push(
          `http_request_duration_seconds_bucket{${labels},le="${this.buckets[i]}"} ${hist.bucketCounts[i] ?? 0}`,
        );
      }
      lines.push(
        `http_request_duration_seconds_bucket{${labels},le="+Inf"} ${hist.count}`,
      );
      lines.push(`http_request_duration_seconds_sum{${labels}} ${hist.sum}`);
      lines.push(`http_request_duration_seconds_count{${labels}} ${hist.count}`);
    }
    return `${lines.join("\n")}\n`;
  }

  /**
   * Build the middleware that records each request into this collector.
   *
   * @param options - Optional exempt paths (e.g. the metrics route itself).
   * @returns An Express middleware.
   */
  middleware(options: { exemptPaths?: string[] } = {}): RequestHandler {
    const exempt = new Set(options.exemptPaths ?? []);
    return (req, res, next) => {
      if (exempt.has(req.path)) {
        next();
        return;
      }
      const start = process.hrtime.bigint();
      res.on("finish", () => {
        const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
        // `req.route?.path` is the low-cardinality pattern; fall back to path.
        const route = (req.route as { path?: string } | undefined)?.path ?? req.path;
        this.observe(req.method, route, res.statusCode, durationSeconds);
      });
      next();
    };
  }
}

function esc(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

/**
 * Convenience factory: a fresh {@link HttpMetrics} plus its middleware.
 *
 * @param options - Histogram buckets and exempt paths.
 * @returns The collector and its middleware.
 */
export function prometheusMiddleware(
  options: { buckets?: number[]; exemptPaths?: string[] } = {},
): { metrics: HttpMetrics; middleware: RequestHandler } {
  const metrics = new HttpMetrics(
    options.buckets !== undefined ? { buckets: options.buckets } : {},
  );
  return {
    metrics,
    middleware: metrics.middleware(
      options.exemptPaths !== undefined ? { exemptPaths: options.exemptPaths } : {},
    ),
  };
}
