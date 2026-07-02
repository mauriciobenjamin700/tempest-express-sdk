/**
 * System metrics, mirroring `utils.metrics.MetricsUtils`.
 *
 * Reads CPU, memory and process stats from Node's built-in `node:os` /
 * `process` — no native dependency (GPU metrics from the FastAPI SDK are out of
 * scope here). Includes a Prometheus text-format exporter.
 */

import { cpus, freemem, loadavg, totalmem } from "node:os";

/** CPU load metrics. */
export interface CPUMetrics {
  /** Number of logical cores. */
  cores: number;
  /** 1-minute load average (0 on platforms without load average). */
  load1: number;
  /** Load average over 1 minute as a fraction of core count. */
  loadPercent: number;
}

/** Memory usage metrics (bytes). */
export interface MemoryMetrics {
  /** Total system memory. */
  total: number;
  /** Free system memory. */
  free: number;
  /** Used system memory. */
  used: number;
  /** Used memory as a percentage of total. */
  usedPercent: number;
  /** Resident set size of the current process. */
  processRss: number;
}

/** A snapshot of system + process metrics. */
export interface SystemMetrics {
  cpu: CPUMetrics;
  memory: MemoryMetrics;
  /** Process uptime in seconds. */
  uptimeSeconds: number;
}

/** Read CPU load metrics. */
function readCpu(): CPUMetrics {
  const cores = cpus().length;
  const load1 = loadavg()[0] ?? 0;
  return {
    cores,
    load1,
    loadPercent: cores > 0 ? (load1 / cores) * 100 : 0,
  };
}

/** Read memory usage metrics. */
function readMemory(): MemoryMetrics {
  const total = totalmem();
  const free = freemem();
  const used = total - free;
  return {
    total,
    free,
    used,
    usedPercent: total > 0 ? (used / total) * 100 : 0,
    processRss: process.memoryUsage().rss,
  };
}

/** Read a full system snapshot. */
function readSystem(): SystemMetrics {
  return {
    cpu: readCpu(),
    memory: readMemory(),
    uptimeSeconds: process.uptime(),
  };
}

/**
 * Render a snapshot as Prometheus text-format metrics.
 *
 * @param snapshot - A snapshot (defaults to a fresh {@link readSystem}).
 * @returns The Prometheus exposition text.
 */
function toPrometheus(snapshot: SystemMetrics = readSystem()): string {
  const lines = [
    "# HELP process_cpu_load_percent 1-minute load average as percent of cores",
    "# TYPE process_cpu_load_percent gauge",
    `process_cpu_load_percent ${snapshot.cpu.loadPercent}`,
    "# HELP process_memory_used_percent System memory used percent",
    "# TYPE process_memory_used_percent gauge",
    `process_memory_used_percent ${snapshot.memory.usedPercent}`,
    "# HELP process_memory_rss_bytes Resident set size of the process",
    "# TYPE process_memory_rss_bytes gauge",
    `process_memory_rss_bytes ${snapshot.memory.processRss}`,
    "# HELP process_uptime_seconds Process uptime in seconds",
    "# TYPE process_uptime_seconds counter",
    `process_uptime_seconds ${snapshot.uptimeSeconds}`,
  ];
  return `${lines.join("\n")}\n`;
}

/** Stateless system-metrics reader + Prometheus exporter. */
export const MetricsUtils = {
  cpu: readCpu,
  memory: readMemory,
  system: readSystem,
  toPrometheus,
} as const;
