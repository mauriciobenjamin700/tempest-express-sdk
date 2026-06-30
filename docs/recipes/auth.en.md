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

## Recap

`UserStore` decouples auth from your database; `UserAuthService` handles hashing
and tokens; the middleware guards routes by role. Everything shows up in
Swagger/Redoc.
