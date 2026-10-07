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
