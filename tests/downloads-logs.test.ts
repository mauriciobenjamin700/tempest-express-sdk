import { mkdtempSync, rmSync } from "node:fs";
import { readFileSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  JSONLogger,
  configureFileLogging,
  makeLogsRouter,
  resolveDownloadPath,
  sendBytesDownload,
  sendFileDownload,
} from "@/index";
import express, { type Express } from "express";
import { afterEach, describe, expect, it } from "vitest";

let server: Server | undefined;
async function boot(app: Express): Promise<string> {
  return new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const { port } = server?.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}
afterEach(() => {
  server?.close();
  server = undefined;
});

describe("resolveDownloadPath", () => {
  it("resolves within the root and blocks traversal", () => {
    expect(resolveDownloadPath("/srv/files", "a/b.txt")).toBe("/srv/files/a/b.txt");
    expect(resolveDownloadPath("/srv/files", "x.txt", "sub")).toBe(
      "/srv/files/sub/x.txt",
    );
    expect(() => resolveDownloadPath("/srv/files", "../../etc/passwd")).toThrow();
  });
});

describe("file downloads", () => {
  it("sends bytes with content-disposition", async () => {
    const app = express();
    app.get("/b", (_req, res) =>
      sendBytesDownload(res, Buffer.from("hello"), {
        filename: "hi.txt",
        contentType: "text/plain",
      }),
    );
    const base = await boot(app);
    const res = await fetch(`${base}/b`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("hi.txt");
    expect(await res.text()).toBe("hello");
  });

  it("streams a file with Range support (206)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dl-"));
    const file = join(dir, "data.txt");
    writeFileSync(file, "0123456789");
    try {
      const app = express();
      app.get("/f", (req, res) => {
        void sendFileDownload(req, res, file, { inline: true });
      });
      const base = await boot(app);

      const full = await fetch(`${base}/f`);
      expect(full.status).toBe(200);
      expect(full.headers.get("accept-ranges")).toBe("bytes");
      expect(await full.text()).toBe("0123456789");

      const partial = await fetch(`${base}/f`, { headers: { range: "bytes=2-5" } });
      expect(partial.status).toBe(206);
      expect(partial.headers.get("content-range")).toBe("bytes 2-5/10");
      expect(await partial.text()).toBe("2345");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("configureFileLogging", () => {
  it("routes records to per-level files and 500 records to 500.log", async () => {
    const dir = mkdtempSync(join(tmpdir(), "logs-"));
    const handle = configureFileLogging({ dir });
    try {
      const logger = new JSONLogger("test");
      logger.info("hello");
      logger.error("boom", { http_500: true });
      // Give the write streams a tick to flush.
      await new Promise((r) => setTimeout(r, 20));

      expect(readFileSync(join(dir, "info.log"), "utf8")).toContain("hello");
      expect(readFileSync(join(dir, "error.log"), "utf8")).toContain("boom");
      expect(readFileSync(join(dir, "500.log"), "utf8")).toContain("boom");
    } finally {
      handle.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("makeLogsRouter", () => {
  it("serves paginated entries from the log files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "logs-"));
    writeFileSync(
      join(dir, "info.log"),
      `${JSON.stringify({ level: "info", message: "a" })}\n${JSON.stringify({ level: "info", message: "b" })}\n`,
    );
    try {
      const app = express();
      app.use(makeLogsRouter({ dir }));
      const base = await boot(app);
      const res = await fetch(`${base}/logs?source=info`);
      const body = (await res.json()) as { items: { message: string }[]; total: number };
      expect(body.total).toBe(2);
      expect(body.items[0]?.message).toBe("b"); // newest first
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects an invalid source", async () => {
    const dir = mkdtempSync(join(tmpdir(), "logs-"));
    try {
      const app = express();
      app.use(makeLogsRouter({ dir }));
      const base = await boot(app);
      expect((await fetch(`${base}/logs?source=bogus`)).status).toBe(422);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
