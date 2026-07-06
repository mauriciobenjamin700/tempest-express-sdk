import { createHmac } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  GitHubOAuthClient,
  GoogleOAuthClient,
  OIDCProvider,
  WebhookSignatureVerifier,
  generateOAuthState,
  makeToolSpecRouter,
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

describe("OAuth clients", () => {
  it("generates a random state", () => {
    const a = generateOAuthState();
    const b = generateOAuthState();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(20);
  });

  it("builds a Google authorize URL with scopes and state", () => {
    const client = new GoogleOAuthClient({
      clientId: "cid",
      clientSecret: "secret",
      redirectUri: "https://app/callback",
    });
    const url = new URL(client.buildAuthorizeUrl("xyz", { access_type: "offline" }));
    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app/callback");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("state")).toBe("xyz");
    expect(url.searchParams.get("access_type")).toBe("offline");
  });

  it("uses provider-specific defaults", () => {
    const gh = new GitHubOAuthClient({
      clientId: "c",
      clientSecret: "s",
      redirectUri: "u",
    });
    expect(gh.providerName).toBe("github");
    expect(gh.buildAuthorizeUrl("s")).toContain("github.com/login/oauth/authorize");

    const oidc = new OIDCProvider({
      clientId: "c",
      clientSecret: "s",
      redirectUri: "u",
      authorizeUrl: "https://idp/auth",
      tokenUrl: "https://idp/token",
      providerName: "oidc:auth0",
    });
    expect(oidc.providerName).toBe("oidc:auth0");
    expect(oidc.buildAuthorizeUrl("s")).toContain("https://idp/auth?");
  });
});

describe("WebhookSignatureVerifier", () => {
  const secret = "whsec";
  const body = Buffer.from(JSON.stringify({ event: "ping" }));
  const sign = (enc: "hex" | "base64") =>
    createHmac("sha256", secret).update(body).digest(enc);

  it("verifies a matching hex signature and rejects a bad one", () => {
    const v = new WebhookSignatureVerifier(secret);
    expect(v.verify(body, sign("hex"))).toBe(true);
    expect(v.verify(body, "deadbeef")).toBe(false);
  });

  it("supports base64 and a prefix", () => {
    const v = new WebhookSignatureVerifier(secret, {
      encoding: "base64",
      prefix: "sha256=",
    });
    expect(v.verify(body, `sha256=${sign("base64")}`)).toBe(true);
  });

  it("guards a route via middleware over the raw body", async () => {
    const v = new WebhookSignatureVerifier(secret);
    const app = express();
    app.post("/hook", express.raw({ type: () => true }), v.middleware(), (_req, res) =>
      res.json({ ok: true }),
    );
    const base = await boot(app);

    const good = await fetch(`${base}/hook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": sign("hex") },
      body,
    });
    expect(good.status).toBe(200);

    const bad = await fetch(`${base}/hook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": "nope" },
      body,
    });
    expect(bad.status).toBe(401);
  });
});

describe("makeToolSpecRouter", () => {
  it("serves a static manifest at /tool-spec", async () => {
    const app = express();
    app.use(makeToolSpecRouter({ name: "svc", version: "1.0.0" }));
    const base = await boot(app);
    const res = await fetch(`${base}/tool-spec`);
    expect(await res.json()).toEqual({ name: "svc", version: "1.0.0" });
  });

  it("serves an async provider at a custom path", async () => {
    const app = express();
    app.use(makeToolSpecRouter(async () => ({ tools: ["a"] }), { path: "/spec" }));
    const base = await boot(app);
    const res = await fetch(`${base}/spec`);
    expect(await res.json()).toEqual({ tools: ["a"] });
  });
});
