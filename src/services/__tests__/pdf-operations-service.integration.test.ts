import { Effect } from "effect";
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFOperationsService } from "../pdf-operations-service";
import { PDFService } from "../pdf-service";
import { createPageState, createPdfFile } from "./pdf-fixtures";

async function loadPdf(data: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(data);
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function copyBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(value.byteLength));
  copy.set(value);
  return copy;
}

const ONE_PIXEL_PNG = decodeBase64(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
);
const ONE_PIXEL_JPEG = decodeBase64(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/AX//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/AX//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Aqf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/If/Z"
);

const runEffect = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

describe("PDFOperationsService with real PDF documents", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds an output PDF in editor order while skipping deleted pages", async () => {
    const sourceFile = await createPdfFile("source.pdf", [
      { width: 200, height: 300 },
      { width: 400, height: 500, rotation: 90 },
      { width: 600, height: 700 },
    ]);
    const pages = [
      createPageState(sourceFile, 3, { rotation: 270 }),
      createPageState(sourceFile, 1, { markedForDeletion: true }),
      createPageState(sourceFile, 2, { rotation: 90 }),
    ];

    const result = await runEffect(new PDFOperationsService(new PDFService()).buildPDF(pages));
    const output = await loadPdf(result.data);

    expect(result.suggestedFileName).toBe("interleaf-output.pdf");
    expect(output.getPageCount()).toBe(2);
    expect(output.getPages().map((page) => [page.getWidth(), page.getHeight()])).toEqual([
      [600, 700],
      [400, 500],
    ]);
    expect(output.getPages().map((page) => page.getRotation().angle)).toEqual([270, 180]);
  });

  it("merges pages from multiple source files", async () => {
    const firstFile = await createPdfFile("first.pdf", [{ width: 120, height: 240 }]);
    const secondFile = await createPdfFile("second.pdf", [
      { width: 360, height: 480 },
      { width: 600, height: 720 },
    ]);
    const pages = [
      createPageState(firstFile, 1),
      createPageState(secondFile, 2),
      createPageState(secondFile, 1),
    ];

    const result = await runEffect(new PDFOperationsService(new PDFService()).buildPDF(pages));
    const output = await loadPdf(result.data);

    expect(output.getPages().map((page) => [page.getWidth(), page.getHeight()])).toEqual([
      [120, 240],
      [600, 720],
      [360, 480],
    ]);
  });

  it("creates image-sized pages from PNG and JPEG files", async () => {
    const files = [
      new File([copyBytes(ONE_PIXEL_PNG)], "first.png", { type: "image/png" }),
      new File([copyBytes(ONE_PIXEL_JPEG)], "second.jpg", { type: "image/jpeg" }),
    ];
    const onProgress = vi.fn();

    const result = await runEffect(
      new PDFOperationsService(new PDFService()).imagesToPDF(files, { onProgress })
    );
    const output = await loadPdf(result.data);

    expect(result.suggestedFileName).toBe("interleaf-images.pdf");
    expect(output.getPages().map((page) => [page.getWidth(), page.getHeight()])).toEqual([
      [595.28, 841.89],
      [595.28, 841.89],
    ]);
    expect(onProgress.mock.calls).toEqual([
      [{ completed: 1, total: 2 }],
      [{ completed: 2, total: 2 }],
    ]);
  });

  it("exports selected pages in the requested order and reports progress", async () => {
    const sourceFile = await createPdfFile("source.pdf", [
      { width: 100, height: 200 },
      { width: 300, height: 400 },
      { width: 500, height: 600 },
    ]);
    const pages = [
      createPageState(sourceFile, 1),
      createPageState(sourceFile, 2),
      createPageState(sourceFile, 3),
    ];
    const onProgress = vi.fn();

    const result = await runEffect(
      new PDFOperationsService(new PDFService()).buildPDF(pages, {
        selectedIndices: [2, 0],
        onProgress,
      })
    );
    const output = await loadPdf(result.data);

    expect(result.suggestedFileName).toBe("interleaf-output.pdf");
    expect(output.getPages().map((page) => [page.getWidth(), page.getHeight()])).toEqual([
      [500, 600],
      [100, 200],
    ]);
    expect(onProgress.mock.calls).toEqual([
      [{ completed: 1, total: 2 }],
      [{ completed: 2, total: 2 }],
    ]);
  });

  it("reuses a source document until the operation cache is cleared", async () => {
    const sourceFile = await createPdfFile("source.pdf", [{ width: 200, height: 300 }]);
    const page = createPageState(sourceFile, 1);
    const loadSpy = vi.spyOn(PDFDocument, "load");
    const service = new PDFOperationsService(new PDFService());

    await runEffect(service.buildPDF([page]));
    await runEffect(service.buildPDF([page], { selectedIndices: [0] }));

    expect(loadSpy).toHaveBeenCalledTimes(1);

    await runEffect(service.clearCache());
    await runEffect(service.buildPDF([page]));

    expect(loadSpy).toHaveBeenCalledTimes(2);
  });
});
