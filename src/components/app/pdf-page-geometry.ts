export interface PageBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Crop-relative, top-left coordinates; clockwise rotation matches PDFium rendering. */
export function rotatePoint(x: number, y: number, width: number, height: number, rotation: number) {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return { x: height - y, y: x };
    case 180:
      return { x: width - x, y: height - y };
    case 270:
      return { x: y, y: width - x };
    default:
      return { x, y };
  }
}
export function boxStyle(box: PageBox, width: number, height: number, rotation: number) {
  const corners = [
    rotatePoint(box.x, box.y, width, height, rotation),
    rotatePoint(box.x + box.width, box.y + box.height, width, height, rotation),
  ];
  const swapped = rotation % 180 !== 0;
  const w = swapped ? height : width,
    h = swapped ? width : height;
  return {
    left: `${(Math.min(corners[0].x, corners[1].x) / w) * 100}%`,
    top: `${(Math.min(corners[0].y, corners[1].y) / h) * 100}%`,
    width: `${(Math.abs(corners[0].x - corners[1].x) / w) * 100}%`,
    height: `${(Math.abs(corners[0].y - corners[1].y) / h) * 100}%`,
  };
}
export function originalPoint(
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: number
) {
  return rotatePoint(
    x,
    y,
    rotation % 180 ? height : width,
    rotation % 180 ? width : height,
    360 - rotation
  );
}

/** Resolve nearby small targets by proximity, without overlapping enlarged DOM hit areas. */
export function closestPageTarget<T extends { bounds?: PageBox }>(
  targets: readonly T[],
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: number,
  cssWidth: number,
  cssHeight: number,
  radius = 22
): T | undefined {
  let nearest: T | undefined,
    distance = Number.POSITIVE_INFINITY,
    center = Number.POSITIVE_INFINITY;
  for (const item of targets) {
    if (!item.bounds) continue;
    const style = boxStyle(item.bounds, width, height, rotation);
    const left = (Number.parseFloat(style.left) * cssWidth) / 100,
      top = (Number.parseFloat(style.top) * cssHeight) / 100;
    const w = (Number.parseFloat(style.width) * cssWidth) / 100,
      h = (Number.parseFloat(style.height) * cssHeight) / 100;
    const d = Math.hypot(Math.max(left - x, 0, x - left - w), Math.max(top - y, 0, y - top - h));
    const c = Math.hypot(x - left - w / 2, y - top - h / 2);
    if (d <= radius && (d < distance || (d === distance && c < center))) {
      nearest = item;
      distance = d;
      center = c;
    }
  }
  return nearest;
}

/** Added text rotates about its baseline origin in the page's top-left coordinate space. */
export function rotatedDraftBox(box: PageBox, angle: number, baseline: number): PageBox {
  const radians = (angle * Math.PI) / 180,
    cos = Math.cos(radians),
    sin = Math.sin(radians);
  const anchorY = box.y + baseline;
  const points = [
    [0, -baseline],
    [box.width, -baseline],
    [box.width, box.height - baseline],
    [0, box.height - baseline],
  ].map(([x, y]) => ({ x: box.x + x * cos - y * sin, y: anchorY + x * sin + y * cos }));
  const left = Math.min(...points.map((p) => p.x)),
    top = Math.min(...points.map((p) => p.y));
  return {
    x: left,
    y: top,
    width: Math.max(...points.map((p) => p.x)) - left,
    height: Math.max(...points.map((p) => p.y)) - top,
  };
}
