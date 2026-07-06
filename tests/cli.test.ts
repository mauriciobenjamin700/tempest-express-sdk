import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "@/cli/index";
import { PasswordUtils } from "@/index";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let out = "";
let err = "";

beforeEach(() => {
  out = "";
  err = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    out += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    err += String(chunk);
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cli config", () => {
  it("prints resolved base settings, merging .env", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cli-"));
    writeFileSync(join(dir, ".env"), "PORT=9999\nDATABASE_URL=sqlite://./x.db\n");
    try {
      const code = await main(["config", "--dir", dir]);
      expect(code).toBe(0);
      const parsed = JSON.parse(out);
      expect(parsed.PORT).toBe(9999);
      expect(parsed.DATABASE_URL).toBe("sqlite://./x.db");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("cli user", () => {
  it("prints a ready-to-insert record with a verifiable hash", async () => {
    const code = await main([
      "user",
      "--email",
      "a@b.com",
      "--password",
      "s3cret-pass",
      "--admin",
    ]);
    expect(code).toBe(0);
    const record = JSON.parse(out);
    expect(record.email).toBe("a@b.com");
    expect(record.isAdmin).toBe(true);
    expect(record.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await new PasswordUtils().verify("s3cret-pass", record.hashedPassword)).toBe(
      true,
    );
  });

  it("errors without email/password", async () => {
    const code = await main(["user", "--email", "a@b.com"]);
    expect(code).toBe(1);
    expect(err).toContain("requires --email and --password");
  });
});

describe("cli help/version", () => {
  it("prints usage for --help", async () => {
    expect(await main(["--help"])).toBe(0);
    expect(out).toContain("tempest-express");
    expect(out).toContain("config");
    expect(out).toContain("user");
  });
});
