import { describe, expect, it } from "vitest";
import { PDFReadCache } from "../pdfium/cache";

describe("bounded PDF read cache", () => {
  it("evicts by retained memory, keeps recently used entries, and excludes oversized pages", () => {
    const cache = new PDFReadCache<string>(10, 10);
    cache.set("1:1", "first", 4);
    cache.set("2:1", "second", 4);
    expect(cache.get("1:1")).toBe("first");
    cache.set("1:2", "third", 4);
    expect(cache.get("2:1")).toBeUndefined();
    expect(cache.get("1:1")).toBe("first");
    cache.set("1:3", "oversized", 11);
    expect(cache.get("1:3")).toBeUndefined();
  });

  it("bounds small metadata entries and invalidates only the changed source", () => {
    const cache = new PDFReadCache<string>(1000, 2);
    cache.set("1:1", "a", 1);
    cache.set("2:1", "b", 1);
    cache.set("1:2", "c", 1);
    expect(cache.get("1:1")).toBeUndefined();
    cache.invalidate(1);
    expect(cache.get("1:2")).toBeUndefined();
    expect(cache.get("2:1")).toBe("b");
    cache.clear();
    expect(cache.get("2:1")).toBeUndefined();
  });
});
