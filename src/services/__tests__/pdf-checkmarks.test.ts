import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { measureAddedCheckmark } from "../../controllers/checkmark-geometry";
import { offsetPDFPoint, pdfToViewport } from "../../controllers/text-geometry";
import type { AddedCheckmark, PageGeometry } from "../../types/interfaces";
import { drawPageAdditions } from "../pdf-additions";

const mark: AddedCheckmark = { id: "mark", x: 70, y: 80, size: 20, rotation: 0 };
const geometry = (unit: number): PageGeometry => ({
  bounds: [-20, -30, 180, 210],
  userUnit: unit,
  width: 200 * unit,
  height: 240 * unit,
  transform: [unit, 0, 0, -unit, 20 * unit, 210 * unit],
});

describe("manual checkmark geometry and native PDF strokes", () => {
  it("bounds the complete rotated square and moves in physical displayed points", () => {
    for (const unit of [1, 1.5, 2])
      for (const intrinsic of [0, 90, 180, 270])
        for (const workspace of [0, 90, 180, 270]) {
          const g = geometry(unit);
          const rotation = (intrinsic + workspace) % 360;
          const measured = measureAddedCheckmark({ ...mark, rotation }, g);
          expect(measured.size * unit).toBe(mark.size);
          expect(measured.points).toHaveLength(3);
          expect(() => measureAddedCheckmark({ ...mark, x: 179, y: 209, rotation: 0 }, g)).toThrow(
            /beyond/
          );
          const before = pdfToViewport(g, rotation, mark.x, mark.y);
          const moved = offsetPDFPoint(g, rotation, mark, 1, -10);
          const after = pdfToViewport(g, rotation, moved.x, moved.y);
          expect(after.x - before.x).toBeCloseTo(1);
          expect(after.y - before.y).toBeCloseTo(-10);
        }
    for (const rotation of [0, 90, 180, 270]) {
      const anchor = [
        [179, 209],
        [-20, 209],
        [-20, -30],
        [179, -30],
      ][rotation / 90];
      expect(() =>
        measureAddedCheckmark({ ...mark, x: anchor[0], y: anchor[1], rotation }, geometry(1))
      ).toThrow(/beyond/);
    }
  });
  it("rejects invalid size, bounds, positions, units, rotations and arithmetic overflow", () => {
    for (const patch of [
      { x: NaN },
      { y: Infinity },
      { size: NaN },
      { size: 0 },
      { size: 145 },
      { rotation: 45 },
      { rotation: Infinity },
    ])
      expect(() => measureAddedCheckmark({ ...mark, ...patch }, geometry(1))).toThrow();
    for (const g of [
      { ...geometry(1), bounds: [-1e308, -30, 1e308, 210] as const },
      { ...geometry(1), userUnit: 1e308 },
      { ...geometry(1), userUnit: Number.MIN_VALUE },
      { ...geometry(1), userUnit: 0 },
      { ...geometry(1), bounds: [0, 0, Infinity, 200] as const },
      { ...geometry(1), bounds: [200, 200, 0, 0] as const },
    ])
      expect(() => measureAddedCheckmark(mark, g)).toThrow();
  });
  it.each([false, true])(
    "rejects overflowing marks before writing output operators, raster=%s",
    async (raster) => {
      const document = await PDFDocument.create();
      const page = document.addPage([400, 480]);
      await expect(
        drawPageAdditions(
          document,
          page,
          {
            id: "page",
            sourceFile: new File(["source"], "source.pdf"),
            sourcePageNumber: 1,
            rotation: 0,
            markedForDeletion: false,
            addedCheckmarks: [mark, { ...mark, id: "overflow", x: 179, y: 209 }],
          },
          geometry(2),
          raster
        )
      ).rejects.toThrow(/beyond/);
      expect(page.node.Contents()).toBeUndefined();
    }
  );

  it("reopens font-free strokes in raw and encrypted-raster coordinate mappings", async () => {
    const document = await PDFDocument.create();
    for (const raster of [false, true]) {
      const page = document.addPage([400, 480]);
      await drawPageAdditions(
        document,
        page,
        {
          id: "page",
          sourceFile: new File(["source"], "source.pdf"),
          sourcePageNumber: 1,
          rotation: 0,
          markedForDeletion: false,
          addedCheckmarks: [mark],
        },
        geometry(2),
        raster
      );
    }
    const reopened = await PDFDocument.load(await document.save());
    for (const [index, page] of reopened.getPages().entries()) {
      expect(page.node.Resources()?.lookup(PDFName.of("Font"), PDFDict).keys()).toEqual([]);
      expect(page.node.Annots()?.size() ?? 0).toBe(0);
      const contents = page.node.Contents();
      if (!(contents instanceof PDFArray)) throw new Error("Missing strokes");
      const stream = contents.lookup(0, PDFRawStream);
      const operators = new TextDecoder().decode(decodePDFRawStream(stream).decode());
      expect(operators.match(/\nS\n/g)).toHaveLength(2);
      expect(operators.match(/1 J/g)).toHaveLength(2);
      expect(operators).not.toMatch(/\b(?:Tj|Tf|Do)\b/);
      expect(operators).toContain(index === 0 ? "71.2 85 m" : "182.4 230 m");
      expect(operators).toContain(index === 0 ? "1 w" : "2 w");
    }
  });
});
