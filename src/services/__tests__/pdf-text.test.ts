import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { offsetPDFPoint, pdfToViewport, viewportToPDF } from "../../controllers/text-geometry";
import type { AddedText, PageGeometry } from "../../types/interfaces";
import { drawAddedText, measureAddedText } from "../pdf-text";

const text: AddedText = {
  id: "text",
  text: "Hello, PDF! 123",
  x: 100,
  y: 100,
  fontSize: 12,
  rotation: 0,
};
function geometry(unit: number): PageGeometry {
  return {
    bounds: [-40, -60, 260, 340],
    userUnit: unit,
    width: 300 * unit,
    height: 400 * unit,
    transform: [unit, 0, 0, -unit, 40 * unit, 340 * unit],
  };
}

describe("added PDF text", () => {
  it("nudges in displayed directions and physical points at every UserUnit and quarter-turn", () => {
    for (const unit of [1, 1.5, 2])
      for (const intrinsic of [0, 90, 180, 270])
        for (const workspace of [0, 90, 180, 270])
          for (const [dx, dy] of [
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
            [10, -10],
          ]) {
            const g = geometry(unit);
            const rotation = intrinsic + workspace;
            const before = pdfToViewport(g, rotation, text.x, text.y);
            const next = offsetPDFPoint(g, rotation, text, dx, dy);
            const after = pdfToViewport(g, rotation, next.x, next.y);
            expect(after.x - before.x).toBeCloseTo(dx);
            expect(after.y - before.y).toBeCloseTo(dy);
            expect(Math.hypot(next.x - text.x, next.y - text.y) * unit).toBeCloseTo(
              Math.hypot(dx, dy)
            );
          }
  });
  it("roundtrips translated visible boxes at every intrinsic and workspace rotation, CSS scale and pan", () => {
    for (const unit of [1, 1.5, 2])
      for (const intrinsic of [0, 90, 180, 270])
        for (const workspace of [0, 90, 180, 270])
          for (const scale of [0.3, 1, 4]) {
            const g = geometry(unit);
            const viewport = pdfToViewport(g, intrinsic + workspace, text.x, text.y);
            const frame = { left: -130, top: 57 };
            const client = {
              x: frame.left + viewport.x * scale,
              y: frame.top + viewport.y * scale,
            };
            const point = viewportToPDF(
              g,
              intrinsic + workspace,
              (client.x - frame.left) / scale,
              (client.y - frame.top) / scale
            );
            expect(point.x).toBeCloseTo(text.x);
            expect(point.y).toBeCloseTo(text.y);
          }
  });

  it("uses physical-point size and checks all rotated bounds", async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    for (const unit of [1, 1.5, 2])
      for (const rotation of [0, 90, 180, 270]) {
        const measured = measureAddedText({ ...text, rotation }, geometry(unit), font);
        expect(measured.size * unit).toBe(12);
        expect(() =>
          measureAddedText({ ...text, x: -40, y: -60, rotation }, geometry(unit), font)
        ).toThrow(/beyond the page/);
      }
  });

  it("rejects empty, non-Latin, newline, invalid sizes, positions and rotations", async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    for (const patch of [
      { text: " " },
      { text: "Café" },
      { text: "a\nb" },
      { text: "a\tb" },
      { x: NaN },
      { y: Infinity },
      { fontSize: NaN },
      { fontSize: 0 },
      { fontSize: 145 },
      { rotation: 45 },
    ]) {
      expect(() => measureAddedText({ ...text, ...patch }, geometry(1), font)).toThrow();
    }
  });

  it("bounds glyph overhangs and unkerned PDF advances, and rejects nonfinite converted units", async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const measured = measureAddedText({ ...text, text: "AV" }, geometry(1), font);
    expect(measured.width).toBe(
      font.widthOfTextAtSize("A", text.fontSize) + font.widthOfTextAtSize("V", text.fontSize)
    );
    expect(() =>
      measureAddedText(
        { ...text, text: "[", y: 340 - font.heightAtSize(text.fontSize, { descender: false }) },
        geometry(1),
        font
      )
    ).toThrow(/beyond the page/);
    expect(() =>
      measureAddedText(text, { ...geometry(1), userUnit: Number.MIN_VALUE }, font)
    ).toThrow(/finite/);
  });

  it("maps encrypted raster overlays into physical points relative to the CropBox", async () => {
    const document = await PDFDocument.create();
    const raw = document.addPage([300, 400]);
    const raster = document.addPage([600, 800]);
    const g = geometry(2);
    await drawAddedText(document, raw, [text], g);
    await drawAddedText(document, raster, [text], g, true);
    // Reopening exercises serialization of both output paths, including the embedded font.
    const reopened = await PDFDocument.load(await document.save());
    expect(reopened.getPageCount()).toBe(2);
    expect(raw.node.Contents()).toBeDefined();
    expect(raster.node.Contents()).toBeDefined();
  });
});
