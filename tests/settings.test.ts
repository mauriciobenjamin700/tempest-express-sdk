import {
  authSettingsShape,
  baseAppSettingsShape,
  emailSettingsShape,
  envBoolean,
  envList,
  jwtSettingsShape,
  loadSettings,
  minioSettingsShape,
  sessionSettingsShape,
  uploadSettingsShape,
  z,
} from "@/index";
import { describe, expect, it } from "vitest";

describe("settings fragments", () => {
  it("composes base + domain fragments and applies defaults", () => {
    const schema = z.object({ ...baseAppSettingsShape, ...jwtSettingsShape });
    const settings = loadSettings(schema, {} as NodeJS.ProcessEnv);

    expect(settings.HOST).toBe("127.0.0.1");
    expect(settings.PORT).toBe(8000);
    expect(settings.DATABASE_URL).toBe("sqlite://./app.db");
    expect(settings.JWT_ALGORITHM).toBe("HS256");
    expect(settings.JWT_ACCESS_TTL_SECONDS).toBe(3600);
    expect(settings.JWT_REFRESH_TTL_SECONDS).toBe(86400 * 7);
    expect(settings.JWT_ISSUER).toBeUndefined();
  });

  it("reads env var names case-sensitively and coerces numbers", () => {
    const schema = z.object({ ...jwtSettingsShape });
    const settings = loadSettings(schema, {
      JWT_SECRET: "s".repeat(32),
      JWT_ACCESS_TTL_SECONDS: "900",
      JWT_ISSUER: "tempest",
    } as unknown as NodeJS.ProcessEnv);

    expect(settings.JWT_ACCESS_TTL_SECONDS).toBe(900);
    expect(settings.JWT_ISSUER).toBe("tempest");
  });

  it("freezes the result", () => {
    const settings = loadSettings(
      z.object({ ...jwtSettingsShape }),
      {} as NodeJS.ProcessEnv,
    );
    expect(Object.isFrozen(settings)).toBe(true);
  });
});

describe("envBoolean", () => {
  it("treats 'false'/'0'/'no' as false (unlike z.coerce.boolean)", () => {
    const schema = z.object({ FLAG: envBoolean(true) });
    expect(schema.parse({ FLAG: "false" }).FLAG).toBe(false);
    expect(schema.parse({ FLAG: "0" }).FLAG).toBe(false);
    expect(schema.parse({ FLAG: "no" }).FLAG).toBe(false);
  });

  it("treats 'true'/'1'/'yes'/'on' as true", () => {
    const schema = z.object({ FLAG: envBoolean(false) });
    expect(schema.parse({ FLAG: "true" }).FLAG).toBe(true);
    expect(schema.parse({ FLAG: "1" }).FLAG).toBe(true);
    expect(schema.parse({ FLAG: "YES" }).FLAG).toBe(true);
    expect(schema.parse({ FLAG: "on" }).FLAG).toBe(true);
  });

  it("falls back to the default when absent", () => {
    expect(z.object({ FLAG: envBoolean(true) }).parse({}).FLAG).toBe(true);
    expect(z.object({ FLAG: envBoolean(false) }).parse({}).FLAG).toBe(false);
  });
});

describe("envList", () => {
  it("splits, trims and drops empties", () => {
    const schema = z.object({ EXT: uploadSettingsShape.UPLOAD_ALLOWED_EXTENSIONS });
    expect(schema.parse({ EXT: "png, jpg ,, gif" }).EXT).toEqual(["png", "jpg", "gif"]);
    expect(schema.parse({}).EXT).toEqual([]);
  });

  it("is reusable standalone", () => {
    const schema = z.object({ ITEMS: envList("a,b") });
    expect(schema.parse({}).ITEMS).toEqual(["a", "b"]);
  });
});

describe("enum + optional fields", () => {
  it("validates AUTH_TOKEN_DELIVERY / SESSION_COOKIE_SAMESITE enums", () => {
    const schema = z.object({ ...authSettingsShape, ...sessionSettingsShape });
    expect(schema.parse({}).AUTH_TOKEN_DELIVERY).toBe("bearer");
    expect(schema.parse({ AUTH_TOKEN_DELIVERY: "cookie" }).AUTH_TOKEN_DELIVERY).toBe(
      "cookie",
    );
    expect(() => schema.parse({ SESSION_COOKIE_SAMESITE: "bogus" })).toThrow();
  });

  it("parses MinIO optional public flag", () => {
    const schema = z.object({ ...minioSettingsShape });
    expect(schema.parse({}).MINIO_PUBLIC_SECURE).toBeUndefined();
    expect(schema.parse({ MINIO_PUBLIC_SECURE: "true" }).MINIO_PUBLIC_SECURE).toBe(true);
    expect(schema.parse({ MINIO_PUBLIC_SECURE: "false" }).MINIO_PUBLIC_SECURE).toBe(
      false,
    );
  });

  it("keeps email defaults sane", () => {
    const settings = loadSettings(
      z.object({ ...emailSettingsShape }),
      {} as NodeJS.ProcessEnv,
    );
    expect(settings.SMTP_PORT).toBe(587);
    expect(settings.SMTP_USE_TLS).toBe(true);
    expect(settings.SMTP_USE_SSL).toBe(false);
  });
});
