import type { PDFBounds, PDFFormSuggestion } from "./protocol";

export type Point = readonly [number, number];
export interface FormContour {
  points: Point[];
  closed: boolean;
}
const tolerance = 0.5;
const near = (a: number, b: number) => Math.abs(a - b) <= tolerance;
const same = (a: Point, b: Point) => near(a[0], b[0]) && near(a[1], b[1]);
const horizontal = (a: Point, b: Point) => near(a[1], b[1]);
const vertical = (a: Point, b: Point) => near(a[0], b[0]);
const overlap = (a: number, b: number, c: number, d: number) =>
  Math.min(Math.max(a, b), Math.max(c, d)) - Math.max(Math.min(a, b), Math.min(c, d));

/** Conservative placement hints, never AcroForm fields or a promise that a shape is a field. */
export function suggestFormTargets(
  contours: FormContour[],
  occupied: PDFBounds[],
  width: number,
  height: number
): PDFFormSuggestion[] {
  const seen = new Set<string>();
  contours = contours.filter((contour) => {
    const points = contour.points.filter(
      (point, index) => index === 0 || !same(point, contour.points[0])
    );
    const key = `${contour.closed}:${points
      .map((point) => point.map((coordinate) => Math.round(coordinate * 10)).join(","))
      .sort()
      .join(";")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const edges = contours.flatMap((contour, index) => {
    const points = [...contour.points];
    if (contour.closed && points.length > 1 && !same(points[0], points[points.length - 1]))
      points.push(points[0]);
    return points.slice(1).map((point, i) => ({ index, a: points[i], b: point }));
  });
  const suggestions: PDFFormSuggestion[] = [];
  for (const [index, contour] of contours.entries()) {
    let points = contour.points;
    if (points.length > 1 && same(points[0], points[points.length - 1]))
      points = points.slice(0, -1);
    if (!points.every((point) => point.every(Number.isFinite))) continue;
    let bounds: PDFBounds;
    if (!contour.closed && points.length === 2 && horizontal(points[0], points[1])) {
      const lineWidth = Math.abs(points[1][0] - points[0][0]);
      if (lineWidth < 36 || lineWidth > width * 0.75) continue;
      bounds = {
        x: Math.min(points[0][0], points[1][0]),
        y: points[0][1] - 18,
        width: lineWidth,
        height: 18,
      };
    } else if (contour.closed && points.length === 4) {
      const adjacent = points.map((point, i) => [point, points[(i + 1) % 4]] as const);
      if (!adjacent.every(([a, b]) => horizontal(a, b) !== vertical(a, b))) continue;
      if (!adjacent.every(([a, b], i) => horizontal(a, b) !== horizontal(...adjacent[(i + 1) % 4])))
        continue;
      const xs = points.map((p) => p[0]),
        ys = points.map((p) => p[1]);
      bounds = {
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      };
    } else continue;
    const { x, y, width: w, height: h } = bounds;
    const checkbox = w >= 7 && h >= 7 && w <= 30 && h <= 30 && w / h >= 0.7 && w / h <= 1.4;
    if (!checkbox && (w < 28 || w > width * 0.75 || h < 10 || h > 70 || w / h < 2)) continue;
    if (x < 0 || y < 0 || x + w > width || y + h > height) continue;
    if (
      occupied.some(
        (rect) =>
          overlap(x + 1, x + w - 1, rect.x, rect.x + rect.width) > 0.5 &&
          overlap(y + 1, y + h - 1, rect.y, rect.y + rect.height) > 0.5
      )
    )
      continue;
    // Lines crossing a blank or sharing its borders usually belong to tables, not fields.
    if (
      edges.some(({ index: other, a, b }) => {
        if (other === index) return false;
        if (
          vertical(a, b) &&
          a[0] >= x - tolerance &&
          a[0] <= x + w + tolerance &&
          overlap(a[1], b[1], y, y + h) > tolerance
        )
          return true;
        if (
          horizontal(a, b) &&
          a[1] >= y - tolerance &&
          a[1] <= y + h + tolerance &&
          overlap(a[0], b[0], x, x + w) > tolerance
        )
          return true;
        return false;
      })
    )
      continue;
    if (
      suggestions.some(
        (item) =>
          near(item.bounds.x, x) &&
          near(item.bounds.y, y) &&
          near(item.bounds.width, w) &&
          near(item.bounds.height, h)
      )
    )
      continue;
    suggestions.push({ id: `shape-${index}`, kind: checkbox ? "checkbox" : "text", bounds });
    if (suggestions.length === 100) break;
  }
  return suggestions;
}
