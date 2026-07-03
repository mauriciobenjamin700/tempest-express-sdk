import {
  MessagingHub,
  type MessagingProvider,
  type OutboundResult,
  broadcastText,
} from "@/index";
import { describe, expect, it } from "vitest";

/** A fake provider that fails for a specific recipient. */
function fakeProvider(failFor?: string): MessagingProvider & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    async sendText(to: string): Promise<OutboundResult> {
      if (to === failFor) throw new Error("boom");
      sent.push(to);
      return { status: "sent", id: `id-${to}` };
    },
    async sendMedia(): Promise<OutboundResult> {
      return { status: "sent" };
    },
    async status() {
      return "connected";
    },
  };
}

describe("broadcastText", () => {
  it("sends to all recipients and isolates failures", async () => {
    const provider = fakeProvider("b");
    const results = await broadcastText(provider, ["a", "b", "c"], "hi", {
      concurrency: 2,
    });
    expect(results.map((r) => [r.to, r.ok])).toEqual([
      ["a", true],
      ["b", false],
      ["c", true],
    ]);
    expect(results[1]?.error).toBe("boom");
    expect(provider.sent.sort()).toEqual(["a", "c"]);
  });

  it("preserves input order under concurrency", async () => {
    const provider = fakeProvider();
    const recipients = Array.from({ length: 25 }, (_, i) => `u${i}`);
    const results = await broadcastText(provider, recipients, "x", { concurrency: 5 });
    expect(results.map((r) => r.to)).toEqual(recipients);
    expect(results.every((r) => r.ok)).toBe(true);
  });
});

describe("MessagingHub", () => {
  it("routes send/broadcast by channel and rejects unknown ones", async () => {
    const sms = fakeProvider();
    const hub = new MessagingHub().register("sms", sms);
    expect(hub.channelNames()).toEqual(["sms"]);

    const one = await hub.send("sms", "a", "hey");
    expect(one.status).toBe("sent");

    const many = await hub.broadcast("sms", ["x", "y"], "yo");
    expect(many.every((r) => r.ok)).toBe(true);

    expect(() => hub.get("email")).toThrow(/Unknown messaging channel/);
  });
});
