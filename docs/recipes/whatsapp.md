# Integrações: WhatsApp (zap-api)

O módulo `integrations` traz um cliente tipado para o serviço
[`zap-api`](https://github.com/mauriciobenjamin700) por trás de um contrato
`MessagingProvider` — enviar por REST, receber em tempo real pelo `/ws`, e um
receiver de webhook pronto.

## Enviar mensagens

```ts
import { WhatsAppProvider } from "tempest-express-sdk";

const wa = new WhatsAppProvider({
  baseUrl: "https://zap.example.com",
  apiKey: process.env.ZAP_API_KEY!,
});

await wa.sendText("5511999999999", "Olá!", { idempotencyKey: "pedido-42" });
await wa.sendMedia("5511999999999", {
  kind: "image",
  media: "https://example.com/foto.jpg",
  caption: "Legenda",
});

await wa.checkNumber("5511999999999"); // true/false
await wa.status();                      // "connected" | "connecting" | "disconnected"
```

!!! info "Peer opcional para tempo real"
    O envio (REST) usa o `HTTPClient` embutido — sem dependência. Receber via
    `/ws` requer a peer `ws`:
    ```bash
    npm install ws
    ```

## Receber em tempo real (`/ws`)

```ts
const unsubscribe = await wa.onMessage((msg) => {
  console.log("recebida:", msg.from, msg.text);
}, "*"); // sala "*" = todas as conversas; ou passe um JID

// mais tarde:
await unsubscribe();
```

## Receber por webhook

Se o `zap-api` estiver com `WEBHOOK_URL` apontando para o seu serviço, monte o
receiver — ele valida o `x-api-key` e entrega um `InboundMessage` tipado.

```ts
import { createApp, makeWhatsAppWebhookRouter } from "tempest-express-sdk";

const app = await createApp({
  configure: (a) => {
    a.use(
      makeWhatsAppWebhookRouter({
        apiKey: process.env.WEBHOOK_API_KEY!, // valida x-api-key (constante-time)
        path: "/whatsapp/inbound",
        onMessage: async (msg) => {
          await handleInbound(msg); // { from, messageId, text, mediaType, timestamp }
        },
      }),
    );
  },
});
```

Chave errada → **401** no envelope padrão; payload inválido → **422**.

## Contrato `MessagingProvider`

`WhatsAppProvider` implementa `MessagingProvider` (`sendText`, `sendMedia`,
`checkNumber`, `status`, `onMessage`). Programe contra a interface para trocar de
canal (SMS, Telegram — no roadmap) ou mockar em testes.

```ts
import type { MessagingProvider } from "tempest-express-sdk";

async function notify(provider: MessagingProvider, to: string) {
  await provider.sendText(to, "Seu pedido saiu para entrega 🚚");
}
```

## Recapitulando

Um cliente tipado do zap-api (REST + `/ws`) + receiver de webhook, atrás de um
contrato de provider trocável. Enviar não tem dependência; receber via WS usa a
peer opcional `ws`.
