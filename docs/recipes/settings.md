# Configuração (settings tipados)

Toda service lê configuração de variáveis de ambiente. Em vez de espalhar
`process.env.X ?? "default"` pelo código, o SDK oferece **fragmentos de settings
compostos** — objetos de campos Zod, um por domínio (JWT, e-mail, Redis…) — que
você combina no schema da sua service e valida de uma vez com `loadSettings`.

É o porte fiel dos *settings mixins* do `tempest-fastapi-sdk`: os **mesmos nomes
de variável de ambiente** e os **mesmos defaults**.

!!! info "Onde o `z` vem"
    `z` é o Zod já com `.openapi()`, re-exportado pelo SDK. Importe tudo de
    `tempest-express-sdk`.

---

## 1. O básico: base + `loadSettings`

`baseAppSettingsShape` já traz servidor + banco + CORS. `loadSettings` faz o
parse de `process.env`, aplica os defaults e **congela** o resultado:

```ts
import { baseAppSettingsShape, loadSettings, z } from "tempest-express-sdk";

export const settings = loadSettings(z.object(baseAppSettingsShape));

settings.HOST;         // "127.0.0.1"
settings.PORT;         // 8000
settings.DATABASE_URL; // "sqlite://./app.db"
settings.CORS_ORIGINS; // string[] (CSV → lista)
```

Um valor ausente cai no default; um valor malformado (porta não-numérica, enum
inválido) lança `ZodError` no boot — falha cedo, não em produção. ✅

---

## 2. Compondo fragmentos por domínio

Cada dependência tem um fragmento. Espalhe (`...`) os que a service usa dentro de
um único `z.object`:

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
    // + campos próprios da service:
    STRIPE_API_KEY: z.string(),
  }),
);

settings.JWT_SECRET;  // string
settings.REDIS_URL;   // string
settings.SMTP_HOST;   // string
settings.STRIPE_API_KEY;
```

Os fragmentos disponíveis:

| Fragmento | Variáveis (prefixo) | Para |
| --- | --- | --- |
| `serverSettingsShape` | `HOST`, `PORT`, `DEBUG` | Bind do servidor. |
| `databaseSettingsShape` | `DATABASE_URL` | Conexão do banco. |
| `corsSettingsShape` | `CORS_ORIGINS` (CSV) | CORS. |
| `logSettingsShape` | `LOG_LEVEL`, `LOG_JSON`, `LOG_DIR` | Logging estruturado. |
| `jwtSettingsShape` | `JWT_*` | Assinatura/verificação de JWT. |
| `tokenSettingsShape` | `TOKEN_SECRET` | Guardas de segredo compartilhado (`X-Token`). |
| `authSettingsShape` | `AUTH_*` | Fluxos de signup/ativação/reset/MFA + entrega de token. |
| `emailSettingsShape` | `SMTP_*` | Transporte SMTP. |
| `redisSettingsShape` | `REDIS_URL` | Cache / sessões / SSE broker. |
| `rabbitmqSettingsShape` | `RABBITMQ_*` | Broker de fila. |
| `sessionSettingsShape` | `SESSION_*` | Sessões server-side (cookie + TTL). |
| `uploadSettingsShape` | `UPLOAD_*` | Storage local de uploads. |
| `minioSettingsShape` | `MINIO_*` | Object storage MinIO/S3. |
| `webPushSettingsShape` | `VAPID_*`, `WEBPUSH_*` | Web Push. |
| `webSocketSettingsShape` | `WS_*` | Tuning do hub WebSocket. |

`baseAppSettingsShape` já é `serverSettingsShape` + `databaseSettingsShape` +
`corsSettingsShape` combinados.

!!! tip "Os fragmentos são objetos puros"
    Cada `*Shape` é só um objeto de campos Zod (`as const`) — nada lê o ambiente
    sozinho. Quem lê `process.env` é o `loadSettings`. Isso mantém os fragmentos
    testáveis: `z.object(jwtSettingsShape).parse({ JWT_SECRET: "..." })`.

---

## 3. Booleans e listas do ambiente

Variável de ambiente é sempre **string**. Dois cuidados que o SDK já resolve:

### `envBoolean` — `"false"` é `false`

`z.coerce.boolean()` do Zod trata **qualquer** string não-vazia como `true` — ou
seja, `"false"` viraria `true`. Os campos booleanos dos fragmentos usam
`envBoolean`, que lê os tokens usuais (`true`/`1`/`yes`/`on`) e trata o resto
como `false`:

```ts
import { envBoolean, z } from "tempest-express-sdk";

const schema = z.object({ FEATURE_X: envBoolean(false) });

schema.parse({ FEATURE_X: "false" }).FEATURE_X; // false ✅
schema.parse({ FEATURE_X: "1" }).FEATURE_X;     // true
schema.parse({}).FEATURE_X;                      // false (default)
```

### `envList` — CSV vira `string[]`

```ts
import { envList, z } from "tempest-express-sdk";

const schema = z.object({ TAGS: envList("a,b") });
schema.parse({ TAGS: "x, y ,, z" }).TAGS; // ["x", "y", "z"]
schema.parse({}).TAGS;                     // ["a", "b"]
```

É o mesmo mecanismo do `CORS_ORIGINS` e dos `UPLOAD_ALLOWED_*`.

---

## 4. Uma service completa

Injete o objeto `settings` onde precisar — ele é imutável, então pode virar um
singleton do módulo:

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
// em qualquer lugar
import { JWTUtils } from "tempest-express-sdk";
import { settings } from "@/core/settings";

const jwt = new JWTUtils(settings.JWT_SECRET, {
  defaultTtlSeconds: settings.JWT_ACCESS_TTL_SECONDS,
  algorithm: settings.JWT_ALGORITHM as "HS256",
});
```

!!! warning "Troque os segredos default"
    `JWT_SECRET` e as chaves VAPID vêm com placeholders só para o app subir em
    dev. Em produção, defina-os via ambiente — nunca comite segredos reais.

---

## Recapitulando

- `baseAppSettingsShape` + `loadSettings(z.object(...))` = configuração validada
  e congelada no boot.
- Componha fragmentos por domínio com `...spread`; cada um usa os nomes de env e
  defaults do `tempest-fastapi-sdk`.
- `envBoolean` corrige o parse de booleanos; `envList` transforma CSV em lista.
- Um valor inválido falha **no boot**, não em produção. 🚀
