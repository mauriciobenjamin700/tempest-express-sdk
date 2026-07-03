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

## Fluxos: MFA, ativação e reset de senha

Passe serviços opcionais ao `makeAuthRouter` para montar os fluxos. Cada um usa
um **store dedicado** (implemente só os que usar).

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
    mfa: new MfaService({ store, totp: new TOTPHelper({ issuer: "Minha App" }) }),
  }),
);
```

Rotas montadas:

| Rota | Descrição |
|---|---|
| `POST /auth/activate` | `{ token }` → ativa a conta |
| `POST /auth/password-reset/request` | `{ email }` → **202** sempre (não vaza existência) |
| `POST /auth/password-reset/confirm` | `{ token, password }` → redefine a senha |
| `POST /auth/mfa/enroll` | guardada (JWT) → `{ secret, otpauthUri }` (QR) |
| `POST /auth/mfa/confirm` | `{ code }` → ativa o MFA |
| `POST /auth/mfa/disable` | `{ code }` → desativa o MFA |

- **Tokens opacos**: ativação/reset guardam só o **hash SHA-256**; o plaintext
  vai no link por email. Token inválido/expirado → **401**.
- **MFA**: `TOTPHelper` nativo (RFC 6238). `enroll` gera o segredo e a URI de QR;
  `confirm` verifica um código e liga o MFA; código errado → **422**.
- **MFA no login (challenge)**: passe `mfa` também ao `UserAuthService`. Para
  usuários com MFA ligado, `POST /auth/login` responde
  `{ mfaRequired: true, mfaToken }` (sem tokens); o cliente conclui com
  `POST /auth/mfa/challenge { mfaToken, code }` → tokens. Código/token
  inválido → **401**. Sem MFA ligado, o login devolve os tokens direto.
- **Anti-enumeração**: `password-reset/request` sempre responde 202; o `token` só
  volta no corpo em setup dev (em produção, o serviço envia por email).

## Recapitulando

`UserStore` desacopla a auth do banco; `UserAuthService` cuida de hashing e
tokens; o middleware protege rotas por role; os serviços de MFA/ativação/reset
montam os fluxos completos sobre stores dedicados. Tudo aparece no Swagger/Redoc.
