// @vitest-environment node
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFNoPagesError } from "../../types/interfaces";
import { PDFOperationsService } from "../pdf-operations-service";
import { PDFService } from "../pdf-service";
import { createJpegFile, createPageState, createPdfFile, createPngFile } from "./pdf-fixtures";
import { createTestEngine, engineClient } from "./pdfium-test-engine";

describe("PDFOperationsService with real WASM", () => {
  let native: Awaited<ReturnType<typeof createTestEngine>>;
  let pdf: PDFService;
  let service: PDFOperationsService;
  beforeEach(async () => {
    native = await createTestEngine();
    pdf = new PDFService(engineClient(native.engine));
    service = new PDFOperationsService(pdf);
  });
  afterEach(async () => {
    await Effect.runPromise(pdf.reset());
    await Effect.runPromise(pdf.dispose());
  });

  it.each([
    { scenario: "no pages", deleted: false, selectedIndices: undefined, emptyWorkspace: true },
    { scenario: "all pages deleted", deleted: true, selectedIndices: undefined },
    { scenario: "no selected pages", deleted: false, selectedIndices: [] },
    { scenario: "indices outside the workspace", deleted: false, selectedIndices: [5] },
    { scenario: "only deleted pages selected", deleted: true, selectedIndices: [0] },
  ])("rejects an export with $scenario", async ({ deleted, selectedIndices, emptyWorkspace }) => {
    const file = await createPdfFile("source.pdf", [{ width: 200, height: 300 }]);
    const pages = emptyWorkspace ? [] : [createPageState(file, 1, { markedForDeletion: deleted })];
    await expect(Effect.runPromise(service.buildPDF(pages, { selectedIndices }))).rejects.toEqual(
      new PDFNoPagesError({ message: "No pages to include in the PDF" })
    );
  });

  it.each([
    { source: 90, added: 90, expected: 180 },
    { source: 270, added: 90, expected: 0 },
  ])(
    "combines rotation $source + $added without mutating the source",
    async ({ source, added, expected }) => {
      const file = await createPdfFile("source.pdf", [
        { width: 200, height: 300, rotation: source },
      ]);
      const result = await Effect.runPromise(
        service.buildPDF([createPageState(file, 1, { rotation: added })])
      );
      const output = native.engine.open(result.data);
      expect(native.engine.info(output.id, 1, 0).rotation).toBe(expected);
      expect(await Effect.runPromise(pdf.getPageRotation(file, 1))).toBe(source);
    }
  );

  it("merges, extracts in selection order, and excludes marked pages", async () => {
    const a = await createPdfFile("a.pdf", [
      { width: 100, height: 200 },
      { width: 150, height: 250 },
    ]);
    const b = await createPdfFile("b.pdf", [{ width: 300, height: 400 }]);
    const pages = [
      createPageState(a, 1),
      createPageState(a, 2, { markedForDeletion: true }),
      createPageState(b, 1),
    ];
    const progress = vi.fn();
    const result = await Effect.runPromise(
      service.buildPDF(pages, { selectedIndices: [2, 0, 1], onProgress: progress })
    );
    const doc = native.engine.open(result.data);
    expect(doc.count).toBe(2);
    expect(native.engine.info(doc.id, 1, 0).width).toBe(300);
    expect(native.engine.info(doc.id, 2, 0).width).toBe(100);
    expect(progress).toHaveBeenCalledWith({ completed: 2, total: 2 });
  });

  it("reorders and extracts within one document", async () => {
    const file = await createPdfFile("source.pdf", [
      { width: 100, height: 200 },
      { width: 150, height: 250 },
      { width: 300, height: 400 },
    ]);
    const result = await Effect.runPromise(
      service.buildPDF([createPageState(file, 3), createPageState(file, 1)])
    );
    const doc = native.engine.open(result.data);
    expect(doc.count).toBe(2);
    expect(native.engine.info(doc.id, 1, 0).width).toBe(300);
    expect(native.engine.info(doc.id, 2, 0).width).toBe(100);
  });

  it("exports edits from the working document instead of rereading the File", async () => {
    const file = await createPdfFile("source.pdf", [{ width: 300, height: 400 }]);
    await Effect.runPromise(
      pdf.editPage(file, 1, {
        kind: "add",
        text: "Working copy",
        x: 20,
        y: 300,
        width: 250,
        fontSize: 12,
      })
    );
    const result = await Effect.runPromise(service.buildPDF([createPageState(file, 1)]));
    const doc = native.engine.open(result.data);
    expect(native.engine.content(doc.id, 1).text[0].text).toBe("Working copy");
  });

  it("converts PNG and JPEG images to correctly oriented A4 pages including EXIF rotation", async () => {
    const result = await Effect.runPromise(
      service.imagesToPDF([createPngFile(), createJpegFile(), createJpegFile("rotated.jpg", true)])
    );
    const doc = native.engine.open(result.data);
    expect(doc.count).toBe(3);
    expect(native.engine.info(doc.id, 1, 0).width).toBeCloseTo(841.89, 1);
    expect(native.engine.info(doc.id, 2, 0).width).toBeCloseTo(595.28, 1);
    expect(native.engine.info(doc.id, 3, 0).width).toBeCloseTo(841.89, 1);
    expect(native.engine.render(doc.id, 1, 0, 0.1).pixels.some((p) => p !== 255)).toBe(true);
  });

  it("rejects empty image sets and unsupported formats", async () => {
    await expect(Effect.runPromise(service.imagesToPDF([]))).rejects.toMatchObject({
      _tag: "PDFProcessingError",
    });
    await expect(
      Effect.runPromise(
        service.imagesToPDF([new File(["svg"], "x.svg", { type: "image/svg+xml" })])
      )
    ).rejects.toMatchObject({ _tag: "PDFProcessingError" });
  });
});
