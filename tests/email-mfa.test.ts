import { createHmac } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  type AuthUser,
  EmailProvider,
  type EmailUtils,
  JWTUtils,
  MfaService,
  type MfaStore,
  PasswordUtils,
  TOTPHelper,
  UserAuthService,
  type UserStore,
  createApp,
  makeAuthRouter,
  runServer,
} from "@/index";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// --- Compute a live TOTP code (mirrors src/utils/totp.ts: SHA1/6/30) --------
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function b32Decode(secret: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of secret.toUpperCase().replace(/=+$/, "")) {
    const i = B32.indexOf(c);
    if (i === -1) continue;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
function totpCode(secret: string): string {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const d = createHmac("sha1", b32Decode(secret)).update(buf).digest();
  const o = (d[d.length - 1] as number) & 0xf;
  const bin =
    (((d[o] as number) & 0x7f) << 24) |
    (((d[o + 1] as number) & 0xff) << 16) |
    (((d[o + 2] as number) & 0xff) << 8) |
    ((d[o + 3] as number) & 0xff);
  return (bin % 1_000_000).toString().padStart(6, "0");
}

describe("EmailProvider (MessagingProvider)", () => {
  it("sends text and media via EmailUtils", async () => {
    const send = vi.fn(async () => undefined);
    const provider = new EmailProvider({
      email: { send } as unknown as EmailUtils,
      subject: "Hi",
    });
    expect(await provider.sendText("a@x.com", "hello")).toEqual({ status: "sent" });
    expect(send).toHaveBeenCalledWith({ to: "a@x.com", subject: "Hi", text: "hello" });
    expect(await provider.status()).toBe("connected");

    await provider.sendMedia("a@x.com", { kind: "image", media: "https://x/y.png" });
    expect(send).toHaveBeenCalledTimes(2);
  });
});

// --- MFA at login (challenge) -----------------------------------------------
class Store implements UserStore, MfaStore {
  users = new Map<string, AuthUser & { secret?: string; enabled?: boolean }>();
  seq = 0;
  async findByEmail(e: string) {
    return [...this.users.values()].find((u) => u.email === e) ?? null;
  }
  async findById(id: string) {
    return this.users.get(id) ?? null;
  }
  async create(d: { email: string; passwordHash: string; name: string | null }) {
    this.seq += 1;
    const u = { id: `u${this.seq}`, ...d, isActive: true, roles: ["user"] };
    this.users.set(u.id, u);
    return u;
  }
  async setSecret(id: string, s: string) {
    const u = this.users.get(id);
    if (u) u.secret = s;
  }
  async getSecret(id: string) {
    return this.users.get(id)?.secret ?? null;
  }
  async setEnabled(id: string, e: boolean) {
    const u = this.users.get(id);
    if (u) u.enabled = e;
  }
  async isEnabled(id: string) {
    return this.users.get(id)?.enabled ?? false;
  }
}

let server: Server;
let base: string;
let store: Store;

beforeAll(async () => {
  store = new Store();
  const password = new PasswordUtils(4);
  const jwt = new JWTUtils("secret");
  const mfa = new MfaService({ store, totp: new TOTPHelper({ issuer: "Test" }) });
  const app = await createApp({
    health: false,
    configure: (a) => {
      a.use(
        makeAuthRouter({
          service: new UserAuthService({
            store,
            password,
            jwt,
            passwordMinLength: 8,
            mfa,
          }),
          jwt,
          mfa,
        }),
      );
    },
  });
  server = await runServer(app, { port: 0 });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => server.close());

const post = (path: string, body: unknown) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("MFA at login", () => {
  it("returns a challenge then issues tokens on a valid code", async () => {
    await post("/auth/signup", { email: "mfa@x.com", password: "password12" });
    const user = await store.findByEmail("mfa@x.com");
    const secret = "JBSWY3DPEHPK3PXP";
    if (user) {
      user.secret = secret;
      user.enabled = true;
    }

    const login = await post("/auth/login", {
      email: "mfa@x.com",
      password: "password12",
    });
    expect(login.status).toBe(200);
    const challenge = (await login.json()) as {
      mfaRequired?: boolean;
      mfaToken?: string;
    };
    expect(challenge.mfaRequired).toBe(true);
    expect(challenge.mfaToken).toBeTruthy();

    const bad = await post("/auth/mfa/challenge", {
      mfaToken: challenge.mfaToken,
      code: "000000",
    });
    expect(bad.status).toBe(401);

    const ok = await post("/auth/mfa/challenge", {
      mfaToken: challenge.mfaToken,
      code: totpCode(secret),
    });
    expect(ok.status).toBe(200);
    const auth = (await ok.json()) as { tokens?: { accessToken: string } };
    expect(auth.tokens?.accessToken).toBeTruthy();
  });

  it("logs in normally when MFA is disabled", async () => {
    await post("/auth/signup", { email: "plain@x.com", password: "password12" });
    const res = await post("/auth/login", {
      email: "plain@x.com",
      password: "password12",
    });
    const body = (await res.json()) as { tokens?: unknown; mfaRequired?: boolean };
    expect(body.mfaRequired).toBeUndefined();
    expect(body.tokens).toBeTruthy();
  });
});
