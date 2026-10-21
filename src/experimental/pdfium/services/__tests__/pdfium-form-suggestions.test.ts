// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { suggestFormTargets } from "../pdfium/form-suggestions";
import { createPdfBytes, createPngFile, formBytes } from "./pdf-fixtures";
import { createTestEngine } from "./pdfium-test-engine";

function drawings(content: string, rotation = 0, nested = false) {
  const drawing = nested ? "q 1 0 0 1 50 100 cm /Outer Do Q" : content;
  const inner = `<< /Type /XObject /Subtype /Form /BBox [0 0 250 300] /Matrix [1 0 0 1 10 20] /Resources << /Font << /F1 5 0 R >> >> /Length ${content.length} >>\nstream\n${content}\nendstream`;
  const outer = "q 2 0 0 2 0 0 cm /Inner Do Q";
  return createPdfBytes([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 600] /CropBox [50 70 450 570] /Rotate ${rotation} /Resources << /Font << /F1 5 0 R >> ${nested ? "/XObject << /Outer 6 0 R >>" : ""} >> /Contents 4 0 R >>`,
    `<< /Length ${drawing.length} >>\nstream\n${drawing}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Type /XObject /Subtype /Form /BBox [0 0 400 500] /Resources << /XObject << /Inner 7 0 R >> >> /Length ${outer.length} >>\nstream\n${outer}\nendstream`,
    inner,
  ]);
}

describe("PDFium flat form drawing suggestions", () => {
  let native: Awaited<ReturnType<typeof createTestEngine>>;
  beforeEach(async () => {
    native = await createTestEngine();
  });
  afterEach(() => native.engine.dispose());

  it.each([0, 90, 180, 270])(
    "locates blank boxes and underlines within a nonzero CropBox at rotation %i",
    (rotation) => {
      const doc = native.engine.open(
        drawings("0.5 w 80 400 150 25 re S 80 340 12 12 re S 80 300 m 220 300 l S", rotation)
      );
      expect(native.engine.content(doc.id, 1).suggestions).toEqual([
        { id: "shape-0", kind: "text", bounds: { x: 30, y: 145, width: 150, height: 25 } },
        { id: "shape-1", kind: "checkbox", bounds: { x: 30, y: 218, width: 12, height: 12 } },
        { id: "shape-2", kind: "text", bounds: { x: 30, y: 252, width: 140, height: 18 } },
      ]);
    }
  );

  it("composes transforms through nested Form XObjects", () => {
    const doc = native.engine.open(drawings("0.5 w 20 150 60 12 re S", 90, true));
    expect(native.engine.content(doc.id, 1).suggestions).toEqual([
      { id: "shape-0", kind: "text", bounds: { x: 60, y: 106, width: 120, height: 24 } },
    ]);
  });

  it("excludes text inside a nested Form XObject and existing interactive widgets", () => {
    const nested = native.engine.open(
      drawings("0.5 w 20 150 60 12 re S BT /F1 8 Tf 22 153 Td (Occupied) Tj ET", 90, true)
    );
    expect(native.engine.content(nested.id, 1).suggestions).toEqual([]);
    const stream = "80 400 150 25 re S";
    const interactive = native.engine.open(
      createPdfBytes([
        "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [6 0 R] /DR << /Font << /Helv 5 0 R >> >> /DA (/Helv 12 Tf 0 g) >> >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 600] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R /Annots [6 0 R] >>",
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        "<< /Type /Annot /Subtype /Widget /FT /Tx /T (Answer) /V () /Rect [80 400 230 425] /P 3 0 R /F 4 /DA (/Helv 12 Tf 0 g) >>",
      ])
    );
    expect(native.engine.content(interactive.id, 1).fields).toHaveLength(1);
    expect(native.engine.content(interactive.id, 1).suggestions).toEqual([]);
  });

  it("excludes clipped shapes and stroked underlined printed text", () => {
    const clipped = native.engine.open(drawings("q 80 400 40 10 re W n 80 400 150 25 re S Q"));
    expect(native.engine.content(clipped.id, 1).suggestions).toEqual([]);
    const underlined = native.engine.open(
      drawings("80 400 m 220 400 l S BT /F1 12 Tf 80 402 Td (Existing answer) Tj ET")
    );
    expect(native.engine.content(underlined.id, 1).suggestions).toEqual([]);
  });

  it("rejects occupied rectangles, table grids, filled art, frames, curves, and slanted shapes", () => {
    const doc = native.engine.open(
      drawings(
        [
          "80 400 150 25 re S BT /F1 12 Tf 90 410 Td (Filled) Tj ET",
          "80 300 120 20 re S 200 300 120 20 re S",
          "80 250 m 300 250 l S 80 230 m 80 270 l S 300 230 m 300 270 l S",
          "80 200 120 20 re f",
          "55 75 390 490 re S",
          "80 130 m 200 130 l 210 150 l 90 150 l h S",
          "80 100 m 100 90 180 90 200 100 c S",
          "80 80 1 1 re S",
        ].join("\n")
      )
    );
    expect(native.engine.content(doc.id, 1).suggestions).toEqual([]);
  });

  it("excludes native fields and stops suggesting a box after its answer is saved", () => {
    const doc = native.engine.open(drawings("80 400 150 25 re S"));
    expect(native.engine.content(doc.id, 1).suggestions).toHaveLength(1);
    native.engine.edit(doc.id, 1, {
      kind: "add",
      text: "Answer",
      x: 34,
      y: 337,
      width: 140,
      fontSize: 12,
    });
    expect(native.engine.content(doc.id, 1).suggestions).toEqual([]);
    expect(native.engine.content(native.engine.open(formBytes()).id, 1).suggestions).toEqual([]);
  });

  it("does not infer boxes from scanned image pixels", async () => {
    const bytes = new Uint8Array(await createPngFile().arrayBuffer());
    const doc = native.engine.open(native.engine.images([{ bytes, kind: "png", orientation: 1 }]));
    expect(native.engine.content(doc.id, 1).suggestions).toEqual([]);
  });

  it("fails softly on invalid drawing APIs and refuses partial over-budget analysis", () => {
    const doc = native.engine.open(drawings("80 400 150 25 re S"));
    const segment = vi.spyOn(native.api, "FPDFPath_GetPathSegment").mockReturnValue(0);
    expect(native.engine.content(doc.id, 1).suggestions).toEqual([]);
    segment.mockRestore();
    const many = native.engine.open(drawings("80 400 150 25 re S\n".repeat(3001)));
    expect(native.engine.content(many.id, 1).suggestions).toEqual([]);
  });
});

it("deduplicates equivalent blank rectangles and rejects geometrical artwork", () => {
  const rectangle = {
    points: [
      [10, 10],
      [110, 10],
      [110, 30],
      [10, 30],
    ] as [number, number][],
    closed: true,
  };
  expect(suggestFormTargets([rectangle, rectangle], [], 300, 400)).toHaveLength(1);
  expect(
    suggestFormTargets(
      [
        {
          points: [
            [10, 10],
            [110, 10],
            [110, 30],
            [90, 30],
            [10, 10],
          ],
          closed: true,
        },
      ],
      [],
      300,
      400
    )
  ).toEqual([]);
});
