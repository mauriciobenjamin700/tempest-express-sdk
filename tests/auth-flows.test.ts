import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  ActivationService,
  type ActivationStore,
  type AuthUser,
  JWTUtils,
  MfaService,
  type MfaStore,
  PasswordResetService,
  type PasswordResetStore,
  PasswordUtils,
  TOTPHelper,
  UserAuthService,
  type UserStore,
  createApp,
  makeAuthRouter,
  runServer,
} from "@/index";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** Combined in-memory store implementing every auth port. */
class Store implements UserStore, MfaStore, ActivationStore, PasswordResetStore {
  users = new Map<string, AuthUser & { mfaSecret?: string; mfaEnabled?: boolean }>();
  activation = new Map<string, { userId: string; expiresAt: number }>();
  reset = new Map<string, { userId: string; expiresAt: number }>();
  seq = 0;

  async findByEmail(email: string) {
    return [...this.users.values()].find((u) => u.email === email) ?? null;
  }
  async findById(id: string) {
    return this.users.get(id) ?? null;
  }
  async create(data: { email: string; passwordHash: string; name: string | null }) {
    this.seq += 1;
    const user = {
      id: `u${this.seq}`,
      email: data.email,
      passwordHash: data.passwordHash,
      name: data.name,
      isActive: true,
      roles: ["user"],
    };
    this.users.set(user.id, user);
    return user;
  }
  // MFA
  async setSecret(userId: string, secret: string) {
    const u = this.users.get(userId);
    if (u) u.mfaSecret = secret;
  }
  async getSecret(userId: string) {
    return this.users.get(userId)?.mfaSecret ?? null;
  }
  async setEnabled(userId: string, enabled: boolean) {
    const u = this.users.get(userId);
    if (u) u.mfaEnabled = enabled;
  }
  async isEnabled(userId: string) {
    return this.users.get(userId)?.mfaEnabled ?? false;
  }
  // Activation
  async saveActivationToken(userId: string, hash: string, expiresAt: number) {
    this.activation.set(hash, { userId, expiresAt });
  }
  async findActivationToken(hash: string) {
    return this.activation.get(hash) ?? null;
  }
  async clearActivationToken(hash: string) {
    this.activation.delete(hash);
  }
  async activate(userId: string) {
    const u = this.users.get(userId);
    if (u) u.isActive = true;
  }
  // Password reset
  async findUserIdByEmail(email: string) {
    return (await this.findByEmail(email))?.id ?? null;
  }
  async saveResetToken(userId: string, hash: string, expiresAt: number) {
    this.reset.set(hash, { userId, expiresAt });
  }
  async findResetToken(hash: string) {
    return this.reset.get(hash) ?? null;
  }
  async clearResetToken(hash: string) {
    this.reset.delete(hash);
  }
  async updatePassword(userId: string, passwordHash: string) {
    const u = this.users.get(userId);
    if (u) u.passwordHash = passwordHash;
  }
}

let server: Server;
let base: string;
let store: Store;

beforeAll(async () => {
  store = new Store();
  const password = new PasswordUtils(4);
  const jwt = new JWTUtils("secret");
  const app = await createApp({
    health: false,
    configure: (a) => {
      a.use(
        makeAuthRouter({
          service: new UserAuthService({ store, password, jwt, passwordMinLength: 8 }),
          jwt,
          activation: new ActivationService({ store }),
          passwordReset: new PasswordResetService({
            store,
            password,
            passwordMinLength: 8,
          }),
          mfa: new MfaService({ store, totp: new TOTPHelper({ issuer: "Test" }) }),
        }),
      );
    },
  });
  server = await runServer(app, { port: 0 });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => server.close());

const post = (path: string, body: unknown, token?: string) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

describe("password reset flow", () => {
  it("resets the password end to end", async () => {
    await post("/auth/signup", { email: "r@x.com", password: "oldpassword" });

    const req = await post("/auth/password-reset/request", { email: "r@x.com" });
    expect(req.status).toBe(202);
    const { token } = (await req.json()) as { token: string };
    expect(token).toBeTruthy();

    const confirm = await post("/auth/password-reset/confirm", {
      token,
      password: "newpassword",
    });
    expect(confirm.status).toBe(200);

    expect(
      (await post("/auth/login", { email: "r@x.com", password: "newpassword" })).status,
    ).toBe(200);
    expect(
      (await post("/auth/login", { email: "r@x.com", password: "oldpassword" })).status,
    ).toBe(401);
  });

  it("hides unknown emails (202, no token)", async () => {
    const res = await post("/auth/password-reset/request", { email: "nobody@x.com" });
    expect(res.status).toBe(202);
    expect((await res.json()) as { token?: string }).not.toHaveProperty("token");
  });
});

describe("activation flow", () => {
  it("activates a pending account", async () => {
    await post("/auth/signup", { email: "a@x.com", password: "password12" });
    const user = await store.findByEmail("a@x.com");
    if (user) user.isActive = false;

    const activation = new ActivationService({ store });
    const token = await activation.start(user!.id);

    const res = await post("/auth/activate", { token });
    expect(res.status).toBe(200);
    expect((await store.findById(user!.id))?.isActive).toBe(true);
  });
});

describe("mfa flow", () => {
  it("enrolls (guarded) and rejects a bad confirm code", async () => {
    const signup = await post("/auth/signup", {
      email: "m@x.com",
      password: "password12",
    });
    const { tokens } = (await signup.json()) as { tokens: { accessToken: string } };

    const enroll = await post("/auth/mfa/enroll", {}, tokens.accessToken);
    expect(enroll.status).toBe(200);
    const body = (await enroll.json()) as { secret: string; otpauthUri: string };
    expect(body.secret).toBeTruthy();
    expect(body.otpauthUri.startsWith("otpauth://totp/")).toBe(true);

    expect(
      (await post("/auth/mfa/confirm", { code: "000000" }, tokens.accessToken)).status,
    ).toBe(422);
    expect((await post("/auth/mfa/enroll", {})).status).toBe(401); // no token
  });
});
