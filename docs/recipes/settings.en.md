# Configuration (typed settings)

Every service reads configuration from environment variables. Instead of
scattering `process.env.X ?? "default"` across the code, the SDK offers
**composable settings fragments** — objects of Zod fields, one per domain (JWT,
email, Redis…) — that you combine into your service schema and validate in one
shot with `loadSettings`.

It's the faithful port of the `tempest-fastapi-sdk` *settings mixins*: the
**same environment variable names** and the **same defaults**.

!!! info "Where `z` comes from"
    `z` is Zod already carrying `.openapi()`, re-exported by the SDK. Import
    everything from `tempest-express-sdk`.

---

## 1. The basics: base + `loadSettings`

`baseAppSettingsShape` already ships server + database + CORS. `loadSettings`
parses `process.env`, applies the defaults and **freezes** the result:

```ts
import { baseAppSettingsShape, loadSettings, z } from "tempest-express-sdk";

export const settings = loadSettings(z.object(baseAppSettingsShape));

settings.HOST;         // "127.0.0.1"
settings.PORT;         // 8000
settings.DATABASE_URL; // "sqlite://./app.db"
settings.CORS_ORIGINS; // string[] (CSV → list)
```

A missing value falls back to the default; a malformed value (non-numeric port,
invalid enum) throws `ZodError` at boot — fail early, not in production. ✅

---

## 2. Composing domain fragments

Every dependency has a fragment. Spread (`...`) the ones the service uses inside
a single `z.object`:

```ts
import {
  baseAppSettingsShape,
  jwtSettingsShape,
  redisSettingsShape,
  emailSettingsShape,
  loadSettings,
  z,
} from "tempest-express-sdk";

export const settings = loadSettings(
  z.object({
    ...baseAppSettingsShape,
    ...jwtSettingsShape,
    ...redisSettingsShape,
    ...emailSettingsShape,
    // + your own service fields:
    STRIPE_API_KEY: z.string(),
  }),
);

settings.JWT_SECRET;  // string
settings.REDIS_URL;   // string
settings.SMTP_HOST;   // string
settings.STRIPE_API_KEY;
```

The available fragments:

| Fragment | Variables (prefix) | For |
| --- | --- | --- |
| `serverSettingsShape` | `HOST`, `PORT`, `DEBUG` | Server bind. |
| `databaseSettingsShape` | `DATABASE_URL` | Database connection. |
| `corsSettingsShape` | `CORS_ORIGINS` (CSV) | CORS. |
| `logSettingsShape` | `LOG_LEVEL`, `LOG_JSON`, `LOG_DIR` | Structured logging. |
| `jwtSettingsShape` | `JWT_*` | JWT signing/verification. |
| `tokenSettingsShape` | `TOKEN_SECRET` | Shared-secret guards (`X-Token`). |
| `authSettingsShape` | `AUTH_*` | Signup/activation/reset/MFA flows + token delivery. |
| `emailSettingsShape` | `SMTP_*` | SMTP transport. |
| `redisSettingsShape` | `REDIS_URL` | Cache / sessions / SSE broker. |
| `rabbitmqSettingsShape` | `RABBITMQ_*` | Queue broker. |
| `sessionSettingsShape` | `SESSION_*` | Server-side sessions (cookie + TTL). |
| `uploadSettingsShape` | `UPLOAD_*` | Local upload storage. |
| `minioSettingsShape` | `MINIO_*` | MinIO/S3 object storage. |
| `webPushSettingsShape` | `VAPID_*`, `WEBPUSH_*` | Web Push. |
| `webSocketSettingsShape` | `WS_*` | WebSocket hub tuning. |

`baseAppSettingsShape` is already `serverSettingsShape` +
`databaseSettingsShape` + `corsSettingsShape` combined.

!!! tip "Fragments are pure objects"
    Each `*Shape` is just an object of Zod fields (`as const`) — nothing reads
    the environment on its own. `loadSettings` reads `process.env`. That keeps
    the fragments testable: `z.object(jwtSettingsShape).parse({ JWT_SECRET: "..." })`.

---

## 3. Booleans and lists from the environment

An environment variable is always a **string**. Two gotchas the SDK handles:

### `envBoolean` — `"false"` is `false`

Zod's `z.coerce.boolean()` treats **any** non-empty string as `true` — so
`"false"` would become `true`. The fragments' boolean fields use `envBoolean`,
which reads the usual tokens (`true`/`1`/`yes`/`on`) and treats the rest as
`false`:

```ts
import { envBoolean, z } from "tempest-express-sdk";

const schema = z.object({ FEATURE_X: envBoolean(false) });

schema.parse({ FEATURE_X: "false" }).FEATURE_X; // false ✅
schema.parse({ FEATURE_X: "1" }).FEATURE_X;     // true
schema.parse({}).FEATURE_X;                      // false (default)
```

### `envList` — CSV becomes `string[]`

```ts
import { envList, z } from "tempest-express-sdk";

const schema = z.object({ TAGS: envList("a,b") });
schema.parse({ TAGS: "x, y ,, z" }).TAGS; // ["x", "y", "z"]
schema.parse({}).TAGS;                     // ["a", "b"]
```

Same mechanism as `CORS_ORIGINS` and the `UPLOAD_ALLOWED_*` fields.

---

## 4. A complete service

Inject the `settings` object wherever you need it — it's immutable, so it can be
a module singleton:

```ts
// src/core/settings.ts
import {
  baseAppSettingsShape,
  jwtSettingsShape,
  loadSettings,
  sessionSettingsShape,
  z,
} from "tempest-express-sdk";

export const settings = loadSettings(
  z.object({
    ...baseAppSettingsShape,
    ...jwtSettingsShape,
    ...sessionSettingsShape,
  }),
);

export type Settings = typeof settings;
```

```ts
// anywhere
import { JWTUtils } from "tempest-express-sdk";
import { settings } from "@/core/settings";

const jwt = new JWTUtils(settings.JWT_SECRET, {
  defaultTtlSeconds: settings.JWT_ACCESS_TTL_SECONDS,
  algorithm: settings.JWT_ALGORITHM as "HS256",
});
```

!!! warning "Change the default secrets"
    `JWT_SECRET` and the VAPID keys ship with placeholders just so the app boots
    in dev. In production, set them via the environment — never commit real
    secrets.

---

## Recap

- `baseAppSettingsShape` + `loadSettings(z.object(...))` = validated,
  frozen configuration at boot.
- Compose domain fragments with `...spread`; each uses the `tempest-fastapi-sdk`
  env names and defaults.
- `envBoolean` fixes boolean parsing; `envList` turns CSV into a list.
- An invalid value fails **at boot**, not in production. 🚀
