import { describe, expect, it } from "vitest";
import {
  boxStyle,
  closestPageTarget,
  originalPoint,
  rotatedDraftBox,
  rotatePoint,
} from "../pdf-page-geometry";

describe("Displayed PDF coordinates", () => {
  it.each([0, 90, 180, 270])("round trips insertion points at rotation %i", (rotation) => {
    const point = rotatePoint(75, 120, 300, 400, rotation);
    expect(originalPoint(point.x, point.y, 300, 400, rotation)).toEqual({ x: 75, y: 120 });
  });
  it.each([
    [0, { left: "10%", top: "10%", width: "40%", height: "5%" }],
    [90, { left: "85%", top: "10%", width: "5%", height: "40%" }],
    [180, { left: "50%", top: "85%", width: "40%", height: "5%" }],
    [270, { left: "10%", top: "50%", width: "5%", height: "40%" }],
  ] as const)("aligns text bounds at page rotation %i", (rotation, expected) => {
    expect(boxStyle({ x: 30, y: 40, width: 120, height: 20 }, 300, 400, rotation)).toEqual(
      expected
    );
  });
});

describe("Dense page target selection", () => {
  const name = { id: "name", bounds: { x: 100, y: 120, width: 300, height: 16 } };
  const address = { id: "address", bounds: { x: 100, y: 145, width: 300, height: 16 } };
  const city = { id: "city", bounds: { x: 100, y: 170, width: 300, height: 16 } };

  it.each([
    [name, address, city],
    [city, name, address],
    [address, city, name],
  ])("chooses the nearest row when 44px touch areas would overlap", (...rows) => {
    // At half scale these fields are 8px high and only 12.5px apart.
    expect(closestPageTarget(rows, 125, 76.5, 600, 800, 0, 300, 400)).toBe(address);
    expect(closestPageTarget(rows, 125, 72, 600, 800, 0, 300, 400)).toBe(address);
  });

  it("prioritizes a containing field over a nearby field with a closer center", () => {
    const longField = { bounds: { x: 0, y: 0, width: 300, height: 10 } };
    const shortField = { bounds: { x: 290, y: 15, width: 10, height: 10 } };
    expect(closestPageTarget([shortField, longField], 295, 9, 600, 800, 0, 600, 800)).toBe(
      longField
    );
  });

  it("uses the nearest center when field rectangles overlap", () => {
    const first = { bounds: { x: 100, y: 120, width: 300, height: 24 } };
    const second = { bounds: { x: 100, y: 140, width: 300, height: 24 } };
    expect(closestPageTarget([first, second], 125, 71.5, 600, 800, 0, 300, 400)).toBe(second);
  });

  it.each([
    { rotation: 0, x: 125, y: 76.5, cssWidth: 300, cssHeight: 400 },
    { rotation: 90, x: 323.5, y: 125, cssWidth: 400, cssHeight: 300 },
    { rotation: 180, x: 175, y: 323.5, cssWidth: 300, cssHeight: 400 },
    { rotation: 270, x: 76.5, y: 175, cssWidth: 400, cssHeight: 300 },
  ])("selects the displayed row after page rotation $rotation", (display) => {
    expect(
      closestPageTarget(
        [city, name, address],
        display.x,
        display.y,
        600,
        800,
        display.rotation,
        display.cssWidth,
        display.cssHeight
      )
    ).toBe(address);
  });

  it.each([
    { cssWidth: 300, cssHeight: 400, x: 125, y: 39 },
    { cssWidth: 1200, cssHeight: 1600, x: 500, y: 219 },
  ])("keeps the touch radius in screen pixels at width $cssWidth", (display) => {
    expect(
      closestPageTarget(
        [name],
        display.x,
        display.y,
        600,
        800,
        0,
        display.cssWidth,
        display.cssHeight
      )
    ).toBe(name);
    expect(
      closestPageTarget(
        [name],
        display.x,
        display.y - 2,
        600,
        800,
        0,
        display.cssWidth,
        display.cssHeight
      )
    ).toBeUndefined();
  });

  it("ignores missing bounds and rejects a corner outside the circular touch radius", () => {
    const unpositioned = { id: "unpositioned", bounds: undefined };
    expect(closestPageTarget([unpositioned, name], 34, 44, 600, 800, 0, 300, 400)).toBeUndefined();
    expect(closestPageTarget([unpositioned, name], 50, 38, 600, 800, 0, 300, 400)).toBe(name);
  });
});

describe("Draft rotation around the text baseline", () => {
  const draft = { x: 40, y: 60, width: 100, height: 20 };

  it.each([
    [0, { x: 40, y: 60, width: 100, height: 20 }],
    [90, { x: 34, y: 74, width: 20, height: 100 }],
    [180, { x: -60, y: 68, width: 100, height: 20 }],
    [270, { x: 26, y: -26, width: 20, height: 100 }],
    [-90, { x: 26, y: -26, width: 20, height: 100 }],
  ] as const)("keeps the baseline origin fixed for angle %i", (angle, expected) => {
    const result = rotatedDraftBox(draft, angle, 14);
    for (const key of ["x", "y", "width", "height"] as const)
      expect(result[key]).toBeCloseTo(expected[key], 8);
  });

  it("moves the rotated rectangle with its baseline rather than rotating about the box center", () => {
    expect(rotatedDraftBox(draft, 90, 0).x).toBeCloseTo(20);
    expect(rotatedDraftBox(draft, 90, 0).y).toBeCloseTo(60);
    expect(rotatedDraftBox(draft, 90, 20).x).toBeCloseTo(40);
    expect(rotatedDraftBox(draft, 90, 20).y).toBeCloseTo(80);
  });

  it("encloses every corner for a slanted draft", () => {
    const result = rotatedDraftBox(draft, 45, 10);
    expect(result.x).toBeCloseTo(40 - 10 * Math.SQRT1_2, 8);
    expect(result.y).toBeCloseTo(70 - 10 * Math.SQRT1_2, 8);
    expect(result.width).toBeCloseTo(120 * Math.SQRT1_2, 8);
    expect(result.height).toBeCloseTo(120 * Math.SQRT1_2, 8);
  });
});
