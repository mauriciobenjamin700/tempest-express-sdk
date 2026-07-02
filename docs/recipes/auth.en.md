# Authentication (JWT)

The `auth` module ships signup/login/refresh, JWT middleware and role guards —
decoupled from the ORM via a `UserStore` interface.

!!! info "Optional peers"
    Install `bcryptjs` and `jsonwebtoken`:
    ```bash
    npm install bcryptjs jsonwebtoken
    ```

## Mounting the auth router

```ts
import {
  JWTUtils,
  PasswordUtils,
  UserAuthService,
  type AuthUser,
  type UserStore,
  createApp,
  createOpenApiRegistry,
  makeAuthRouter,
  runServer,
} from "tempest-express-sdk";

// 1. Implement UserStore over your database (here, in memory).
class MemoryStore implements UserStore {
  private users = new Map<string, AuthUser>();
  private seq = 0;
  async findByEmail(email: string) {
    return [...this.users.values()].find((u) => u.email === email) ?? null;
  }
  async findById(id: string) {
    return this.users.get(id) ?? null;
  }
  async create(data: { email: string; passwordHash: string; name: string | null }) {
    this.seq += 1;
    const user: AuthUser = {
      id: `user-${this.seq}`,
      ...data,
      isActive: true,
      roles: ["user"],
    };
    this.users.set(user.id, user);
    return user;
  }
}

// 2. Compose the service.
const jwt = new JWTUtils(process.env.JWT_SECRET ?? "dev-secret");
const service = new UserAuthService({
  store: new MemoryStore(),
  password: new PasswordUtils(),
  jwt,
  passwordMinLength: 12,
});

// 3. Mount the router.
const registry = createOpenApiRegistry();
const app = await createApp({
  openapi: { registry, info: { title: "Auth", version: "1.0.0" } },
  configure: (a) => {
    a.use(makeAuthRouter({ service, jwt, registry }));
  },
});

await runServer(app, { port: 8000 });
```

Exposed endpoints: `POST /auth/signup`, `POST /auth/login`,
`POST /auth/refresh` and `GET /auth/me` (protected).

## Protecting routes

```ts
import { makeJwtAuthMiddleware, requireRoles } from "tempest-express-sdk";

const auth = makeJwtAuthMiddleware(jwt);

app.get("/api/admin", auth, requireRoles("admin"), (req, res) => {
  res.json({ you: req.auth });
});
```

- `makeJwtAuthMiddleware(jwt)` decodes the `Bearer` token and populates `req.auth`.
- `requireRoles("admin")` requires the role; otherwise → **403**.
- Missing/invalid token → **401** in the canonical envelope.

!!! tip "Soft auth"
    Use `makeJwtAuthMiddleware(jwt, { required: false })` to populate `req.auth`
    when a token is present, without rejecting anonymous callers.

## Flows: MFA, activation and password reset

Pass optional services to `makeAuthRouter` to mount the flows. Each uses a
**dedicated store** (implement only the ones you use).

```ts
import {
  ActivationService,
  MfaService,
  PasswordResetService,
  TOTPHelper,
  makeAuthRouter,
} from "tempest-express-sdk";

a.use(
  makeAuthRouter({
    service,
    jwt,
    activation: new ActivationService({ store }),               // POST /auth/activate
    passwordReset: new PasswordResetService({ store, password }), // /auth/password-reset/*
    mfa: new MfaService({ store, totp: new TOTPHelper({ issuer: "My App" }) }),
  }),
);
```

Mounted routes:

| Route | Description |
|---|---|
| `POST /auth/activate` | `{ token }` → activate the account |
| `POST /auth/password-reset/request` | `{ email }` → always **202** (no enumeration) |
| `POST /auth/password-reset/confirm` | `{ token, password }` → set the new password |
| `POST /auth/mfa/enroll` | guarded (JWT) → `{ secret, otpauthUri }` (QR) |
| `POST /auth/mfa/confirm` | `{ code }` → enable MFA |
| `POST /auth/mfa/disable` | `{ code }` → disable MFA |

- **Opaque tokens**: activation/reset store only the **SHA-256 hash**; the
  plaintext travels in the emailed link. Invalid/expired token → **401**.
- **MFA**: native `TOTPHelper` (RFC 6238). `enroll` generates the secret + QR
  URI; `confirm` verifies a code and turns MFA on; a wrong code → **422**.
- **Anti-enumeration**: `password-reset/request` always returns 202; the `token`
  is echoed only in dev setups (in production the service emails it).

## Recap

`UserStore` decouples auth from your database; `UserAuthService` handles hashing
and tokens; the middleware guards routes by role; the MFA/activation/reset
services mount the full flows over dedicated stores. Everything shows up in
Swagger/Redoc.
