import { LineCapStyle, type PDFDocument, type PDFPage, rgb } from "pdf-lib";
import { CHECKMARK_STROKE, measureAddedCheckmark } from "../controllers/checkmark-geometry";
import type { PageGeometry, PageState } from "../types/interfaces";
import { drawAddedText } from "./pdf-text";

// Used by downloads and the ephemeral single-page PDF rendered by PDF.js.
export async function drawPageAdditions(
  document: PDFDocument,
  page: PDFPage,
  state: PageState,
  geometry: PageGeometry,
  raster = false
) {
  // Validate all marks before writing any operators.
  const marks = (state.addedCheckmarks ?? []).map((mark) => measureAddedCheckmark(mark, geometry));
  await drawAddedText(document, page, state.addedText ?? [], geometry, raster);
  for (const mark of marks) {
    const points = mark.points.map(({ x, y }) =>
      raster
        ? {
            x: (x - geometry.bounds[0]) * geometry.userUnit,
            y: (y - geometry.bounds[1]) * geometry.userUnit,
          }
        : { x, y }
    );
    for (let index = 1; index < points.length; index++) {
      page.drawLine({
        start: points[index - 1],
        end: points[index],
        thickness: mark.size * CHECKMARK_STROKE * (raster ? geometry.userUnit : 1),
        color: rgb(0, 0, 0),
        lineCap: LineCapStyle.Round,
      });
    }
  }
}
