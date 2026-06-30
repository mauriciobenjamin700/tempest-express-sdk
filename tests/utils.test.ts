import {
  AttemptThrottle,
  JWTUtils,
  PasswordUtils,
  cpfField,
  generateOpaqueToken,
  isValidCnpj,
  isValidCpf,
  isValidUf,
  listStates,
  normalizeUf,
  onlyDigits,
  verifyOpaqueToken,
} from "@/index";
import { describe, expect, it } from "vitest";

describe("BR documents", () => {
  it("validates CPF (format + check digits)", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("52998224725")).toBe(true);
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCpf("529.982.247-24")).toBe(false);
  });

  it("validates CNPJ", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11.222.333/0001-80")).toBe(false);
  });

  it("normalizes via the cpfField zod schema", () => {
    expect(cpfField.parse("529.982.247-25")).toBe("52998224725");
    expect(() => cpfField.parse("bad")).toThrow();
  });

  it("strips non-digits", () => {
    expect(onlyDigits("(11) 99999-8888")).toBe("11999998888");
  });
});

describe("locations", () => {
  it("ships all 27 states", () => {
    expect(listStates()).toHaveLength(27);
  });

  it("validates and normalizes UF", () => {
    expect(isValidUf("sp")).toBe(true);
    expect(isValidUf("ZZ")).toBe(false);
    expect(normalizeUf("sp")).toBe("SP");
  });
});

describe("opaque tokens", () => {
  it("round-trips a generated token", () => {
    const { plaintext, tokenHash } = generateOpaqueToken();
    expect(verifyOpaqueToken(plaintext, tokenHash)).toBe(true);
    expect(verifyOpaqueToken("wrong", tokenHash)).toBe(false);
  });
});

describe("AttemptThrottle", () => {
  it("blocks after the budget is exhausted", async () => {
    const throttle = new AttemptThrottle({ maxAttempts: 2, windowSeconds: 60 });
    expect((await throttle.hit("k")).allowed).toBe(true);
    expect((await throttle.hit("k")).allowed).toBe(true);
    const third = await throttle.hit("k");
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
    await throttle.reset("k");
    expect((await throttle.hit("k")).allowed).toBe(true);
  });
});

describe("PasswordUtils", () => {
  it("hashes and verifies", async () => {
    const pw = new PasswordUtils(4);
    const hash = await pw.hash("secret");
    expect(await pw.verify("secret", hash)).toBe(true);
    expect(await pw.verify("nope", hash)).toBe(false);
  });
});

describe("JWTUtils", () => {
  it("encodes and decodes with claims", async () => {
    const jwt = new JWTUtils("test-secret", { issuer: "tempest" });
    const token = await jwt.encode({ sub: "user-1" });
    const claims = await jwt.decode(token);
    expect(claims.sub).toBe("user-1");
    expect(claims.iss).toBe("tempest");
    expect(await jwt.decodeOrNull("garbage")).toBeNull();
  });
});
