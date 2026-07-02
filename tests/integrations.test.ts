import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  type InboundMessage,
  WhatsAppProvider,
  createApp,
  makeWhatsAppWebhookRouter,
  runServer,
} from "@/index";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";

let zap: Server;
let wss: WebSocketServer;
let base: string;

beforeAll(async () => {
  // Fake zap-api: REST routes + a /ws that pushes one message frame on connect.
  const app = express();
  app.use(express.json());
  app.post("/message/send-text", (req, res) => {
    res
      .status(202)
      .json({ id: "msg-1", status: "queued", deduped: false, echo: req.body });
  });
  app.get("/message/check-number/:n", (req, res) => {
    res.json({ number: req.params.n, exists: req.params.n === "5511999999999" });
  });
  app.get("/session/status", (_req, res) => res.json({ status: "connected" }));

  zap = createServer(app);
  wss = new WebSocketServer({ server: zap, path: "/ws" });
  wss.on("connection", (socket) => {
    socket.on("message", (raw) => {
      const frame = JSON.parse(String(raw));
      if (frame.action === "subscribe") {
        socket.send(
          JSON.stringify({
            type: "message",
            payload: {
              remoteJid: "5511999999999@s.whatsapp.net",
              messageId: "ABCD",
              direction: "incoming",
              text: "oi",
              mediaType: null,
              timestamp: "2026-04-21T18:30:00.000Z",
            },
          }),
        );
      }
    });
  });
  await new Promise<void>((resolve) => zap.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(zap.address() as AddressInfo).port}`;
});

afterAll(() => {
  wss.close();
  zap.close();
});

describe("WhatsAppProvider", () => {
  it("sends text and reads status / number existence", async () => {
    const wa = new WhatsAppProvider({ baseUrl: base, apiKey: "k" });
    const result = await wa.sendText("5511999999999", "hi", { idempotencyKey: "x1" });
    expect(result).toMatchObject({ id: "msg-1", status: "queued", deduped: false });
    expect(await wa.status()).toBe("connected");
    expect(await wa.checkNumber("5511999999999")).toBe(true);
    expect(await wa.checkNumber("0000")).toBe(false);
  });

  it("receives inbound messages over the /ws subscription", async () => {
    const wa = new WhatsAppProvider({ baseUrl: base, apiKey: "k" });
    const received = new Promise<InboundMessage>((resolve) => {
      void wa.onMessage((m) => resolve(m));
    });
    const message = await received;
    expect(message).toMatchObject({
      from: "5511999999999@s.whatsapp.net",
      messageId: "ABCD",
      text: "oi",
      direction: "incoming",
    });
  });
});

describe("makeWhatsAppWebhookRouter", () => {
  let server: Server;
  let url: string;
  const inbox: InboundMessage[] = [];

  beforeAll(async () => {
    const app = await createApp({
      health: false,
      configure: (a) => {
        a.use(
          makeWhatsAppWebhookRouter({
            apiKey: "secret",
            onMessage: (m) => {
              inbox.push(m);
            },
          }),
        );
      },
    });
    server = await runServer(app, { port: 0 });
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/whatsapp/inbound`;
  });
  afterAll(() => server.close());

  const body = {
    from: "5511999999999@s.whatsapp.net",
    messageId: "W1",
    text: "hello",
    mediaType: null,
    timestamp: "2026-04-21T18:30:00.000Z",
  };

  it("accepts a signed inbound payload", async () => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "secret" },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.messageId).toBe("W1");
  });

  it("rejects a bad key with 401", async () => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "wrong" },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(401);
  });
});
