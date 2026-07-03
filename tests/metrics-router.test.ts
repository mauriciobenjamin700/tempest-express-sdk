import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { MetricsUtils, createApp, makeMetricsRouter, runServer } from "@/index";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("MetricsUtils.toPrometheus with GPUs", () => {
  it("renders GPU gauges with a gpu label", () => {
    const text = MetricsUtils.toPrometheus(MetricsUtils.system(), [
      {
        index: 0,
        utilizationPercent: 55,
        memoryUsedMb: 1024,
        memoryTotalMb: 8192,
        temperatureC: 61,
      },
    ]);
    expect(text).toContain('gpu_utilization_percent{gpu="0"} 55');
    expect(text).toContain('gpu_memory_used_mb{gpu="0"} 1024');
    expect(text).toContain('gpu_temperature_celsius{gpu="0"} 61');
  });

  it("omits GPU lines when none are given", () => {
    expect(MetricsUtils.toPrometheus(MetricsUtils.system())).not.toContain("gpu_");
  });
});

describe("makeMetricsRouter", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const app = await createApp({
      health: false,
      configure: (a) => {
        a.use(makeMetricsRouter());
      },
    });
    server = await runServer(app, { port: 0 });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  it("serves Prometheus text at /metrics", async () => {
    const res = await fetch(`${base}/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const text = await res.text();
    expect(text).toContain("# TYPE process_uptime_seconds counter");
    expect(text).toContain("process_memory_used_percent");
  });
});
