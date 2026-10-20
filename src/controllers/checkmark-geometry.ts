import type { AddedCheckmark, PageGeometry } from "../types/interfaces";
import { normalizeQuarterTurn } from "./text-geometry";

export const MIN_CHECKMARK_SIZE = 6;
export const MAX_CHECKMARK_SIZE = 144;
export const CHECKMARK_POINTS = [
  [0.12, 0.5],
  [0.38, 0.22],
  [0.88, 0.85],
] as const;
export const CHECKMARK_STROKE = 0.1;

export function measureAddedCheckmark(mark: AddedCheckmark, geometry: PageGeometry) {
  if (
    ![mark.x, mark.y, mark.size, geometry.userUnit, ...geometry.bounds].every(Number.isFinite) ||
    geometry.userUnit <= 0
  )
    throw new Error("Checkmark position and size must be finite numbers.");
  if (mark.size < MIN_CHECKMARK_SIZE || mark.size > MAX_CHECKMARK_SIZE)
    throw new Error(`Choose a size from ${MIN_CHECKMARK_SIZE} to ${MAX_CHECKMARK_SIZE} points.`);
  const rotation = normalizeQuarterTurn(mark.rotation);
  const size = mark.size / geometry.userUnit;
  if (!Number.isFinite(size))
    throw new Error("Checkmark position and size must be finite numbers.");
  const cos = [1, 0, -1, 0][rotation / 90];
  const sin = [0, 1, 0, -1][rotation / 90];
  const transform = (x: number, y: number) => ({
    x: mark.x + size * (x * cos - y * sin),
    y: mark.y + size * (x * sin + y * cos),
  });
  // The whole square conservatively includes round caps and joins at every rotation.
  const corners = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ].map(([x, y]) => transform(x, y));
  const [left, bottom, right, top] = geometry.bounds;
  if (
    ![
      geometry.width,
      geometry.height,
      (right - left) * geometry.userUnit,
      (top - bottom) * geometry.userUnit,
      ...corners.flatMap(({ x, y }) => [
        (x - left) * geometry.userUnit,
        (y - bottom) * geometry.userUnit,
      ]),
    ].every(Number.isFinite)
  )
    throw new Error("Checkmark position and size must be finite numbers.");
  if (
    left >= right ||
    bottom >= top ||
    corners.some(
      ({ x, y }) =>
        !Number.isFinite(x) || !Number.isFinite(y) || x < left || x > right || y < bottom || y > top
    )
  )
    throw new Error("Checkmark extends beyond the page. Move it inward or reduce its size.");
  return { size, corners, points: CHECKMARK_POINTS.map(([x, y]) => transform(x, y)) };
}
