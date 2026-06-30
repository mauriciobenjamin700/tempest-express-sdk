# Autenticação (JWT)

O módulo `auth` traz signup/login/refresh, middleware de JWT e guardas de role —
desacoplado do ORM via uma interface `UserStore`.

!!! info "Peers opcionais"
    Instale `bcryptjs` e `jsonwebtoken`:
    ```bash
    npm install bcryptjs jsonwebtoken
    ```

## Montando o router de auth

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

// 1. Implemente o UserStore sobre o seu banco (aqui, em memória).
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

// 2. Componha o serviço.
const jwt = new JWTUtils(process.env.JWT_SECRET ?? "dev-secret");
const service = new UserAuthService({
  store: new MemoryStore(),
  password: new PasswordUtils(),
  jwt,
  passwordMinLength: 12,
});

// 3. Monte o router.
const registry = createOpenApiRegistry();
const app = await createApp({
  openapi: { registry, info: { title: "Auth", version: "1.0.0" } },
  configure: (a) => {
    a.use(makeAuthRouter({ service, jwt, registry }));
  },
});

await runServer(app, { port: 8000 });
```

Endpoints expostos: `POST /auth/signup`, `POST /auth/login`,
`POST /auth/refresh` e `GET /auth/me` (protegido).

## Protegendo rotas

```ts
import { makeJwtAuthMiddleware, requireRoles } from "tempest-express-sdk";

const auth = makeJwtAuthMiddleware(jwt);

app.get("/api/admin", auth, requireRoles("admin"), (req, res) => {
  res.json({ you: req.auth });
});
```

- `makeJwtAuthMiddleware(jwt)` decodifica o `Bearer` e popula `req.auth`.
- `requireRoles("admin")` exige a role; senão → **403**.
- Token ausente/ inválido → **401** no envelope padrão.

!!! tip "Soft auth"
    Use `makeJwtAuthMiddleware(jwt, { required: false })` para popular `req.auth`
    quando houver token, sem rejeitar anônimos.

## Recapitulando

`UserStore` desacopla a auth do banco; `UserAuthService` cuida de hashing e
tokens; o middleware protege rotas por role. Tudo aparece no Swagger/Redoc.
