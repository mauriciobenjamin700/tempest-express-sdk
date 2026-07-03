# Integrações: SMS e Telegram

Mais canais sob o mesmo contrato `MessagingProvider` — troque de canal sem mudar
o código de negócio.

## Telegram

Cliente da Bot API (sem SDK). Envia por REST e recebe por long-polling.

```ts
import { TelegramProvider } from "tempest-express-sdk";

const tg = new TelegramProvider({ token: process.env.TELEGRAM_BOT_TOKEN! });

await tg.sendText("<chat_id>", "Olá do bot 🤖");
await tg.sendMedia("<chat_id>", { kind: "image", media: "https://.../foto.jpg", caption: "oi" });

// Receber (long-polling getUpdates):
const stop = await tg.onMessage((msg) => {
  console.log("recebida:", msg.from, msg.text);
});
// depois: await stop();
```

## SMS (Twilio)

Cliente REST do Twilio. Enviar não tem dependência; receber é por webhook (SMS
não tem assinatura persistente, então `onMessage` não existe neste provider).

```ts
import { TwilioSmsProvider } from "tempest-express-sdk";

const sms = new TwilioSmsProvider({
  accountSid: process.env.TWILIO_SID!,
  authToken: process.env.TWILIO_TOKEN!,
  from: "+15550000000",
});

await sms.sendText("+15551112222", "Seu código é 1234");
```

### Webhook de entrada (validado)

O `makeTwilioWebhookRouter` valida a assinatura `X-Twilio-Signature` (HMAC-SHA1)
e entrega um `InboundMessage` tipado.

```ts
import { createApp, makeTwilioWebhookRouter } from "tempest-express-sdk";

const app = await createApp({
  configure: (a) => {
    a.use(
      makeTwilioWebhookRouter({
        authToken: process.env.TWILIO_TOKEN!,
        publicUrl: "https://api.suaempresa.com/sms/inbound", // atrás de proxy
        onMessage: async (msg) => {
          await handleSms(msg); // { from, messageId, text, ... }
        },
      }),
    );
  },
});
```

Assinatura inválida → **401**. Responde `<Response></Response>` (TwiML vazio).

## Email como canal

`EmailProvider` também implementa `MessagingProvider` (sobre `EmailUtils`), então
notificação por email usa a mesma interface.

```ts
import { EmailProvider, EmailUtils } from "tempest-express-sdk";

const email = new EmailUtils({ host: "smtp.exemplo.com", from: "no-reply@exemplo.com" });
const provider = new EmailProvider({ email, subject: "Aviso" });

await provider.sendText("ana@example.com", "Seu pedido saiu para entrega");
```

`onMessage`/`checkNumber` não existem no email (só envio).

## Programe contra o contrato

```ts
import type { MessagingProvider } from "tempest-express-sdk";

// Funciona com WhatsApp, Telegram ou SMS — injete o provider.
async function notify(provider: MessagingProvider, to: string, text: string) {
  await provider.sendText(to, text);
}
```

## Broadcast e multi-canal

`broadcastText` envia uma mensagem a vários destinatários por um provider, com
concorrência limitada e resultado por destinatário (uma falha não aborta o lote).
`MessagingHub` registra providers por nome.

```ts
import { MessagingHub, broadcastText } from "tempest-express-sdk";

const results = await broadcastText(wa, ["5511...", "5521..."], "Promo!", { concurrency: 20 });
const falhas = results.filter((r) => !r.ok);

const hub = new MessagingHub()
  .register("whatsapp", wa)
  .register("sms", sms)
  .register("email", emailProvider);

await hub.send("sms", "+15551112222", "Código 1234");
await hub.broadcast("whatsapp", numeros, "Aviso");
```

!!! note "Capacidades por canal"
    `sendText`/`sendMedia`/`status` existem em todos. `onMessage` existe onde há
    assinatura viva (WhatsApp `/ws`, Telegram polling); `checkNumber` só no
    WhatsApp. Cheque a presença do método antes de chamar em código genérico.

## Recapitulando

WhatsApp, Telegram e SMS compartilham o `MessagingProvider`. Telegram recebe por
polling; SMS por webhook assinado; todos enviam com a mesma interface.
