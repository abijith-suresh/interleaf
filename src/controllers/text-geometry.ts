import type { PageGeometry } from "../types/interfaces";

export function normalizeQuarterTurn(rotation: number): number {
  if (!Number.isFinite(rotation) || rotation % 90 !== 0) {
    throw new Error("Rotation must use 90-degree steps.");
  }
  return ((rotation % 360) + 360) % 360;
}

export function pageTransform(geometry: PageGeometry, rotation: number) {
  const [a, b, c, d, e, f] = geometry.transform;
  switch (normalizeQuarterTurn(rotation)) {
    case 90:
      return [-b, a, -d, c, geometry.height - f, e] as const;
    case 180:
      return [-a, -b, -c, -d, geometry.width - e, geometry.height - f] as const;
    case 270:
      return [b, -a, d, -c, f, geometry.width - e] as const;
    default:
      return geometry.transform;
  }
}

export function pdfToViewport(geometry: PageGeometry, rotation: number, x: number, y: number) {
  const [a, b, c, d, e, f] = pageTransform(geometry, rotation);
  return { x: a * x + c * y + e, y: b * x + d * y + f };
}

export function viewportToPDF(geometry: PageGeometry, rotation: number, x: number, y: number) {
  const [a, b, c, d, e, f] = pageTransform(geometry, rotation);
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || determinant === 0)
    throw new Error("Page geometry is invalid.");
  return {
    x: (d * (x - e) - c * (y - f)) / determinant,
    y: (-b * (x - e) + a * (y - f)) / determinant,
  };
}
