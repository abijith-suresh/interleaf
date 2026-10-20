import { degrees, type PDFDocument, type PDFFont, type PDFPage, StandardFonts } from "pdf-lib";
import { MAX_TEXT_SIZE, MIN_TEXT_SIZE } from "../constants";
import { normalizeQuarterTurn } from "../controllers/text-geometry";
import type { AddedText, PageGeometry } from "../types/interfaces";

export function measureAddedText(text: AddedText, geometry: PageGeometry, font: PDFFont) {
  if (!text.text.trim()) throw new Error("Enter text before saving.");
  if (!/^[\x20-\x7e]+$/.test(text.text)) {
    throw new Error("Use one line of basic Latin letters, numbers, and punctuation.");
  }
  if (
    ![text.x, text.y, text.fontSize, geometry.userUnit, ...geometry.bounds].every(
      Number.isFinite
    ) ||
    geometry.userUnit <= 0
  ) {
    throw new Error("Text position and size must be finite numbers.");
  }
  if (text.fontSize < MIN_TEXT_SIZE || text.fontSize > MAX_TEXT_SIZE) {
    throw new Error(`Choose a size from ${MIN_TEXT_SIZE} to ${MAX_TEXT_SIZE} points.`);
  }
  const rotation = normalizeQuarterTurn(text.rotation);
  const size = text.fontSize / geometry.userUnit;
  // PDF Tj operators use advances without kerning. Helvetica's AFM FontBBox
  // [-166, -225, 1000, 931] conservatively bounds every printable glyph.
  const advances = [...text.text].map((character) => font.widthOfTextAtSize(character, size));
  const width = advances.reduce((sum, advance) => sum + advance, 0);
  const leftBearing = -0.166 * size;
  const rightBearing = width - advances[advances.length - 1] + size;
  const ascent = Math.max(font.heightAtSize(size, { descender: false }), 0.931 * size);
  const descent = Math.max(
    font.heightAtSize(size) - font.heightAtSize(size, { descender: false }),
    0.225 * size
  );
  if (![size, width, ascent, descent, leftBearing, rightBearing].every(Number.isFinite))
    throw new Error("Text position and size must be finite numbers.");
  const cos = [1, 0, -1, 0][rotation / 90];
  const sin = [0, 1, 0, -1][rotation / 90];
  const corners = [
    [leftBearing, -descent],
    [rightBearing, -descent],
    [rightBearing, ascent],
    [leftBearing, ascent],
  ].map(([x, y]) => ({ x: text.x + x * cos - y * sin, y: text.y + x * sin + y * cos }));
  const [left, bottom, right, top] = geometry.bounds;
  if (corners.some(({ x, y }) => x < left || x > right || y < bottom || y > top)) {
    throw new Error("Text extends beyond the page. Move it inward or reduce its size.");
  }
  return { size, width, ascent, descent, corners };
}

export async function validateAddedText(text: AddedText, geometry: PageGeometry) {
  const { PDFDocument } = await import("pdf-lib");
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  return measureAddedText(text, geometry, font);
}

// Raster output has physical-point coordinates with its origin at the visible box.
export async function drawAddedText(
  document: PDFDocument,
  page: PDFPage,
  texts: readonly AddedText[],
  geometry: PageGeometry,
  raster = false
) {
  if (!texts.length) return;
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const text of texts) {
    const { size } = measureAddedText(text, geometry, font);
    page.drawText(text.text, {
      font,
      x: raster ? (text.x - geometry.bounds[0]) * geometry.userUnit : text.x,
      y: raster ? (text.y - geometry.bounds[1]) * geometry.userUnit : text.y,
      size: raster ? text.fontSize : size,
      rotate: degrees(text.rotation),
    });
  }
}
