import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  EventStream,
  SSEBroker,
  ServerSentEvent,
  WebSocketHub,
  attachWebSocketHub,
  createApp,
  runServer,
} from "@/index";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

describe("ServerSentEvent", () => {
  it("encodes the SSE wire format", () => {
    const encoded = new ServerSentEvent({ data: "hi", event: "greet", id: "1" }).encode();
    expect(encoded).toBe("event: greet\nid: 1\ndata: hi\n\n");
  });
});

describe("EventStream + SSEBroker", () => {
  it("drains published events then ends on close", async () => {
    const stream = new EventStream({ heartbeatSeconds: null });
    stream.publish({ n: 1 });
    stream.publish("two", "msg");
    stream.close();
    const chunks: string[] = [];
    for await (const chunk of stream.stream()) chunks.push(chunk);
    expect(chunks).toEqual([`data: {"n":1}\n\n`, "event: msg\ndata: two\n\n"]);
  });

  it("fans out to channel subscribers", async () => {
    const broker = new SSEBroker({ heartbeatSeconds: null });
    const stream = broker.register("room");
    expect(broker.localSubscribers("room")).toBe(1);
    expect(broker.publish("room", { hello: true })).toBe(1);
    stream.close();
    const first = await stream.stream().next();
    expect(first.value).toBe(`data: {"hello":true}\n\n`);
    broker.unregister("room", stream);
    expect(broker.localSubscribers("room")).toBe(0);
  });
});

describe("WebSocketHub over ws", () => {
  let server: Server;
  let hub: WebSocketHub;
  let url: string;

  beforeAll(async () => {
    const app = await createApp({ health: false });
    server = await runServer(app, { port: 0 });
    hub = new WebSocketHub();
    await attachWebSocketHub(server, hub, {
      path: "/ws",
      authenticate: (info) => (info.url.includes("token=") ? "user-1" : null),
      heartbeatSeconds: 0,
    });
    url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`;
  });

  afterAll(() => server.close());

  it("broadcasts an envelope to a connected client", async () => {
    const client = new WebSocket(`${url}?token=abc`);
    await new Promise((resolve) => client.on("open", resolve));

    const received = new Promise<string>((resolve) => {
      client.on("message", (data) => resolve(String(data)));
    });
    // Wait one tick so the server-side connection is registered.
    await new Promise((r) => setTimeout(r, 50));
    expect(hub.connectionCount()).toBe(1);
    expect(hub.onlineUsers().has("user-1")).toBe(true);

    hub.broadcast({ type: "hello", data: { n: 1 } });
    const msg = JSON.parse(await received) as { type: string; data: { n: number } };
    expect(msg).toEqual({ type: "hello", data: { n: 1 } });

    client.close();
  });

  it("rejects an unauthenticated handshake", async () => {
    const client = new WebSocket(url); // no token → close 1008
    const code = await new Promise<number>((resolve) => {
      client.on("close", (c) => resolve(c));
      client.on("error", () => undefined);
    });
    expect(code).toBe(1008);
  });
});
