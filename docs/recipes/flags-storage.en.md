# Feature flags and storage

## Feature flags

Composable backends: memory (overrides/tests), env (`FLAG_<NAME>`) and composite
(first to decide wins).

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
    new EnvFeatureFlagBackend(), // reads FLAG_NEW_UI, FLAG_BETA, …
  ]),
);

await flags.isEnabled("new-ui"); // true

// Hide a route (404) when the flag is off:
app.get("/api/beta", makeFlagGuard(flags, "beta"), (_req, res) => res.json({ ok: true }));
```

!!! note "Env convention"
    The flag `new-ui` maps to `FLAG_NEW_UI`. Values `1/true/on/yes/enabled`
    (case-insensitive) count as enabled.

## Storage / uploads

`UploadStorage` is the interface; `LocalUploadStorage` writes to the filesystem.
For S3/MinIO, implement the same interface over your client.

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

// Download with a filename (accent-safe via RFC 5987):
res.setHeader("Content-Disposition", buildContentDisposition("report.pdf"));
res.send(await storage.read("docs/report.pdf"));
```

## Recap

Flags with swappable backends + a route guard; storage behind a single interface
(local now, S3/MinIO by implementing the same contract).
