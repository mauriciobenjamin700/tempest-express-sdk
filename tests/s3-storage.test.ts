import { Readable } from "node:stream";
import { type S3ClientLike, S3UploadStorage } from "@/index";
import { describe, expect, it } from "vitest";

/** An in-memory mock of the MinIO/S3 client surface. */
function mockClient(): S3ClientLike & { store: Map<string, Buffer> } {
  const store = new Map<string, Buffer>();
  return {
    store,
    async putObject(_bucket, key, data) {
      store.set(key, data);
    },
    async getObject(_bucket, key) {
      const data = store.get(key);
      if (!data) throw new Error("not found");
      return Readable.from(data);
    },
    async removeObject(_bucket, key) {
      store.delete(key);
    },
  };
}

describe("S3UploadStorage", () => {
  it("saves, reads and deletes through the client", async () => {
    const client = mockClient();
    const storage = new S3UploadStorage({
      bucket: "uploads",
      publicBaseUrl: "https://cdn.example.com",
      client,
    });

    const result = await storage.save("a/b.txt", Buffer.from("hi"), {
      contentType: "text/plain",
    });
    expect(result).toMatchObject({ key: "a/b.txt", size: 2, contentType: "text/plain" });
    expect(result.url).toBe("https://cdn.example.com/uploads/a/b.txt");
    expect(client.store.has("a/b.txt")).toBe(true);

    expect((await storage.read("a/b.txt")).toString()).toBe("hi");

    await storage.delete("a/b.txt");
    expect(client.store.has("a/b.txt")).toBe(false);
  });

  it("builds a relative url without a public base", () => {
    const storage = new S3UploadStorage({ bucket: "b", client: mockClient() });
    expect(storage.url("k.png")).toBe("/b/k.png");
  });

  it("errors clearly when 'minio' is absent and no client injected", async () => {
    const storage = new S3UploadStorage({ bucket: "b", endPoint: "localhost" });
    await expect(storage.read("x")).rejects.toThrow(/minio/);
  });
});
