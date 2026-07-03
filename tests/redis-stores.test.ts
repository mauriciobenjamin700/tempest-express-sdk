import {
  RedisSSEBroker,
  RedisSessionStore,
  type Session,
  type SessionRedisLike,
} from "@/index";
import { describe, expect, it } from "vitest";

/** In-memory fake of the node-redis subset used by RedisSessionStore. */
class FakeRedis implements SessionRedisLike {
  private strings = new Map<string, string>();
  private sets = new Map<string, Set<string>>();

  async get(key: string) {
    return this.strings.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.strings.set(key, value);
    return "OK";
  }
  async del(key: string) {
    this.strings.delete(key);
    return 1;
  }
  async sAdd(key: string, member: string) {
    const set = this.sets.get(key) ?? new Set();
    set.add(member);
    this.sets.set(key, set);
    return 1;
  }
  async sRem(key: string, member: string) {
    this.sets.get(key)?.delete(member);
    return 1;
  }
  async sMembers(key: string) {
    return [...(this.sets.get(key) ?? [])];
  }
}

describe("RedisSessionStore", () => {
  it("stores, indexes, lists and revokes by user", async () => {
    const store = new RedisSessionStore(new FakeRedis());
    const session: Session = {
      idHash: "h1",
      userId: "u1",
      data: { role: "user" },
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    };
    await store.set(session);
    expect((await store.get("h1"))?.userId).toBe("u1");
    expect(await store.listByUser("u1")).toHaveLength(1);

    expect(await store.deleteByUser("u1")).toBe(1);
    expect(await store.get("h1")).toBeNull();
    expect(await store.listByUser("u1")).toHaveLength(0);
  });

  it("treats expired sessions as absent", async () => {
    const store = new RedisSessionStore(new FakeRedis());
    await store.set({
      idHash: "h2",
      userId: "u2",
      data: {},
      createdAt: Date.now() - 10_000,
      expiresAt: Date.now() - 1,
    });
    expect(await store.get("h2")).toBeNull();
  });
});

/** A tiny in-process pub/sub bus shared by the fake pub + sub clients. */
class FakeBus {
  private listeners = new Map<string, Array<(msg: string) => void>>();
  async publish(channel: string, message: string) {
    for (const l of this.listeners.get(channel) ?? []) l(message);
    return 1;
  }
  async subscribe(channel: string, listener: (msg: string) => void) {
    const arr = this.listeners.get(channel) ?? [];
    arr.push(listener);
    this.listeners.set(channel, arr);
  }
  async unsubscribe(channel: string) {
    this.listeners.delete(channel);
  }
}

describe("RedisSSEBroker", () => {
  it("fans a published event out to a local stream via pub/sub", async () => {
    const bus = new FakeBus();
    const broker = new RedisSSEBroker(bus, bus, { heartbeatSeconds: null });
    const stream = await broker.register("room");
    expect(broker.localSubscribers("room")).toBe(1);

    await broker.publish("room", { hello: true }, "greet");
    const first = await stream.stream().next();
    expect(first.value).toBe(`event: greet\ndata: {"hello":true}\n\n`);

    await broker.unregister("room", stream);
    expect(broker.localSubscribers("room")).toBe(0);
  });
});
