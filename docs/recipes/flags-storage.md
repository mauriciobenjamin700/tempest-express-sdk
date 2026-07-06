# Feature flags e storage

## Feature flags

Backends componíveis: memória (overrides/testes), env (`FLAG_<NOME>`) e
composite (primeiro que decide vence).

```ts
import {
  CompositeFeatureFlagBackend,
  EnvFeatureFlagBackend,
  FeatureFlags,
  MemoryFeatureFlagBackend,
  makeFlagGuard,
} from "tempest-express-sdk";

const flags = new FeatureFlags(
  new CompositeFeatureFlagBackend([
    new MemoryFeatureFlagBackend({ "new-ui": true }),
    new EnvFeatureFlagBackend(), // lê FLAG_NEW_UI, FLAG_BETA, …
  ]),
);

await flags.isEnabled("new-ui"); // true

// Esconde uma rota (404) quando a flag está desligada:
app.get("/api/beta", makeFlagGuard(flags, "beta"), (_req, res) => res.json({ ok: true }));
```

!!! note "Convenção de env"
    A flag `new-ui` mapeia para `FLAG_NEW_UI`. Valores `1/true/on/yes/enabled`
    (case-insensitive) contam como ligado.

## Storage / uploads

`UploadStorage` é a interface; `LocalUploadStorage` grava no sistema de arquivos
e `S3UploadStorage` grava em S3/MinIO — mesmo contrato, troca sem tocar nas
chamadas.

```ts
import { LocalUploadStorage, buildContentDisposition } from "tempest-express-sdk";

const storage = new LocalUploadStorage({
  root: "./var/uploads",
  baseUrl: "https://cdn.example.com",
});

const result = await storage.save(
  "avatars/123.png",
  new Uint8Array(bytes),
  { contentType: "image/png" },
);
result.url; // "https://cdn.example.com/avatars/123.png"

// Download com nome de arquivo (acentos seguros via RFC 5987):
res.setHeader("Content-Disposition", buildContentDisposition("relatório.pdf"));
res.send(await storage.read("docs/relatorio.pdf"));
```

### S3 / MinIO

`S3UploadStorage` implementa a mesma interface sobre o cliente `minio` (peer
opcional — `npm i minio`), carregado sob demanda. Troque o backend sem mudar o
resto do código:

```ts
import { S3UploadStorage } from "tempest-express-sdk";
import { Client } from "minio";

const storage = new S3UploadStorage({
  bucket: "uploads",
  publicBaseUrl: "https://cdn.example.com",
  client: new Client({
    endPoint: "s3.amazonaws.com",
    useSSL: true,
    accessKey: process.env.MINIO_ACCESS_KEY ?? "",
    secretKey: process.env.MINIO_SECRET_KEY ?? "",
    region: "us-east-1",
  }),
});

await storage.save("avatars/123.png", bytes, { contentType: "image/png" });
storage.url("avatars/123.png"); // "https://cdn.example.com/uploads/avatars/123.png"
```

Sem `client`, passe `endPoint`/`accessKey`/`secretKey`/… e o SDK constrói o
cliente `minio` no primeiro uso. Os campos batem com `minioSettingsShape`.

## Recapitulando

Flags com backends trocáveis + guarda de rota; storage com interface única —
`LocalUploadStorage` (disco) e `S3UploadStorage` (S3/MinIO) sob o mesmo contrato.
