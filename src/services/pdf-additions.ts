import { LineCapStyle, type PDFDocument, type PDFPage, rgb } from "pdf-lib";
import { CHECKMARK_STROKE, measureAddedCheckmark } from "../controllers/checkmark-geometry";
import type { PageGeometry, PageState } from "../types/interfaces";
import { drawAddedText } from "./pdf-text";

// Used by downloads and the ephemeral single-page PDF rendered by PDF.js.
export async function drawPageAdditions(
  document: PDFDocument,
  page: PDFPage,
  state: PageState,
  geometry: PageGeometry
) {
  // Validate all marks before writing any operators.
  const marks = (state.addedCheckmarks ?? []).map((mark) => measureAddedCheckmark(mark, geometry));
  await drawAddedText(document, page, state.addedText ?? [], geometry);
  for (const { points, size } of marks) {
    for (let index = 1; index < points.length; index++) {
      page.drawLine({
        start: points[index - 1],
        end: points[index],
        thickness: size * CHECKMARK_STROKE,
        color: rgb(0, 0, 0),
        lineCap: LineCapStyle.Round,
      });
    }
  }
}
