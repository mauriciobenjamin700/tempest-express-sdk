# Installation

## Requirements

- **Node.js >= 20**
- **TypeScript >= 5.7** (recommended)
- **zod >= 4** — a required peer dependency (see below)

## Install

```bash
npm install tempest-express-sdk tempest-db-js express zod@^4
```

!!! warning "`zod` must be **your** zod, on version 4"
    Since v0.21.0 `zod` is a peer dependency (`^4.0.0`), not a dependency of the
    SDK — so there is **exactly one instance**, shared by you and by it. That is
    what makes `.openapi()` and `instanceof ZodType` work across the package
    boundary. Check with `npm ls zod`: a single line, marked `deduped`.

    Coming from 0.20.x on zod 3? Read
    [Migrating to zod 4](migration/zod-4.md).

!!! info "Peer dependencies"
    `tempest-db-js` is a **required** peer dependency (the database layer).
    For authentication, also install the **optional** peers:

    ```bash
    npm install bcryptjs jsonwebtoken
    ```

    Without them the SDK still imports fine — the error only surfaces when you
    instantiate `PasswordUtils` / `JWTUtils`.

## Start a project from scratch

The CLI scaffolds a complete, layered Express service with Swagger + Redoc:

```bash
npx tempest-express new my-service
cd my-service
npm install
cp .env.example .env
npm run dev
```

## CLI commands

| Command | What it does |
| --- | --- |
| `tempest-express new <name>` | Create a complete service |
| `tempest-express generate <Name>` | Scaffold a CRUD resource (model→router) |
| `tempest-express secret [--bytes 32]` | Generate a random secret (JWT/token) |
| `tempest-express docker-compose` | Write a `docker-compose.yml` (Postgres + Redis) |
| `tempest-express db` | Migration guidance (via `tempest-db-js`) |
| `tempest-express lint [--dir .]` | Run the Biome check in a project |
| `tempest-express config [--dir .]` | Print the resolved base settings (reads `.env`) |
| `tempest-express user --email <e> --password <p> [--admin]` | Print a ready-to-insert user record (bcrypt hash) |

## Recommended tsconfig

The SDK and template use an `@` alias pointing at `src`, with **no** `.js`
suffix:

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "paths": { "@/*": ["./src/*"] }
  }
}
```
