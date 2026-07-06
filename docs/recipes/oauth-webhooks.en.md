# OAuth, webhooks and meta endpoints

Three pieces for talking to the outside world, a faithful port of `api.oauth` /
`api.webhooks` / `api.routers.tool_spec` from `tempest-fastapi-sdk`.

---

## 1. Social login (OAuth2 / OIDC)

Ready-made clients for **Google**, **GitHub** and a generic **OIDC** provider
(Auth0, Keycloak, Okta, Entra, Cognito). They cover only the OAuth2 dance — build
the authorize URL, exchange the code for tokens, fetch the user. Storing the
user, minting your own session token and setting a cookie are your calls.

```ts
import { GoogleOAuthClient, generateOAuthState } from "tempest-express-sdk";

const google = new GoogleOAuthClient({
  clientId: process.env.GOOGLE_CLIENT_ID ?? "",
  clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  redirectUri: "https://app.com/auth/google/callback",
});

// 1. redirect to consent (store the state in the session!)
app.get("/auth/google", (req, res) => {
  const state = generateOAuthState();
  req.session.oauthState = state; // your session store
  res.redirect(google.buildAuthorizeUrl(state, { access_type: "offline" }));
});

// 2. callback: validate state, exchange code, fetch user
app.get("/auth/google/callback", async (req, res) => {
  if (req.query.state !== req.session.oauthState) {
    res.status(400).json({ detail: "Invalid state", code: "BAD_STATE", details: {} });
    return;
  }
  const tokens = await google.exchangeCode(String(req.query.code));
  const user = await google.fetchUser(tokens);
  // user: { provider, subject, email, name, picture, raw }
  // → store/link the user and mint YOUR session token here
  res.json({ email: user.email });
});
```

!!! tip "GitHub and generic OIDC"
    `GitHubOAuthClient` has the same API (identity via `GET /user`, no
    `id_token`). For any conformant IdP, use `OIDCProvider` passing the
    endpoints (read them once at boot from the discovery document
    `${issuer}/.well-known/openid-configuration`):

    ```ts
    const oidc = new OIDCProvider({
      clientId, clientSecret, redirectUri,
      authorizeUrl: "https://idp/authorize",
      tokenUrl: "https://idp/oauth/token",
      userinfoUrl: "https://idp/userinfo",
      providerName: "oidc:auth0",
    });
    ```

!!! warning "Always validate `state`"
    Generate with `generateOAuthState()`, store it before redirecting and
    compare on callback. A mismatch is a forged redirect → reject with 400.

---

## 2. Verify a webhook signature

Providers sign the body with `hmac(secret, body)` and send the digest in a
header. `WebhookSignatureVerifier` checks it in constant time.

```ts
import { WebhookSignatureVerifier } from "tempest-express-sdk";
import express from "express";

const verifier = new WebhookSignatureVerifier(process.env.WEBHOOK_SECRET ?? "", {
  algorithm: "sha256",
  headerName: "X-Signature",
  encoding: "hex",
  // prefix: "sha256=", // if the provider prefixes the digest
});

// the RAW body (Buffer) is required — mount express.raw BEFORE the verifier
app.post(
  "/webhooks/stripe",
  express.raw({ type: () => true }),
  verifier.middleware(),
  (req, res) => {
    const event = JSON.parse(req.body.toString()); // req.body is the raw Buffer
    // ... process the verified event
    res.json({ received: true });
  },
);
```

Without the middleware, verify manually: `verifier.verify(bodyBuffer,
signature)` (or `verifier.expected(body)` to compute the expected digest).

---

## 3. Capability manifest (`/tool-spec`)

A root-prefix endpoint (next to `/health`) exposing a machine-readable manifest,
without forcing the caller to parse the full OpenAPI document.

```ts
import { makeToolSpecRouter } from "tempest-express-sdk";

// static
app.use(makeToolSpecRouter({ name: "billing", version: "1.0.0", tools: ["charge"] }));

// or dynamic (recomputed per request; sync or async)
app.use(makeToolSpecRouter(async () => ({ name: "billing", uptime: process.uptime() })));
```

`GET /tool-spec` returns the object. Custom path: `makeToolSpecRouter(spec, {
path: "/manifest" })`.

---

## Recap

- `GoogleOAuthClient` / `GitHubOAuthClient` / `OIDCProvider` — the OAuth2 dance;
  you own session and persistence. Always validate `state`.
- `WebhookSignatureVerifier` — constant-time HMAC over the raw body.
- `makeToolSpecRouter` — a root-prefix manifest. ✅
