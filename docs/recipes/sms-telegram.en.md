# Integrations: SMS and Telegram

More channels under the same `MessagingProvider` contract — swap channels
without touching business code.

## Telegram

A Bot API client (no SDK). Sends over REST, receives via long-polling.

```ts
import { TelegramProvider } from "tempest-express-sdk";

const tg = new TelegramProvider({ token: process.env.TELEGRAM_BOT_TOKEN! });

await tg.sendText("<chat_id>", "Hello from the bot 🤖");
await tg.sendMedia("<chat_id>", { kind: "image", media: "https://.../photo.jpg", caption: "hi" });

// Receive (long-polling getUpdates):
const stop = await tg.onMessage((msg) => {
  console.log("received:", msg.from, msg.text);
});
// later: await stop();
```

## SMS (Twilio)

A Twilio REST client. Sending is dependency-free; receiving is via webhook (SMS
has no persistent subscription, so this provider has no `onMessage`).

```ts
import { TwilioSmsProvider } from "tempest-express-sdk";

const sms = new TwilioSmsProvider({
  accountSid: process.env.TWILIO_SID!,
  authToken: process.env.TWILIO_TOKEN!,
  from: "+15550000000",
});

await sms.sendText("+15551112222", "Your code is 1234");
```

### Inbound webhook (validated)

`makeTwilioWebhookRouter` validates the `X-Twilio-Signature` (HMAC-SHA1) and
delivers a typed `InboundMessage`.

```ts
import { createApp, makeTwilioWebhookRouter } from "tempest-express-sdk";

const app = await createApp({
  configure: (a) => {
    a.use(
      makeTwilioWebhookRouter({
        authToken: process.env.TWILIO_TOKEN!,
        publicUrl: "https://api.yourco.com/sms/inbound", // behind a proxy
        onMessage: async (msg) => {
          await handleSms(msg); // { from, messageId, text, ... }
        },
      }),
    );
  },
});
```

Invalid signature → **401**. Responds with an empty `<Response></Response>` (TwiML).

## Program against the contract

```ts
import type { MessagingProvider } from "tempest-express-sdk";

// Works with WhatsApp, Telegram or SMS — inject the provider.
async function notify(provider: MessagingProvider, to: string, text: string) {
  await provider.sendText(to, text);
}
```

!!! note "Per-channel capabilities"
    `sendText`/`sendMedia`/`status` exist on all. `onMessage` exists where there
    is a live subscription (WhatsApp `/ws`, Telegram polling); `checkNumber` is
    WhatsApp-only. Check the method is present before calling it in generic code.

## Recap

WhatsApp, Telegram and SMS share `MessagingProvider`. Telegram receives via
polling; SMS via a signed webhook; all send through the same interface.
