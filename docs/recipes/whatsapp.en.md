# Integrations: WhatsApp (zap-api)

The `integrations` module ships a typed client for the
[`zap-api`](https://github.com/mauriciobenjamin700) service behind a
`MessagingProvider` contract — send over REST, receive in real time over `/ws`,
plus a ready inbound-webhook receiver.

## Sending messages

```ts
import { WhatsAppProvider } from "tempest-express-sdk";

const wa = new WhatsAppProvider({
  baseUrl: "https://zap.example.com",
  apiKey: process.env.ZAP_API_KEY!,
});

await wa.sendText("5511999999999", "Hello!", { idempotencyKey: "order-42" });
await wa.sendMedia("5511999999999", {
  kind: "image",
  media: "https://example.com/photo.jpg",
  caption: "Caption",
});

await wa.checkNumber("5511999999999"); // true/false
await wa.status();                      // "connected" | "connecting" | "disconnected"
```

!!! info "Optional peer for real-time"
    Sending (REST) uses the built-in `HTTPClient` — no dependency. Receiving
    over `/ws` requires the `ws` peer:
    ```bash
    npm install ws
    ```

## Receiving in real time (`/ws`)

```ts
const unsubscribe = await wa.onMessage((msg) => {
  console.log("received:", msg.from, msg.text);
}, "*"); // room "*" = all conversations; or pass a JID

// later:
await unsubscribe();
```

## Receiving via webhook

If `zap-api` has `WEBHOOK_URL` pointing at your service, mount the receiver — it
validates `x-api-key` and delivers a typed `InboundMessage`.

```ts
import { createApp, makeWhatsAppWebhookRouter } from "tempest-express-sdk";

const app = await createApp({
  configure: (a) => {
    a.use(
      makeWhatsAppWebhookRouter({
        apiKey: process.env.WEBHOOK_API_KEY!, // validates x-api-key (constant-time)
        path: "/whatsapp/inbound",
        onMessage: async (msg) => {
          await handleInbound(msg); // { from, messageId, text, mediaType, timestamp }
        },
      }),
    );
  },
});
```

Wrong key → **401** in the canonical envelope; invalid payload → **422**.

## The `MessagingProvider` contract

`WhatsAppProvider` implements `MessagingProvider` (`sendText`, `sendMedia`,
`checkNumber`, `status`, `onMessage`). Program against the interface to swap
channels (SMS, Telegram — on the roadmap) or mock it in tests.

```ts
import type { MessagingProvider } from "tempest-express-sdk";

async function notify(provider: MessagingProvider, to: string) {
  await provider.sendText(to, "Your order is out for delivery 🚚");
}
```

## Recap

A typed zap-api client (REST + `/ws`) plus a webhook receiver, behind a
swappable provider contract. Sending is dependency-free; receiving over WS uses
the optional `ws` peer.
