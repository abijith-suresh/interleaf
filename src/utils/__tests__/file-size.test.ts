import { describe, expect, it } from "vitest";
import { formatSavedPercent, formatSizeChange } from "../file-size";

const MB = 1024 * 1024;

describe("formatSizeChange", () => {
  it("shows both sizes in the larger size's unit", () => {
    expect(formatSizeChange(1.2 * MB, 0.8 * MB)).toBe("1.2 MB → 0.8 MB");
    expect(formatSizeChange(420 * 1024, 310 * 1024)).toBe("420 KB → 310 KB");
    expect(formatSizeChange(10, 2)).toBe("10 B → 2 B");
  });

  it("falls back to the smaller size's own unit when it would round to zero", () => {
    expect(formatSizeChange(3 * MB, 20 * 1024)).toBe("3.0 MB → 20 KB");
    expect(formatSizeChange(4096, 100)).toBe("4 KB → 100 B");
  });
});

describe("formatSavedPercent", () => {
  it("rounds the reduction and never reports a real saving as 0%", () => {
    expect(formatSavedPercent(100, 66)).toBe("34%");
    expect(formatSavedPercent(10_000, 9_990)).toBe("1%");
    expect(formatSavedPercent(100, 100)).toBe("0%");
  });
});
