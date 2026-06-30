import { MemoryCacheManager, MemorySessionStore, SessionService, cached } from "@/index";
import { describe, expect, it, vi } from "vitest";

describe("MemoryCacheManager", () => {
  it("stores, reads, expires and clears", async () => {
    const cache = new MemoryCacheManager();
    await cache.set("a", { n: 1 });
    expect(await cache.get<{ n: number }>("a")).toEqual({ n: 1 });
    expect(await cache.has("a")).toBe(true);
    await cache.set("b", 2, 0); // already expired
    expect(await cache.get("b")).toBeNull();
    await cache.delete("a");
    expect(await cache.get("a")).toBeNull();
  });
});

describe("cached", () => {
  it("memoizes by derived key", async () => {
    const cache = new MemoryCacheManager();
    const fn = vi.fn(async (id: string) => ({ id, ts: 1 }));
    const memo = cached(fn, { manager: cache, key: (id: string) => `k:${id}` });
    await memo("x");
    await memo("x");
    expect(fn).toHaveBeenCalledTimes(1);
    await memo("y");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("SessionService", () => {
  it("issues, resolves, lists and revokes sessions", async () => {
    const service = new SessionService({ store: new MemorySessionStore() });
    const { token, session } = await service.create("user-1", { role: "user" });
    expect(session.userId).toBe("user-1");

    const resolved = await service.resolve(token);
    expect(resolved?.data.role).toBe("user");

    expect(await service.listByUser("user-1")).toHaveLength(1);

    await service.destroy(token);
    expect(await service.resolve(token)).toBeNull();
  });

  it("does not store the plaintext cookie value", async () => {
    const store = new MemorySessionStore();
    const service = new SessionService({ store });
    const { token, session } = await service.create("user-2");
    expect(session.idHash).not.toBe(token);
    expect(await store.get(token)).toBeNull(); // raw token is not the key
  });
});
