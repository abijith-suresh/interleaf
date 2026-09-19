import { Effect } from "effect";
import { unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PageState } from "../../types/interfaces";
import { PDFNoPagesError } from "../../types/interfaces";
import { PDFImageExportService } from "../pdf-image-export-service";

const renderPage = vi.fn();
const getPageRotation = vi.fn();
const originalToBlob = HTMLCanvasElement.prototype.toBlob;

function makePage(
  sourceFile: File,
  sourcePageNumber: number,
  overrides: Partial<PageState> = {}
): PageState {
  return {
    id: `${sourceFile.name}-${sourcePageNumber}`,
    sourceFile,
    sourcePageNumber,
    rotation: 0,
    markedForDeletion: false,
    ...overrides,
  };
}

describe("PDFImageExportService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPageRotation.mockImplementation((_file: File, pageNumber: number) =>
      Effect.succeed(pageNumber === 3 ? 90 : 0)
    );
    renderPage.mockImplementation((_file: File, _pageNumber: number, canvas: HTMLCanvasElement) =>
      Effect.sync(() => {
        canvas.width = 200;
        canvas.height = 300;
      })
    );
    Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
      configurable: true,
      value: (callback: BlobCallback) => callback(new Blob(["png-bytes"], { type: "image/png" })),
    });
  });

  afterEach(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
      configurable: true,
      value: originalToBlob,
    });
  });

  it("exports active pages as ordered PNG files in a ZIP archive", async () => {
    const sourceFile = new File(["source"], "source.pdf", { type: "application/pdf" });
    const progress: Array<{ completed: number; total: number }> = [];
    const service = new PDFImageExportService({ getPageRotation, renderPage });

    const result = await Effect.runPromise(
      service.exportImages(
        [
          makePage(sourceFile, 1),
          makePage(sourceFile, 2, { markedForDeletion: true }),
          makePage(sourceFile, 3, { rotation: 90 }),
        ],
        { onProgress: (nextProgress) => progress.push(nextProgress) }
      )
    );
    const files = unzipSync(new Uint8Array(await result.data.arrayBuffer()));

    expect(Object.keys(files)).toEqual(["page-001.png", "page-002.png"]);
    expect(new TextDecoder().decode(files["page-001.png"])).toBe("png-bytes");
    expect(new TextDecoder().decode(files["page-002.png"])).toBe("png-bytes");
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
      0
    );
    expect(renderPage).toHaveBeenNthCalledWith(
      2,
      sourceFile,
      3,
      expect.any(HTMLCanvasElement),
      2,
      180
    );
  });

  it("exports only selected active pages", async () => {
    const sourceFile = new File(["source"], "source.pdf", { type: "application/pdf" });
    const service = new PDFImageExportService({ getPageRotation, renderPage });

    const result = await Effect.runPromise(
      service.exportImages(
        [makePage(sourceFile, 1), makePage(sourceFile, 2), makePage(sourceFile, 3)],
        { selectedIndices: [0, 2] }
      )
    );

    expect(renderPage.mock.calls.map((call) => call[1])).toEqual([1, 3]);
    expect(Object.keys(unzipSync(new Uint8Array(await result.data.arrayBuffer())))).toEqual([
      "page-001.png",
      "page-002.png",
    ]);
  });

  it("keeps concurrent runs of the same export effect isolated", async () => {
    const sourceFile = new File(["source"], "source.pdf", { type: "application/pdf" });
    const service = new PDFImageExportService({ getPageRotation, renderPage });
    const exportEffect = service.exportImages([makePage(sourceFile, 1), makePage(sourceFile, 2)]);

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

  it("fails when a page cannot be encoded as PNG", async () => {
    Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
      configurable: true,
      value: (callback: BlobCallback) => callback(null),
    });
    const sourceFile = new File(["source"], "source.pdf", { type: "application/pdf" });
    const service = new PDFImageExportService({ getPageRotation, renderPage });

    await expect(
      Effect.runPromise(service.exportImages([makePage(sourceFile, 1)]))
    ).rejects.toMatchObject({ operation: "encode-image" });
  });

  it("fails when no pages remain to export", async () => {
    const sourceFile = new File(["source"], "source.pdf", { type: "application/pdf" });
    const service = new PDFImageExportService({ getPageRotation, renderPage });

    await expect(
      Effect.runPromise(
        service.exportImages([makePage(sourceFile, 1, { markedForDeletion: true })])
      )
    ).rejects.toBeInstanceOf(PDFNoPagesError);
  });
});
