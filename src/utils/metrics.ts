/**
 * System metrics, mirroring `utils.metrics.MetricsUtils`.
 *
 * Reads CPU, memory and process stats from Node's built-in `node:os` /
 * `process` — no native dependency. Optional GPU metrics shell out to
 * `nvidia-smi` (returns `[]` when unavailable). Includes a Prometheus
 * text-format exporter.
 */

import { execFile } from "node:child_process";
import { cpus, freemem, loadavg, totalmem } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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

/** A single GPU's metrics (from `nvidia-smi`). */
export interface GPUMetrics {
  /** GPU index. */
  index: number;
  /** GPU utilization percent. */
  utilizationPercent: number;
  /** Used memory in MiB. */
  memoryUsedMb: number;
  /** Total memory in MiB. */
  memoryTotalMb: number;
  /** Core temperature in °C. */
  temperatureC: number;
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
 * Read GPU metrics via `nvidia-smi`. Returns `[]` when the tool is absent or
 * fails (no GPU, not installed) — never throws.
 *
 * @returns One {@link GPUMetrics} per detected GPU.
 */
async function readGpus(): Promise<GPUMetrics[]> {
  try {
    const { stdout } = await execFileAsync("nvidia-smi", [
      "--query-gpu=index,utilization.gpu,memory.used,memory.total,temperature.gpu",
      "--format=csv,noheader,nounits",
    ]);
    return stdout
      .trim()
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const [index, util, used, total, temp] = line
          .split(",")
          .map((v) => Number(v.trim()));
        return {
          index: index ?? 0,
          utilizationPercent: util ?? 0,
          memoryUsedMb: used ?? 0,
          memoryTotalMb: total ?? 0,
          temperatureC: temp ?? 0,
        };
      });
  } catch {
    return [];
  }
}

/**
 * Render metrics as Prometheus text-format.
 *
 * @param snapshot - A system snapshot (defaults to a fresh {@link readSystem}).
 * @param gpus - Optional GPU metrics to append (from {@link readGpus}).
 * @returns The Prometheus exposition text.
 */
function toPrometheus(
  snapshot: SystemMetrics = readSystem(),
  gpus: GPUMetrics[] = [],
): string {
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
  if (gpus.length > 0) {
    lines.push(
      "# HELP gpu_utilization_percent GPU utilization percent",
      "# TYPE gpu_utilization_percent gauge",
    );
    for (const gpu of gpus) {
      lines.push(`gpu_utilization_percent{gpu="${gpu.index}"} ${gpu.utilizationPercent}`);
    }
    lines.push(
      "# HELP gpu_memory_used_mb GPU memory used in MiB",
      "# TYPE gpu_memory_used_mb gauge",
    );
    for (const gpu of gpus) {
      lines.push(`gpu_memory_used_mb{gpu="${gpu.index}"} ${gpu.memoryUsedMb}`);
    }
    lines.push(
      "# HELP gpu_temperature_celsius GPU core temperature",
      "# TYPE gpu_temperature_celsius gauge",
    );
    for (const gpu of gpus) {
      lines.push(`gpu_temperature_celsius{gpu="${gpu.index}"} ${gpu.temperatureC}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/** Stateless system-metrics reader + Prometheus exporter. */
export const MetricsUtils = {
  cpu: readCpu,
  memory: readMemory,
  system: readSystem,
  gpus: readGpus,
  toPrometheus,
} as const;
