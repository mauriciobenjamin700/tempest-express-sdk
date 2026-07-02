# MFA, HTTP client, Web Push e mais

Utilidades de servidor prontas para produção.

## MFA (TOTP)

`TOTPHelper` é nativo (`node:crypto`, RFC 6238) — sem dependência externa.

```ts
import { TOTPHelper } from "tempest-express-sdk";

const totp = new TOTPHelper({ issuer: "Minha App" });
const secret = totp.generateSecret();                     // persista no usuário
const uri = totp.provisioningUri(secret, "ana@example.com"); // renderize como QR
totp.verify(secret, "123456");                            // true / false (janela ±1)
```

## HTTP client resiliente

`HTTPClient` embrulha o `fetch` nativo com retry (backoff) + circuit breaker por
host.

```ts
import { HTTPClient, RetryPolicy } from "tempest-express-sdk";

const http = new HTTPClient({
  baseUrl: "https://api.exemplo.com",
  retryPolicy: new RetryPolicy(3, 200),   // 3 tentativas, backoff base 200ms
  breakerThreshold: 5,                     // abre após 5 falhas seguidas
});

const res = await http.get("/status");
```

## Web Push (VAPID)

!!! info "Peer opcional"
    ```bash
    npm install web-push
    ```

```ts
import { WebPushDispatcher, WebPushGoneError } from "tempest-express-sdk";

const push = new WebPushDispatcher({
  subject: "mailto:admin@exemplo.com",
  publicKey: process.env.VAPID_PUBLIC!,
  privateKey: process.env.VAPID_PRIVATE!,
});

try {
  await push.send(subscription, { title: "Olá", body: "Nova mensagem" });
} catch (err) {
  if (err instanceof WebPushGoneError) await removeSubscription(subscription);
}
```

## Email

!!! info "Peer opcional"
    ```bash
    npm install nodemailer
    ```

```ts
import { EmailUtils } from "tempest-express-sdk";

const email = new EmailUtils({
  host: "smtp.exemplo.com",
  user: "no-reply@exemplo.com",
  password: process.env.SMTP_PASS!,
  from: "no-reply@exemplo.com",
});

await email.send({ to: "ana@example.com", subject: "Bem-vinda", html: "<b>Oi</b>" });
```

## Métricas

`MetricsUtils` lê CPU/memória/uptime do `node:os`/`process`, com exporter
Prometheus.

```ts
import { MetricsUtils } from "tempest-express-sdk";

app.get("/metrics", (_req, res) => {
  res.type("text/plain").send(MetricsUtils.toPrometheus());
});
```

## Client IP confiável

```ts
import { getClientIp } from "tempest-express-sdk";

// Atrás de proxy: confie APENAS no header que a edge define (nunca X-Forwarded-For cru).
const ip = getClientIp(req, { trustedHeader: "x-real-ip" });
```

## Recapitulando

MFA nativo, HTTP client resiliente, Web Push/email (peers opcionais), métricas
Prometheus e resolução de IP segura — as peças de servidor que faltavam.
