# MFA, HTTP client, Web Push and more

Production-ready server utilities.

## MFA (TOTP)

`TOTPHelper` is native (`node:crypto`, RFC 6238) — no external dependency.

```ts
import { TOTPHelper } from "tempest-express-sdk";

const totp = new TOTPHelper({ issuer: "My App" });
const secret = totp.generateSecret();                     // persist on the user
const uri = totp.provisioningUri(secret, "ana@example.com"); // render as a QR
totp.verify(secret, "123456");                            // true / false (±1 window)
```

## Resilient HTTP client

`HTTPClient` wraps native `fetch` with retry (backoff) + a per-host circuit
breaker.

```ts
import { HTTPClient, RetryPolicy } from "tempest-express-sdk";

const http = new HTTPClient({
  baseUrl: "https://api.example.com",
  retryPolicy: new RetryPolicy(3, 200),   // 3 attempts, 200ms base backoff
  breakerThreshold: 5,                     // opens after 5 consecutive failures
});

const res = await http.get("/status");
```

## Web Push (VAPID)

!!! info "Optional peer"
    ```bash
    npm install web-push
    ```

```ts
import { WebPushDispatcher, WebPushGoneError } from "tempest-express-sdk";

const push = new WebPushDispatcher({
  subject: "mailto:admin@example.com",
  publicKey: process.env.VAPID_PUBLIC!,
  privateKey: process.env.VAPID_PRIVATE!,
});

try {
  await push.send(subscription, { title: "Hello", body: "New message" });
} catch (err) {
  if (err instanceof WebPushGoneError) await removeSubscription(subscription);
}
```

## Email

!!! info "Optional peer"
    ```bash
    npm install nodemailer
    ```

```ts
import { EmailUtils } from "tempest-express-sdk";

const email = new EmailUtils({
  host: "smtp.example.com",
  user: "no-reply@example.com",
  password: process.env.SMTP_PASS!,
  from: "no-reply@example.com",
});

await email.send({ to: "ana@example.com", subject: "Welcome", html: "<b>Hi</b>" });
```

## Metrics

`MetricsUtils` reads CPU/memory/uptime from `node:os`/`process`, with a
Prometheus exporter. Use `makeMetricsRouter` to expose `/metrics` directly:

```ts
import { makeMetricsRouter } from "tempest-express-sdk";

app.use(makeMetricsRouter({ includeGpu: true }));
// GET /metrics → text/plain Prometheus (CPU, memory, uptime + GPU when present)
```

GPU is optional and dependency-free — `includeGpu` shells out to `nvidia-smi`
and returns `[]` when absent (adds `gpu_utilization_percent{gpu="N"}`,
`gpu_memory_used_mb`, `gpu_temperature_celsius` gauges). Pass a `guard` to keep
the endpoint on the internal network. You can also render manually:

```ts
import { MetricsUtils } from "tempest-express-sdk";
const text = MetricsUtils.toPrometheus(MetricsUtils.system(), await MetricsUtils.gpus());
```

## Trusted client IP

```ts
import { getClientIp } from "tempest-express-sdk";

// Behind a proxy: trust ONLY the header the edge sets (never raw X-Forwarded-For).
const ip = getClientIp(req, { trustedHeader: "x-real-ip" });
```

## Recap

Native MFA, a resilient HTTP client, Web Push/email (optional peers), Prometheus
metrics and safe IP resolution — the missing server pieces.
