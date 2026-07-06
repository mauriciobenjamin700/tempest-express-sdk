# OAuth, webhooks e meta endpoints

Três peças de integração com o mundo externo, porte fiel de `api.oauth` /
`api.webhooks` / `api.routers.tool_spec` do `tempest-fastapi-sdk`.

---

## 1. Login social (OAuth2 / OIDC)

Clientes prontos para **Google**, **GitHub** e um **OIDC genérico** (Auth0,
Keycloak, Okta, Entra, Cognito). Eles cobrem só a dança OAuth2 — montar a URL de
autorização, trocar o code por tokens, buscar o usuário. Guardar o usuário,
emitir seu próprio token de sessão e setar cookie são decisões suas.

```ts
import { GoogleOAuthClient, generateOAuthState } from "tempest-express-sdk";

const google = new GoogleOAuthClient({
  clientId: process.env.GOOGLE_CLIENT_ID ?? "",
  clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  redirectUri: "https://app.com/auth/google/callback",
});

// 1. redirecionar para o consentimento (guarde o state na sessão!)
app.get("/auth/google", (req, res) => {
  const state = generateOAuthState();
  req.session.oauthState = state; // seu store de sessão
  res.redirect(google.buildAuthorizeUrl(state, { access_type: "offline" }));
});

// 2. callback: valide o state, troque o code, busque o usuário
app.get("/auth/google/callback", async (req, res) => {
  if (req.query.state !== req.session.oauthState) {
    res.status(400).json({ detail: "State inválido", code: "BAD_STATE", details: {} });
    return;
  }
  const tokens = await google.exchangeCode(String(req.query.code));
  const user = await google.fetchUser(tokens);
  // user: { provider, subject, email, name, picture, raw }
  // → grave/associe o usuário e emita SEU token de sessão aqui
  res.json({ email: user.email });
});
```

!!! tip "GitHub e OIDC genérico"
    `GitHubOAuthClient` tem a mesma API (identidade via `GET /user`, sem
    `id_token`). Para qualquer IdP conformante, use `OIDCProvider` passando os
    endpoints (leia-os uma vez no boot do documento de discovery
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

!!! warning "Sempre valide o `state`"
    Gere com `generateOAuthState()`, guarde antes do redirect e compare no
    callback. Divergência = redirect forjado → rejeite com 400.

---

## 2. Verificar assinatura de webhook

Provedores assinam o corpo com `hmac(secret, body)` e mandam o digest num header.
`WebhookSignatureVerifier` confere em tempo constante.

```ts
import { WebhookSignatureVerifier } from "tempest-express-sdk";
import express from "express";

const verifier = new WebhookSignatureVerifier(process.env.WEBHOOK_SECRET ?? "", {
  algorithm: "sha256",
  headerName: "X-Signature",
  encoding: "hex",
  // prefix: "sha256=", // se o provedor prefixa o digest
});

// o corpo CRU (Buffer) é necessário — monte express.raw ANTES do verifier
app.post(
  "/webhooks/stripe",
  express.raw({ type: () => true }),
  verifier.middleware(),
  (req, res) => {
    const event = JSON.parse(req.body.toString()); // req.body é o Buffer cru
    // ... processe o evento verificado
    res.json({ received: true });
  },
);
```

Sem o middleware, você pode verificar manualmente: `verifier.verify(bodyBuffer,
signature)` (ou `verifier.expected(body)` para computar o digest esperado).

---

## 3. Manifesto de capacidades (`/tool-spec`)

Um endpoint no prefixo raiz (ao lado de `/health`) que expõe um manifesto
legível por máquina, sem obrigar o cliente a parsear o OpenAPI inteiro.

```ts
import { makeToolSpecRouter } from "tempest-express-sdk";

// estático
app.use(makeToolSpecRouter({ name: "billing", version: "1.0.0", tools: ["charge"] }));

// ou dinâmico (recomputado por request; sync ou async)
app.use(makeToolSpecRouter(async () => ({ name: "billing", uptime: process.uptime() })));
```

`GET /tool-spec` devolve o objeto. Path custom: `makeToolSpecRouter(spec, { path:
"/manifest" })`.

---

## Recapitulando

- `GoogleOAuthClient` / `GitHubOAuthClient` / `OIDCProvider` — a dança OAuth2;
  você decide sessão e persistência. Valide sempre o `state`.
- `WebhookSignatureVerifier` — HMAC em tempo constante sobre o corpo cru.
- `makeToolSpecRouter` — manifesto no prefixo raiz. ✅
