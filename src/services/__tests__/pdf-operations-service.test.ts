import { Effect } from "effect";
import { PDFDocument, PDFPage } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFNoPagesError } from "../../types/interfaces";
import { PDFOperationsService } from "../pdf-operations-service";
import { createJpegFile, createPageState, createPdfFile, createPngFile } from "./pdf-fixtures";

describe("PDFOperationsService", () => {
  let service: PDFOperationsService;
  const renderPage = vi.fn(() => Effect.void);

  beforeEach(() => {
    renderPage.mockReset();
    renderPage.mockReturnValue(Effect.void);
    service = new PDFOperationsService({ renderPage });
  });

  afterEach(async () => {
    await Effect.runPromise(service.dispose());
    vi.restoreAllMocks();
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
    { sourceRotation: 90, editorRotation: 90, outputRotation: 180 },
    { sourceRotation: 270, editorRotation: 90, outputRotation: 0 },
  ])(
    "exports source rotation $sourceRotation plus editor rotation $editorRotation",
    async ({ sourceRotation, editorRotation, outputRotation }) => {
      const file = await createPdfFile("rotated.pdf", [
        { width: 200, height: 300, rotation: sourceRotation },
      ]);

      const result = await Effect.runPromise(
        service.buildPDF([createPageState(file, 1, { rotation: editorRotation })])
      );
      const output = await PDFDocument.load(result.data);

      expect(output.getPage(0).getRotation().angle).toBe(outputRotation);
    }
  );

  it.each([
    {
      scope: "workspace",
      selectedIndices: undefined,
      expectedSizes: [
        [600, 700],
        [200, 300],
        [400, 500],
      ],
    },
    {
      scope: "selection",
      selectedIndices: [3, 1, 0],
      expectedSizes: [
        [400, 500],
        [600, 700],
      ],
    },
  ])(
    "exports active pages in $scope order and reports progress",
    async ({ selectedIndices, expectedSizes }) => {
      const file = await createPdfFile("source.pdf", [
        { width: 200, height: 300 },
        { width: 400, height: 500 },
        { width: 600, height: 700 },
        { width: 800, height: 900 },
      ]);
      const pages = [
        createPageState(file, 3),
        createPageState(file, 4, { markedForDeletion: true }),
        createPageState(file, 1),
        createPageState(file, 2),
      ];
      const onProgress = vi.fn();

      const result = await Effect.runPromise(
        service.buildPDF(pages, { selectedIndices, onProgress })
      );
      const output = await PDFDocument.load(result.data);

      expect(result.suggestedFileName).toBe("interleaf-output.pdf");
      expect(output.getPages().map((page) => [page.getWidth(), page.getHeight()])).toEqual(
        expectedSizes
      );
      expect(onProgress.mock.calls).toEqual(
        expectedSizes.map((_, index) => [{ completed: index + 1, total: expectedSizes.length }])
      );
    }
  );

  it("merges pages from different files even when their names match", async () => {
    const first = await createPdfFile("source.pdf", [{ width: 120, height: 240 }]);
    const second = await createPdfFile("source.pdf", [
      { width: 360, height: 480 },
      { width: 600, height: 720 },
    ]);

    const result = await Effect.runPromise(
      service.buildPDF([
        createPageState(first, 1, { id: "first-1" }),
        createPageState(second, 2, { id: "second-2" }),
        createPageState(second, 1, { id: "second-1" }),
      ])
    );
    const output = await PDFDocument.load(result.data);

    expect(output.getPages().map((page) => [page.getWidth(), page.getHeight()])).toEqual([
      [120, 240],
      [600, 720],
      [360, 480],
    ]);
  });

  it("places PNG and JPEG images on A4 pages in selection order", async () => {
    const drawImage = vi.spyOn(PDFPage.prototype, "drawImage");
    const onProgress = vi.fn();

    const result = await Effect.runPromise(
      service.imagesToPDF([createPngFile(), createJpegFile()], { onProgress })
    );
    const output = await PDFDocument.load(result.data);

    expect(result.suggestedFileName).toBe("interleaf-images.pdf");
    expect(output.getPages().map((page) => [page.getWidth(), page.getHeight()])).toEqual([
      [841.89, 595.28],
      [595.28, 841.89],
    ]);
    expect(drawImage).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        x: 0,
        y: expect.closeTo(87.1675, 4),
        width: 841.89,
        height: expect.closeTo(420.945, 4),
      })
    );
    expect(onProgress.mock.calls).toEqual([
      [{ completed: 1, total: 2 }],
      [{ completed: 2, total: 2 }],
    ]);
  });

  it("honors JPEG orientation metadata", async () => {
    const drawImage = vi.spyOn(PDFPage.prototype, "drawImage");

    const result = await Effect.runPromise(
      service.imagesToPDF([createJpegFile("rotated.jpg", true)])
    );
    const output = await PDFDocument.load(result.data);

    expect(output.getPage(0).getSize()).toEqual({ width: 841.89, height: 595.28 });
    expect(drawImage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ rotate: { type: "degrees", angle: -90 } })
    );
  });

  it("uses the image MIME type when its extension disagrees", async () => {
    const result = await Effect.runPromise(service.imagesToPDF([createJpegFile("image.png")]));
    const output = await PDFDocument.load(result.data);

    expect(output.getPageCount()).toBe(1);
    expect(output.getPage(0).getSize()).toEqual({ width: 595.28, height: 841.89 });
  });

  it.each([
    {
      scenario: "an empty image selection",
      files: [],
      message: "Choose at least one PNG or JPEG image.",
    },
    {
      scenario: "an unsupported image type",
      files: [new File(["gif"], "image.gif", { type: "image/gif" })],
      message: "Only PNG and JPEG images can be converted to PDF.",
    },
  ])("rejects $scenario", async ({ files, message }) => {
    await expect(Effect.runPromise(service.imagesToPDF(files))).rejects.toMatchObject({
      _tag: "PDFProcessingError",
      message,
    });
  });

  it("exports an unlocked encrypted page through a local render", async () => {
    const file = await createPdfFile("protected.pdf", [{ width: 612, height: 792, rotation: 90 }]);
    const source = await PDFDocument.load(await file.arrayBuffer());
    Object.defineProperty(source, "isEncrypted", { value: true });
    vi.spyOn(PDFDocument, "load").mockResolvedValueOnce(source);
    const png = await createPngFile().arrayBuffer();
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      `data:image/png;base64,${btoa(String.fromCharCode(...new Uint8Array(png)))}`
    );

    const result = await Effect.runPromise(
      service.buildPDF([createPageState(file, 1, { rotation: 90 })])
    );
    const output = await PDFDocument.load(result.data);

    expect(output.getPageCount()).toBe(1);
    expect(output.getPage(0).node.normalizedEntries().XObject.keys()).toHaveLength(1);
    expect(output.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
    expect(output.getPage(0).getRotation().angle).toBe(180);
    expect(renderPage).toHaveBeenCalledExactlyOnceWith(
      file,
      1,
      expect.any(HTMLCanvasElement),
      2,
      0
    );
  });

  it.each(["clearCache", "releaseFile"] as const)(
    "reloads a cached source after %s",
    async (operation) => {
      const file = await createPdfFile("source.pdf", [{ width: 200, height: 300 }]);
      const otherFile = await createPdfFile("other.pdf", [{ width: 400, height: 500 }]);
      const pages = [createPageState(file, 1), createPageState(otherFile, 1)];
      const load = vi.spyOn(PDFDocument, "load");

      await Effect.runPromise(service.buildPDF(pages));
      await Effect.runPromise(service.buildPDF(pages));
      expect(load).toHaveBeenCalledTimes(2);

      await Effect.runPromise(
        operation === "clearCache" ? service.clearCache() : service.releaseFile(file)
      );
      await Effect.runPromise(service.buildPDF(pages));

      expect(load).toHaveBeenCalledTimes(operation === "clearCache" ? 4 : 3);
    }
  );

  it.each(["clearCache", "releaseFile"] as const)(
    "cancels a pending load during %s and allows a retry",
    async (operation) => {
      const file = await createPdfFile("source.pdf", [{ width: 200, height: 300 }]);
      const pages = [createPageState(file, 1)];
      const load = vi
        .spyOn(PDFDocument, "load")
        .mockImplementationOnce(() => new Promise(() => undefined));
      const build = Effect.runPromise(Effect.flip(service.buildPDF(pages)));

      await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
      await Effect.runPromise(
        operation === "clearCache" ? service.clearCache() : service.releaseFile(file)
      );
      expect(await build).toMatchObject({ operation: "release-source", file });

      const result = await Effect.runPromise(service.buildPDF(pages));
      expect(load).toHaveBeenCalledTimes(2);
      expect((await PDFDocument.load(result.data)).getPageCount()).toBe(1);
    }
  );

  it.each(["clearCache", "releaseFile"] as const)(
    "discards a source load that finishes after %s",
    async (operation) => {
      const file = await createPdfFile("source.pdf", [{ width: 200, height: 300 }]);
      const source = await PDFDocument.load(await file.arrayBuffer());
      const pending = Promise.withResolvers<PDFDocument>();
      const load = vi.spyOn(PDFDocument, "load").mockReturnValueOnce(pending.promise);
      const pages = [createPageState(file, 1)];
      const build = Effect.runPromise(Effect.flip(service.buildPDF(pages)));

      await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
      await Effect.runPromise(
        operation === "clearCache" ? service.clearCache() : service.releaseFile(file)
      );
      pending.resolve(source);
      expect(await build).toMatchObject({ operation: "release-source", file });

      await Effect.runPromise(service.buildPDF(pages));
      expect(load).toHaveBeenCalledTimes(2);
    }
  );
});
