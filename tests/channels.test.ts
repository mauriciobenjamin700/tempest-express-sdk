import { createHmac } from "node:crypto";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  type InboundMessage,
  TelegramProvider,
  TwilioSmsProvider,
  createApp,
  makeTwilioWebhookRouter,
  runServer,
  validateTwilioSignature,
} from "@/index";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// --- Fake upstream APIs (Telegram Bot API + Twilio REST) -------------------
let upstream: Server;
let base: string;
let updatesServed = false;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Telegram
  app.post("/botTOKEN/sendMessage", (_req, res) =>
    res.json({ ok: true, result: { message_id: 42 } }),
  );
  app.post("/botTOKEN/getMe", (_req, res) => res.json({ ok: true, result: { id: 1 } }));
  app.post("/botTOKEN/getUpdates", (_req, res) => {
    if (updatesServed) {
      res.json({ ok: true, result: [] });
      return;
    }
    updatesServed = true;
    res.json({
      ok: true,
      result: [
        {
          update_id: 100,
          message: {
            message_id: 7,
            date: 1_700_000_000,
            text: "hi bot",
            chat: { id: 555 },
          },
        },
      ],
    });
  });

  // Twilio
  app.post("/2010-04-01/Accounts/SID/Messages.json", (_req, res) =>
    res.json({ sid: "SM123", status: "queued" }),
  );
  app.get("/2010-04-01/Accounts/SID.json", (_req, res) => res.json({ status: "active" }));

  upstream = createServer(app);
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
});

afterAll(() => upstream.close());

describe("TelegramProvider", () => {
  it("sends text and reports status", async () => {
    const tg = new TelegramProvider({
      token: "TOKEN",
      apiBase: base,
      pollTimeoutSeconds: 0,
    });
    expect(await tg.sendText("555", "oi")).toMatchObject({ id: "42", status: "sent" });
    expect(await tg.status()).toBe("connected");
  });

  it("receives inbound via long-polling", async () => {
    const tg = new TelegramProvider({
      token: "TOKEN",
      apiBase: base,
      pollTimeoutSeconds: 0,
    });
    const got = new Promise<InboundMessage>((resolve) => {
      void tg
        .onMessage((m) => resolve(m))
        .then((stop) => {
          setTimeout(() => void stop(), 500);
        });
    });
    const msg = await got;
    expect(msg).toMatchObject({
      from: "555",
      messageId: "7",
      text: "hi bot",
      direction: "incoming",
    });
  });
});

describe("TwilioSmsProvider", () => {
  it("sends an SMS and reads status", async () => {
    const sms = new TwilioSmsProvider({
      accountSid: "SID",
      authToken: "tok",
      from: "+15550000000",
      apiBase: base,
    });
    expect(await sms.sendText("+15551112222", "hello")).toMatchObject({
      id: "SM123",
      status: "queued",
    });
    expect(await sms.status()).toBe("active");
  });
});

describe("validateTwilioSignature", () => {
  it("accepts a correct signature and rejects a wrong one", () => {
    const url = "https://sms.test/sms/inbound";
    const params = { From: "+15551112222", Body: "hi", MessageSid: "SM9" };
    const data =
      url +
      Object.keys(params)
        .sort()
        .map((k) => k + (params as never)[k])
        .join("");
    const sig = createHmac("sha1", "tok").update(data, "utf8").digest("base64");
    expect(validateTwilioSignature("tok", url, params, sig)).toBe(true);
    expect(validateTwilioSignature("tok", url, params, "bad")).toBe(false);
  });
});

describe("makeTwilioWebhookRouter", () => {
  let server: Server;
  let url: string;
  const inbox: InboundMessage[] = [];
  const publicUrl = "https://sms.test/sms/inbound";

  beforeAll(async () => {
    const app = await createApp({
      health: false,
      configure: (a) => {
        a.use(
          makeTwilioWebhookRouter({
            authToken: "tok",
            publicUrl,
            onMessage: (m) => {
              inbox.push(m);
            },
          }),
        );
      },
    });
    server = await runServer(app, { port: 0 });
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/sms/inbound`;
  });
  afterAll(() => server.close());

  it("accepts a validly-signed inbound SMS", async () => {
    const params = { From: "+15551112222", Body: "hey", MessageSid: "SM7" };
    const data =
      publicUrl +
      Object.keys(params)
        .sort()
        .map((k) => k + (params as never)[k])
        .join("");
    const sig = createHmac("sha1", "tok").update(data, "utf8").digest("base64");
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": sig,
      },
      body: new URLSearchParams(params).toString(),
    });
    expect(res.status).toBe(200);
    expect(inbox[0]).toMatchObject({
      from: "+15551112222",
      text: "hey",
      messageId: "SM7",
    });
  });

  it("rejects a bad signature (401)", async () => {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": "no",
      },
      body: new URLSearchParams({ From: "x", Body: "y", MessageSid: "z" }).toString(),
    });
    expect(res.status).toBe(401);
  });
});
