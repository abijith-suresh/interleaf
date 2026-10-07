import { describe, expect, it } from "vitest";
import { boxStyle, originalPoint, rotatePoint } from "../pdf-page-geometry";

describe("Displayed PDF coordinates", () => {
  it.each([0, 90, 180, 270])("round trips insertion points at rotation %i", (rotation) => {
    const point = rotatePoint(75, 120, 300, 400, rotation);
    expect(originalPoint(point.x, point.y, 300, 400, rotation)).toEqual({ x: 75, y: 120 });
  });
  it("aligns a rotated text area to its displayed corner and width", () => {
    expect(boxStyle({ x: 30, y: 40, width: 120, height: 20 }, 300, 400, 90)).toEqual({
      left: "85%",
      top: "10%",
      width: "5%",
      height: "40%",
    });
  });
});
