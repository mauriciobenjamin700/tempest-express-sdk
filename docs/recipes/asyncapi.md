# AsyncAPI: documentando o WebSocket

O OpenAPI descreve uma requisição e a resposta dela. Um WebSocket não tem esse
formato: a conexão fica aberta, as mensagens vão nos dois sentidos, e o servidor
fala sem ninguém ter pedido. Não existe onde encaixar isso num documento
OpenAPI — então rota de socket costuma virar **um parágrafo de prosa**, e prosa
não gera cliente nenhum.

O `createAsyncApiRegistry` resolve isso do mesmo jeito que o registry de
OpenAPI resolve o lado HTTP: você registra o que a conexão carrega, e o SDK
emite um documento **AsyncAPI 3.0** servido ao lado do `/openapi.json`.

## O exemplo completo

```typescript
import {
  createApp,
  createAsyncApiRegistry,
  runServer,
  z,
} from "tempest-express-sdk";

const subscribeFrame = z.object({
  action: z.literal("subscribe"),
  room: z.string().min(1).max(128),
});

const messageFrame = z.object({
  type: z.literal("message"),
  payload: z.object({
    remoteJid: z.string(),
    text: z.string().nullable(),
  }),
});

const handshakeHeaders = z.object({
  "x-api-key": z.string().describe("Chave do consumidor, exigida no upgrade"),
});

const asyncapi = createAsyncApiRegistry()
  .registerChannel({
    name: "socket",
    address: "/ws",
    title: "Conexão de tempo real",
    handshakeHeaders,
  })
  .registerMessage({
    name: "SubscribeFrame",
    schema: subscribeFrame,
    summary: "Entrar numa sala",
  })
  .registerMessage({
    name: "MessageFrame",
    schema: messageFrame,
    summary: "Uma mensagem chegou",
  })
  .registerOperation({
    name: "subscribe",
    channel: "socket",
    direction: "clientToServer",
    messages: ["SubscribeFrame"],
  })
  .registerOperation({
    name: "onMessage",
    channel: "socket",
    direction: "serverToClient",
    messages: ["MessageFrame"],
  });

const app = await createApp({
  asyncapi: { registry: asyncapi, info: { title: "Gateway", version: "1.0.0" } },
});

await runServer(app, { port: 3000 });
```

Batendo em `http://127.0.0.1:3000/asyncapi.json`:

```json
{
  "asyncapi": "3.0.0",
  "x-tempest-perspective": "server",
  "info": { "title": "Gateway", "version": "1.0.0" },
  "defaultContentType": "application/json",
  "channels": {
    "socket": {
      "address": "/ws",
      "title": "Conexão de tempo real",
      "messages": {
        "SubscribeFrame": { "$ref": "#/components/messages/SubscribeFrame" },
        "MessageFrame": { "$ref": "#/components/messages/MessageFrame" }
      },
      "bindings": {
        "ws": {
          "bindingVersion": "0.1.0",
          "method": "GET",
          "headers": { "$ref": "#/components/schemas/socketHeaders" }
        }
      }
    }
  },
  "operations": {
    "subscribe": {
      "action": "receive",
      "channel": { "$ref": "#/channels/socket" },
      "messages": [{ "$ref": "#/channels/socket/messages/SubscribeFrame" }]
    },
    "onMessage": {
      "action": "send",
      "channel": { "$ref": "#/channels/socket" },
      "messages": [{ "$ref": "#/channels/socket/messages/MessageFrame" }]
    }
  }
}
```

## Pedaço por pedaço

### O canal é a conexão

Em WebSocket **não existe canal virtual**. A própria especificação diz: *"the
channel represents the connection [...] there's only one channel"*. Diferente de
Kafka ou MQTT, onde canal é tópico, aqui você registra **um** canal — o caminho
onde o socket é servido — e as salas são detalhe do seu protocolo, não do
documento.

O `handshakeHeaders` vira o binding `ws` do canal, que é onde a especificação
guarda o que o upgrade HTTP exige. É ali que a chave de API fica documentada.

### `direction` é do ponto de vista do cliente

Esta é a parte que mais dá errado, e é por isso que o registry **não aceita**
`action`.

O `action` do AsyncAPI é relativo a **quem publicou o documento**. Como quem
publica é o servidor, um frame que o cliente envia aparece no documento como
`action: "receive"` — o servidor é quem recebe.

| Você escreve | Sai no documento | Quer dizer |
| --- | --- | --- |
| `direction: "clientToServer"` | `action: "receive"` | o servidor recebe |
| `direction: "serverToClient"` | `action: "send"` | o servidor envia |

!!! danger "Ler `action` como se fosse seu produz um cliente ao contrário"
    Um gerador de cliente precisa **inverter** todo `action` do documento. Errar
    o sinal não quebra nada visível: o cliente compila, passa no type-check, e
    faz exatamente o oposto do que devia.

    Por isso `direction` existe com esses dois nomes: `clientToServer` não tem
    como ser lido de trás para frente. E por isso o documento carrega
    `x-tempest-perspective: "server"` — um consumidor confere isso e **recusa**
    o documento se faltar, em vez de assumir.

### Os payloads são os mesmos schemas que validam

O `payload` de cada mensagem sai do seu objeto Zod, pelo mesmo caminho que
alimenta o OpenAPI. Não é uma cópia do schema: é o schema. O documento não tem
como descrever uma forma que o servidor recusaria, porque são o mesmo objeto.

!!! tip "Use união discriminada, não um envelope solto"
    Um envelope genérico (`{ type: string, data: unknown }`) passa no
    type-check e documenta **nada** — `unknown` não gera tipo, e o cliente
    gerado recebe um campo opaco.

    Registre um frame por variante, cada um com o discriminante literal
    (`z.literal("subscribe")`). O consumidor monta uma união tagueada e o
    `switch` fica exaustivo.

!!! note "`z.literal()` vira um enum de um valor só"
    No JSON Schema gerado, `z.literal("subscribe")` sai como
    `{ "type": "string", "enum": ["subscribe"] }`, e **não** como
    `{ "const": "subscribe" }`. Quem lê o documento para montar a união
    procura o discriminante nessa forma.

## Referência pendurada falha na hora

Operação que aponta para canal ou mensagem que ninguém registrou levanta erro na
geração, nomeando o que não resolveu:

```typescript
createAsyncApiRegistry()
  .registerChannel({ name: "socket", address: "/ws" })
  .registerOperation({
    name: "subscribe",
    channel: "socket",
    direction: "clientToServer",
    messages: ["NaoRegistrado"],
  })
  .generate({ info: { title: "T", version: "1" } });
// Error: AsyncAPI operation "subscribe" refers to message "NaoRegistrado",
// which is not registered.
```

Sem essa checagem o documento sairia estruturalmente válido, com um `$ref`
apontando para o vazio — e o cliente gerado a partir dele simplesmente não teria
aquele frame.

A ordem de registro, essa sim, não importa: as referências são resolvidas na
geração, então dá para registrar a operação antes do canal.

## Montar fora do `createApp`

O `mountAsyncApiJson` existe para quem monta o app na mão:

```typescript
import { generateAsyncApiDocument, mountAsyncApiJson } from "tempest-express-sdk";

const document = generateAsyncApiDocument(asyncapi, {
  info: { title: "Gateway", version: "1.0.0" },
});
mountAsyncApiJson(app, "/asyncapi.json", document);
```

!!! warning "Montar **depois** do `createApp` responde 404"
    O `createApp` instala o handler de 404 por último. Rota adicionada no app
    que ele devolveu fica atrás desse handler e nunca é alcançada.

    Use a opção `asyncapi` do `createApp`, ou monte dentro do `configure`.

## Recapitulando

- OpenAPI não descreve socket; AsyncAPI descreve, e os dois documentos convivem.
- **Um** canal por conexão — em WebSocket não há canal virtual.
- `direction` é do ponto de vista do cliente; o `action` do documento é do
  servidor, e o consumidor inverte.
- `x-tempest-perspective` diz de quem é a perspectiva, para ninguém supor.
- Payload sai do Zod que já valida, então documento e runtime não divergem.
- União discriminada por frame, nunca envelope com `data: unknown`.
- Referência pendurada falha na geração, não no consumidor.
