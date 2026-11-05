import { Deferred, Effect, Fiber } from "effect";
import { unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFNoPagesError } from "../../types/interfaces";
import { IMAGE_EXPORT_MAX_PIXELS, PDFImageExportService } from "../pdf-image-export-service";
import { clampScaleToPixelBudget } from "../render-scale";
import { createPageState } from "./pdf-fixtures";

const renderPage = vi.fn();
const getPageRotation = vi.fn();

describe("PDFImageExportService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getPageRotation.mockImplementation((_file: File, pageNumber: number) =>
      Effect.succeed(pageNumber === 3 ? 90 : 0)
    );
    renderPage.mockImplementation(
      (
        file: File,
        pageNumber: number,
        canvas: HTMLCanvasElement,
        _scale: number,
        rotation: number
      ) =>
        Effect.sync(() => {
          canvas.width = 200;
          canvas.height = 300;
          canvas.dataset.imageBytes = `${file.name}:${pageNumber}:${rotation}`;
        })
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
      this: HTMLCanvasElement,
      callback
    ) {
      callback(new Blob([this.dataset.imageBytes ?? ""], { type: "image/png" }));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exports active pages as ordered PNG files in a ZIP archive", async () => {
    const sourceFile = new File(["source"], "source.pdf", { type: "application/pdf" });
    const progress: Array<{ completed: number; total: number }> = [];
    const service = new PDFImageExportService({ getPageRotation, renderPage });

    const result = await Effect.runPromise(
      service.exportImages(
        [
          createPageState(sourceFile, 1),
          createPageState(sourceFile, 2, { markedForDeletion: true }),
          createPageState(sourceFile, 3, { rotation: 90 }),
        ],
        { onProgress: (nextProgress) => progress.push(nextProgress) }
      )
    );
    const files = unzipSync(new Uint8Array(await result.data.arrayBuffer()));

    expect(Object.keys(files)).toEqual(["page-001.png", "page-002.png"]);
    expect(new TextDecoder().decode(files["page-001.png"])).toBe("source.pdf:1:0");
    expect(new TextDecoder().decode(files["page-002.png"])).toBe("source.pdf:3:180");
    expect(result.suggestedFileName).toBe("source-images.zip");
    expect(progress).toEqual([
      { completed: 1, total: 2 },
      { completed: 2, total: 2 },
    ]);
    expect(renderPage).toHaveBeenNthCalledWith(
      1,
      sourceFile,
      1,
      expect.any(HTMLCanvasElement),
      2,
      0,
      IMAGE_EXPORT_MAX_PIXELS
    );
    expect(renderPage).toHaveBeenNthCalledWith(
      2,
      sourceFile,
      3,
      expect.any(HTMLCanvasElement),
      2,
      180,
      IMAGE_EXPORT_MAX_PIXELS
    );
  });

  it("renders oversized pages within the pixel budget and ordinary pages at scale 2", async () => {
    const sourceFile = new File(["source"], "source.pdf", { type: "application/pdf" });
    const sizes = new Map([
      [1, { width: 2480, height: 3508 }],
      [2, { width: 612, height: 792 }],
    ]);
    const canvasSizes: Array<[number, number]> = [];
    const scales: number[] = [];
    renderPage.mockImplementation(
      (
        _file: File,
        pageNumber: number,
        canvas: HTMLCanvasElement,
        scale: number,
        _rotation: number,
        maxPixels: number
      ) =>
        Effect.sync(() => {
          const size = sizes.get(pageNumber)!;
          const fitted = clampScaleToPixelBudget(scale, size.width, size.height, maxPixels);
          canvas.width = Math.floor(size.width * fitted);
          canvas.height = Math.floor(size.height * fitted);
          canvasSizes.push([canvas.width, canvas.height]);
          scales.push(fitted);
        })
    );
    const service = new PDFImageExportService({ getPageRotation, renderPage });

    await Effect.runPromise(
      service.exportImages([createPageState(sourceFile, 1), createPageState(sourceFile, 2)])
    );

    expect(canvasSizes[0][0] * canvasSizes[0][1]).toBeLessThanOrEqual(IMAGE_EXPORT_MAX_PIXELS);
    expect(scales[0]).toBeLessThan(2);
    expect(canvasSizes[1]).toEqual([1224, 1584]);
    expect(scales[1]).toBe(2);
  });

  it("exports only selected active pages", async () => {
    const sourceFile = new File(["source"], "source.pdf", { type: "application/pdf" });
    const service = new PDFImageExportService({ getPageRotation, renderPage });

    const result = await Effect.runPromise(
      service.exportImages(
        [
          createPageState(sourceFile, 1),
          createPageState(sourceFile, 2, { markedForDeletion: true }),
          createPageState(sourceFile, 3),
          createPageState(sourceFile, 4),
        ],
        { selectedIndices: [2, 1, 0] }
      )
    );

    const files = unzipSync(new Uint8Array(await result.data.arrayBuffer()));
    expect(Object.keys(files)).toEqual(["page-001.png", "page-002.png"]);
    expect(new TextDecoder().decode(files["page-001.png"])).toBe("source.pdf:3:90");
    expect(new TextDecoder().decode(files["page-002.png"])).toBe("source.pdf:1:0");
  });

  it("keeps concurrent runs of the same export effect isolated", async () => {
    const sourceFile = new File(["source"], "source.pdf", { type: "application/pdf" });
    const service = new PDFImageExportService({ getPageRotation, renderPage });
    const exportEffect = service.exportImages([
      createPageState(sourceFile, 1),
      createPageState(sourceFile, 2),
    ]);

    const results = await Promise.all([
      Effect.runPromise(exportEffect),
      Effect.runPromise(exportEffect),
    ]);

    for (const result of results) {
      expect(Object.keys(unzipSync(new Uint8Array(await result.data.arrayBuffer())))).toEqual([
        "page-001.png",
        "page-002.png",
      ]);
    }
  });

  it("cleans the canvas and ignores PNG encoding that finishes after cancellation", async () => {
    const sourceFile = new File(["source"], "source.pdf", { type: "application/pdf" });
    const pending = Deferred.makeUnsafe<BlobCallback>();
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation((callback) => {
      Deferred.doneUnsafe(pending, Effect.succeed(callback));
    });
    const onProgress = vi.fn();
    const service = new PDFImageExportService({ getPageRotation, renderPage });
    const fiber = Effect.runFork(
      service.exportImages([createPageState(sourceFile, 1)], { onProgress })
    );
    const callback = await Effect.runPromise(Deferred.await(pending));
    await Effect.runPromise(Fiber.interrupt(fiber));
    const canvas = renderPage.mock.calls[0][2] as HTMLCanvasElement;
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
    const blob = new Blob(["late PNG"]);
    const read = vi.spyOn(blob, "arrayBuffer");
    callback(blob);
    await Effect.runPromise(Effect.yieldNow);
    expect(read).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("fails when a page cannot be encoded as PNG", async () => {
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation((callback) => callback(null));
    const sourceFile = new File(["source"], "source.pdf", { type: "application/pdf" });
    const service = new PDFImageExportService({ getPageRotation, renderPage });

    await expect(
      Effect.runPromise(service.exportImages([createPageState(sourceFile, 1)]))
    ).rejects.toMatchObject({ operation: "encode-image" });
  });

  it("fails when no pages remain to export", async () => {
    const sourceFile = new File(["source"], "source.pdf", { type: "application/pdf" });
    const service = new PDFImageExportService({ getPageRotation, renderPage });

    await expect(
      Effect.runPromise(
        service.exportImages([createPageState(sourceFile, 1, { markedForDeletion: true })])
      )
    ).rejects.toBeInstanceOf(PDFNoPagesError);
  });
});
