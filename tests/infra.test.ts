import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CompositeFeatureFlagBackend,
  EnvFeatureFlagBackend,
  FeatureFlags,
  LocalUploadStorage,
  MemoryBroker,
  MemoryFeatureFlagBackend,
  TaskManager,
  buildContentDisposition,
  coerceFlag,
} from "@/index";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("MemoryBroker", () => {
  it("delivers published messages to subscribers", async () => {
    const broker = new MemoryBroker();
    const received: unknown[] = [];
    const unsub = await broker.subscribe("q", (m) => {
      received.push(m);
    });
    await broker.publish("q", { n: 1 });
    await broker.publish("q", { n: 2 });
    expect(received).toEqual([{ n: 1 }, { n: 2 }]);
    await unsub();
    await broker.publish("q", { n: 3 });
    expect(received).toHaveLength(2);
  });
});

describe("TaskManager", () => {
  it("dispatches enqueued tasks to handlers", async () => {
    const tasks = new TaskManager();
    const done: string[] = [];
    tasks.register<{ id: string }>("send-email", (p) => {
      done.push(p.id);
    });
    await tasks.start();
    await tasks.enqueue("send-email", { id: "a" });
    await tasks.enqueue("send-email", { id: "b" });
    expect(done).toEqual(["a", "b"]);
    await tasks.stop();
  });
});

describe("FeatureFlags", () => {
  it("coerces loose values", () => {
    expect(coerceFlag("on")).toBe(true);
    expect(coerceFlag("0")).toBe(false);
    expect(coerceFlag(true)).toBe(true);
  });

  it("resolves through a composite backend with env + memory", async () => {
    const memory = new MemoryFeatureFlagBackend({ beta: true });
    const env = new EnvFeatureFlagBackend({ FLAG_GAMMA: "true" }, "FLAG_");
    const flags = new FeatureFlags(new CompositeFeatureFlagBackend([memory, env]));
    expect(await flags.isEnabled("beta")).toBe(true);
    expect(await flags.isEnabled("gamma")).toBe(true);
    expect(await flags.isEnabled("unknown")).toBe(false);
  });
});

describe("LocalUploadStorage", () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "tes-storage-"));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("saves, reads, urls and deletes", async () => {
    const storage = new LocalUploadStorage({ root, baseUrl: "https://cdn.test" });
    const result = await storage.save("a/b.txt", new TextEncoder().encode("hi"), {
      contentType: "text/plain",
    });
    expect(result).toMatchObject({ key: "a/b.txt", size: 2, contentType: "text/plain" });
    expect(result.url).toBe("https://cdn.test/a/b.txt");
    expect((await storage.read("a/b.txt")).toString()).toBe("hi");
    await storage.delete("a/b.txt");
    await expect(storage.read("a/b.txt")).rejects.toThrow();
  });

  it("builds a Content-Disposition header", () => {
    expect(buildContentDisposition("relatório.pdf")).toBe(
      "attachment; filename*=UTF-8''relat%C3%B3rio.pdf",
    );
  });
});
