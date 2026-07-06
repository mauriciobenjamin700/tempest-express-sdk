import {
  buildPaginationLinkHeader,
  centsField,
  hexColorField,
  latitudeField,
  logEntrySchema,
  nonEmptyStrField,
  percentField,
  priceField,
  slugField,
  syncFilterSchema,
  syncPaginationSchema,
  z,
} from "@/index";
import { describe, expect, it } from "vitest";

describe("field types", () => {
  it("validates numeric bounds", () => {
    expect(centsField.parse(1000)).toBe(1000);
    expect(() => centsField.parse(-1)).toThrow();
    expect(() => centsField.parse(1.5)).toThrow();
    expect(percentField.parse(50)).toBe(50);
    expect(() => percentField.parse(101)).toThrow();
    expect(latitudeField.parse(-89.9)).toBe(-89.9);
    expect(() => latitudeField.parse(91)).toThrow();
  });

  it("validates string fields", () => {
    expect(nonEmptyStrField.parse("  hi  ")).toBe("hi");
    expect(() => nonEmptyStrField.parse("   ")).toThrow();
    expect(slugField.parse("my-slug-1")).toBe("my-slug-1");
    expect(() => slugField.parse("Not a Slug")).toThrow();
    expect(hexColorField.parse("#0af")).toBe("#0af");
    expect(hexColorField.parse("#00aaff")).toBe("#00aaff");
    expect(() => hexColorField.parse("00aaff")).toThrow();
  });

  it("validates price strings (exact decimal)", () => {
    expect(priceField.parse("19.90")).toBe("19.90");
    expect(priceField.parse("100")).toBe("100");
    expect(() => priceField.parse("19.905")).toThrow();
    expect(() => priceField.parse("abc")).toThrow();
  });
});

describe("delta-sync schemas", () => {
  it("parses a filter with defaults and coercions", () => {
    const f = syncFilterSchema.parse({ since: "2026-07-06T00:00:00Z", limit: "50" });
    expect(f.since).toBeInstanceOf(Date);
    expect(f.limit).toBe(50);
    expect(f.includeDeleted).toBe(false);
  });

  it("builds a typed sync envelope", () => {
    const schema = syncPaginationSchema(z.object({ id: z.string() }));
    const page = schema.parse({
      items: [{ id: "1" }],
      nextCursor: null,
      hasMore: false,
      limit: 100,
      serverTime: "2026-07-06T00:00:00Z",
    });
    expect(page.items).toHaveLength(1);
    expect(page.serverTime).toBeInstanceOf(Date);
  });
});

describe("buildPaginationLinkHeader", () => {
  it("emits first/prev/next/last, omitting ends", () => {
    const header = buildPaginationLinkHeader({
      baseUrl: "/api/users?active=true",
      page: 2,
      pageSize: 20,
      pages: 5,
    });
    expect(header).toContain('rel="first"');
    expect(header).toContain('rel="last"');
    expect(header).toContain('rel="prev"');
    expect(header).toContain('rel="next"');
    expect(header).toContain("active=true");
    expect(header).toContain("page=3");
  });

  it("omits prev on the first page and returns empty for no pages", () => {
    const first = buildPaginationLinkHeader({
      baseUrl: "/x",
      page: 1,
      pageSize: 10,
      pages: 3,
    });
    expect(first).not.toContain('rel="prev"');
    expect(first).toContain('rel="next"');
    expect(
      buildPaginationLinkHeader({ baseUrl: "/x", page: 1, pageSize: 10, pages: 0 }),
    ).toBe("");
  });
});

describe("logEntrySchema", () => {
  it("validates a record and preserves extra keys", () => {
    const entry = logEntrySchema.parse({
      timestamp: "2026-07-06T00:00:00.000Z",
      level: "INFO",
      logger: "app",
      message: "hi",
      requestId: "abc",
      path: "/x", // extra key preserved
    });
    expect(entry.level).toBe("INFO");
    expect((entry as Record<string, unknown>).path).toBe("/x");
  });
});
