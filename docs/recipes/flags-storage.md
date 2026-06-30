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

`UploadStorage` é a interface; `LocalUploadStorage` grava no sistema de arquivos.
Para S3/MinIO, implemente a mesma interface sobre o seu cliente.

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

## Recapitulando

Flags com backends trocáveis + guarda de rota; storage com interface única
(local agora, S3/MinIO implementando o mesmo contrato).
