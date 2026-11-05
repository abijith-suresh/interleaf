/** Largest scale that keeps a width x height page within a pixel budget. */
export function clampScaleToPixelBudget(
  scale: number,
  width: number,
  height: number,
  maxPixels: number
): number {
  const area = width * height;
  if (!(area > 0) || !(maxPixels > 0)) return scale;
  return Math.min(scale, Math.sqrt(maxPixels / area));
}
