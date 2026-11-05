import { Effect } from "effect";
import { decodePDFRawStream, PDFArray, PDFDocument, PDFPage, PDFRawStream } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFNoPagesError } from "../../types/interfaces";
import { PDFOperationsService } from "../pdf-operations-service";
import {
  createJpegFile,
  createOrientedJpegFile,
  createPageState,
  createPdfFile,
  createPngFile,
} from "./pdf-fixtures";

type Corner = "TL" | "TR" | "BL" | "BR";

/** Where the image content lands on a page, read back from the saved content stream. */
async function placeStoredCorners(data: Uint8Array) {
  const page = (await PDFDocument.load(data)).getPage(0);
  const { context } = page.node;
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray() : [contents];
  const content = streams
    .map((entry) => {
      const stream = context.lookup(entry);
      if (!(stream instanceof PDFRawStream)) throw new Error("Expected a raw content stream");
      return new TextDecoder().decode(decodePDFRawStream(stream).decode());
    })
    .join("\n");
  const matrices = [...content.matchAll(/((?:-?[\d.]+(?:e-?\d+)?\s+){6})cm/g)].map((match) =>
    (match[1] ?? "").trim().split(/\s+/).map(Number)
  );
  // Each `cm` applies before the ones already in effect, so the last one acts on the image first.
  const place = (u: number, v: number) =>
    [...matrices]
      .reverse()
      .reduce(
        ([x, y], [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0]) => [
          a * x + c * y + e,
          b * x + d * y + f,
        ],
        [u, v]
      ) as [number, number];

  // The image XObject is a unit square with (0, 0) at the bottom-left of the stored pixels.
  const points = { TL: place(0, 1), TR: place(1, 1), BL: place(0, 0), BR: place(1, 0) };
  const xs = Object.values(points).map(([x]) => x);
  const ys = Object.values(points).map(([, y]) => y);
  const bounds = {
    left: Math.min(...xs),
    right: Math.max(...xs),
    bottom: Math.min(...ys),
    top: Math.max(...ys),
  };
  const classify = ([x, y]: [number, number]): Corner => {
    const vertical = Math.abs(y - bounds.top) < 1e-6 ? "T" : "B";
    const horizontal = Math.abs(x - bounds.left) < 1e-6 ? "L" : "R";
    return `${vertical}${horizontal}`;
  };

  return {
    bounds,
    page: { width: page.getWidth(), height: page.getHeight() },
    landed: {
      TL: classify(points.TL),
      TR: classify(points.TR),
      BL: classify(points.BL),
      BR: classify(points.BR),
    },
  };
}

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

  // Stored corner -> displayed corner, per the EXIF Orientation tag definition.
  it.each<{ orientation: number; name: string; landed: Record<Corner, Corner> }>([
    { orientation: 1, name: "upright", landed: { TL: "TL", TR: "TR", BL: "BL", BR: "BR" } },
    {
      orientation: 2,
      name: "mirror horizontal",
      landed: { TL: "TR", TR: "TL", BL: "BR", BR: "BL" },
    },
    { orientation: 3, name: "rotate 180", landed: { TL: "BR", TR: "BL", BL: "TR", BR: "TL" } },
    { orientation: 4, name: "mirror vertical", landed: { TL: "BL", TR: "BR", BL: "TL", BR: "TR" } },
    { orientation: 5, name: "transpose", landed: { TL: "TL", TR: "BL", BL: "TR", BR: "BR" } },
    {
      orientation: 6,
      name: "rotate 90 clockwise",
      landed: { TL: "TR", TR: "BR", BL: "TL", BR: "BL" },
    },
    { orientation: 7, name: "transverse", landed: { TL: "BR", TR: "TR", BL: "BL", BR: "TL" } },
    {
      orientation: 8,
      name: "rotate 90 counterclockwise",
      landed: { TL: "BL", TR: "TL", BL: "BR", BR: "TR" },
    },
  ])(
    "places a JPEG with EXIF orientation $orientation ($name) with the right corners",
    async ({ orientation, landed }) => {
      const result = await Effect.runPromise(
        service.imagesToPDF([createOrientedJpegFile(orientation)])
      );
      const placed = await placeStoredCorners(result.data);

      // The stored image is 2x3 pixels; quarter-turn orientations display it as 3x2.
      const [displayWidth, displayHeight] = orientation >= 5 ? [3, 2] : [2, 3];
      const scale = Math.min(placed.page.width / displayWidth, placed.page.height / displayHeight);
      expect(placed.landed).toEqual(landed);
      expect(placed.bounds.right - placed.bounds.left).toBeCloseTo(displayWidth * scale, 4);
      expect(placed.bounds.top - placed.bounds.bottom).toBeCloseTo(displayHeight * scale, 4);
      expect((placed.bounds.left + placed.bounds.right) / 2).toBeCloseTo(placed.page.width / 2, 4);
      expect((placed.bounds.top + placed.bounds.bottom) / 2).toBeCloseTo(placed.page.height / 2, 4);
    }
  );

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

  it("bounds the encrypted preview bitmap and releases it while retaining physical page geometry", async () => {
    const file = await createPdfFile("large-protected.pdf", [
      { width: 1500, height: 2000, rotation: 90 },
    ]);
    const source = await PDFDocument.load(await file.arrayBuffer());
    Object.defineProperty(source, "isEncrypted", { value: true });
    vi.spyOn(PDFDocument, "load").mockResolvedValueOnce(source);
    const png = await createPngFile().arrayBuffer();
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      `data:image/png;base64,${btoa(String.fromCharCode(...new Uint8Array(png)))}`
    );
    await Effect.runPromise(service.dispose());
    service = new PDFOperationsService({
      renderPage,
      getPageGeometry: () =>
        Effect.succeed({
          bounds: [-40, -60, 1460, 1940],
          userUnit: 2,
          width: 3000,
          height: 4000,
          transform: [2, 0, 0, -2, 80, 3880],
        }),
    });
    const result = await Effect.runPromise(
      service.buildPDF([createPageState(file, 1, { rotation: 90 })], { maxRasterPixels: 4_000_000 })
    );
    const output = await PDFDocument.load(result.data);
    expect(output.getPage(0).getSize()).toEqual({ width: 3000, height: 4000 });
    expect(output.getPage(0).getRotation().angle).toBe(180);
    const [, , canvas, scale] = renderPage.mock.calls[0] as unknown as [
      File,
      number,
      HTMLCanvasElement,
      number,
    ];
    expect(scale).toBeCloseTo(Math.sqrt(4_000_000 / (3000 * 4000)));
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
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
      // Two cached originals, plus a fresh private document per File per export.
      expect(load).toHaveBeenCalledTimes(6);

      await Effect.runPromise(
        operation === "clearCache" ? service.clearCache() : service.releaseFile(file)
      );
      await Effect.runPromise(service.buildPDF(pages));

      expect(load).toHaveBeenCalledTimes(operation === "clearCache" ? 10 : 9);
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
      expect(load).toHaveBeenCalledTimes(3);
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
      expect(load).toHaveBeenCalledTimes(3);
    }
  );
});
