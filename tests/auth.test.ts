import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  type AuthUser,
  JWTUtils,
  PasswordUtils,
  UserAuthService,
  type UserStore,
  createApp,
  createOpenApiRegistry,
  makeAuthRouter,
  runServer,
} from "@/index";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** Trivial in-memory user store for the test. */
class MemoryStore implements UserStore {
  private byId = new Map<string, AuthUser>();
  private seq = 0;

  async findByEmail(email: string): Promise<AuthUser | null> {
    return [...this.byId.values()].find((u) => u.email === email) ?? null;
  }
  async findById(id: string): Promise<AuthUser | null> {
    return this.byId.get(id) ?? null;
  }
  async create(data: {
    email: string;
    passwordHash: string;
    name: string | null;
  }): Promise<AuthUser> {
    this.seq += 1;
    const user: AuthUser = {
      id: `user-${this.seq}`,
      email: data.email,
      passwordHash: data.passwordHash,
      name: data.name,
      isActive: true,
      roles: ["user"],
    };
    this.byId.set(user.id, user);
    return user;
  }
}

let server: Server;
let base: string;

beforeAll(async () => {
  const jwt = new JWTUtils("test-secret");
  const service = new UserAuthService({
    store: new MemoryStore(),
    password: new PasswordUtils(4),
    jwt,
    passwordMinLength: 8,
  });
  const registry = createOpenApiRegistry();
  const app = await createApp({
    openapi: { registry, info: { title: "Auth", version: "1.0.0" } },
    configure: (a) => {
      a.use(makeAuthRouter({ service, jwt, registry }));
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

describe("auth flows", () => {
  it("signs up, logs in, refreshes and reads /auth/me", async () => {
    const signup = await post("/auth/signup", {
      email: "Ana@Example.com",
      password: "supersecret",
      name: "Ana",
    });
    expect(signup.status).toBe(201);
    const created = (await signup.json()) as {
      user: { email: string; roles: string[] };
      tokens: { accessToken: string; refreshToken: string };
    };
    expect(created.user.email).toBe("ana@example.com");
    expect(created.user.roles).toEqual(["user"]);

    const login = await post("/auth/login", {
      email: "ana@example.com",
      password: "supersecret",
    });
    expect(login.status).toBe(200);
    const loggedIn = (await login.json()) as {
      tokens: { accessToken: string; refreshToken: string };
    };

    const me = await fetch(`${base}/auth/me`, {
      headers: { authorization: `Bearer ${loggedIn.tokens.accessToken}` },
    });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { sub: string }).sub).toBe("user-1");

    const refreshed = await post("/auth/refresh", {
      refreshToken: loggedIn.tokens.refreshToken,
    });
    expect(refreshed.status).toBe(200);
  });

  it("rejects bad credentials and short passwords", async () => {
    const short = await post("/auth/signup", { email: "x@y.com", password: "abc" });
    expect(short.status).toBe(422);

    const bad = await post("/auth/login", {
      email: "ana@example.com",
      password: "wrong",
    });
    expect(bad.status).toBe(401);

    const noAuth = await fetch(`${base}/auth/me`);
    expect(noAuth.status).toBe(401);
  });
});
