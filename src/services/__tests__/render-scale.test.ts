import { describe, expect, it } from "vitest";
import { clampScaleToPixelBudget } from "../render-scale";

describe("clampScaleToPixelBudget", () => {
  it("keeps the requested scale when the page fits the budget", () => {
    expect(clampScaleToPixelBudget(2, 612, 792, 16_000_000)).toBe(2);
    expect(clampScaleToPixelBudget(0.5, 612, 792, 1_000_000)).toBe(0.5);
  });

  it("reduces the scale so the rendered area stays within the budget", () => {
    const scale = clampScaleToPixelBudget(2, 2480, 3508, 16_000_000);
    expect(scale).toBeLessThan(2);
    expect(Math.floor(2480 * scale) * Math.floor(3508 * scale)).toBeLessThanOrEqual(16_000_000);
  });

  it("leaves the scale alone for degenerate sizes or budgets", () => {
    expect(clampScaleToPixelBudget(2, 0, 100, 1_000)).toBe(2);
    expect(clampScaleToPixelBudget(2, 100, 100, 0)).toBe(2);
  });
});
