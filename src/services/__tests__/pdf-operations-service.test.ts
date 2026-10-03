import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type PageState, PDFNoPagesError } from "../../types/interfaces";

const pdfServiceMock = vi.hoisted(() => ({
  renderPage: vi.fn(),
}));

const createMockPage = (overrides: Partial<PageState> = {}): PageState => ({
  id: "page-1",
  sourceFile: new File([""], "test.pdf"),
  sourcePageNumber: 1,
  rotation: 0,
  markedForDeletion: false,
  ...overrides,
});

const mockSourcePage = {
  getHeight: vi.fn().mockReturnValue(792),
  getRotation: vi.fn().mockReturnValue({ angle: 0 }),
  getWidth: vi.fn().mockReturnValue(612),
};

const mockCopiedPage = {
  getRotation: vi.fn().mockReturnValue({ angle: 0 }),
  setRotation: vi.fn(),
};

const mockOutputPage = {
  drawImage: vi.fn(),
  setRotation: vi.fn(),
};

const mockEmbeddedImage = {
  scale: vi.fn().mockReturnValue({ width: 612, height: 792 }),
};

const mockSourceDoc = {
  getPage: vi.fn().mockReturnValue(mockSourcePage),
  isEncrypted: false,
};

const mockOutputDoc = {
  addPage: vi.fn().mockReturnValue(mockOutputPage),
  copyPages: vi.fn().mockResolvedValue([mockCopiedPage]),
  embedPng: vi.fn().mockResolvedValue(mockEmbeddedImage),
  embedJpg: vi.fn().mockResolvedValue(mockEmbeddedImage),
  save: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
};

function copyBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(value.byteLength));
  copy.set(value);
  return copy;
}

const JPEG_WITH_ORIENTATION_6 = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x49, 0x49, 0x2a, 0x00,
  0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xd9,
]);

const mockPDFDocument = {
  load: vi.fn().mockResolvedValue(mockSourceDoc),
  create: vi.fn().mockResolvedValue(mockOutputDoc),
};

const runEffect = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

vi.mock("pdf-lib", () => ({
  PDFDocument: {
    load: mockPDFDocument.load,
    create: mockPDFDocument.create,
  },
  PageSizes: {
    A4: [595.28, 841.89],
  },
  degrees: vi.fn((deg) => deg),
}));

describe("PDFOperationsService", () => {
  let PDFOperationsService: typeof import("../pdf-operations-service").PDFOperationsService;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSourceDoc.isEncrypted = false;
    mockSourcePage.getRotation.mockReturnValue({ angle: 0 });
    mockCopiedPage.getRotation.mockReturnValue({ angle: 0 });
    mockPDFDocument.load.mockResolvedValue(mockSourceDoc);
    mockPDFDocument.create.mockResolvedValue(mockOutputDoc);
    pdfServiceMock.renderPage.mockReturnValue(Effect.void);
    const module = await import("../pdf-operations-service");
    PDFOperationsService = module.PDFOperationsService;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("buildPDF", () => {
    it.each([
      { scenario: "no pages", pages: [], options: {} },
      {
        scenario: "all pages deleted",
        pages: [createMockPage({ markedForDeletion: true })],
        options: {},
      },
      {
        scenario: "no selected pages",
        pages: [createMockPage()],
        options: { selectedIndices: [] },
      },
      {
        scenario: "selected indices outside the workspace",
        pages: [createMockPage()],
        options: { selectedIndices: [5] },
      },
      {
        scenario: "only deleted pages selected",
        pages: [createMockPage({ markedForDeletion: true }), createMockPage({ id: "page-2" })],
        options: { selectedIndices: [0] },
      },
    ])(
      "rejects an export with $scenario before creating a document",
      async ({ pages, options }) => {
        const service = new PDFOperationsService(pdfServiceMock);

        await expect(runEffect(service.buildPDF(pages, options))).rejects.toEqual(
          new PDFNoPagesError({ message: "No pages to include in the PDF" })
        );
        expect(mockPDFDocument.create).not.toHaveBeenCalled();
      }
    );

    it.each([
      { sourceRotation: 90, editorRotation: 90, outputRotation: 180 },
      { sourceRotation: 270, editorRotation: 90, outputRotation: 0 },
    ])(
      "composes source rotation $sourceRotation with editor rotation $editorRotation",
      async ({ sourceRotation, editorRotation, outputRotation }) => {
        const service = new PDFOperationsService(pdfServiceMock);
        mockCopiedPage.getRotation.mockReturnValue({ angle: sourceRotation });

        await runEffect(service.buildPDF([createMockPage({ rotation: editorRotation })]));

        expect(mockCopiedPage.setRotation).toHaveBeenCalledExactlyOnceWith(outputRotation);
      }
    );

    it("exports an unlocked encrypted page through a local render", async () => {
      const service = new PDFOperationsService(pdfServiceMock);
      const file = new File(["encrypted"], "protected.pdf", { type: "application/pdf" });
      const page = createMockPage({ sourceFile: file, rotation: 90 });
      mockSourceDoc.isEncrypted = true;
      mockSourcePage.getRotation.mockReturnValue({ angle: 90 });
      pdfServiceMock.renderPage.mockImplementation(
        (_file, _pageNumber, canvas: HTMLCanvasElement) =>
          Effect.sync(() => {
            canvas.width = 1224;
            canvas.height = 1584;
          })
      );
      vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
        "data:image/png;base64,rendered-page"
      );

      await runEffect(service.buildPDF([page]));
      expect(mockOutputDoc.copyPages).not.toHaveBeenCalled();
      expect(pdfServiceMock.renderPage).toHaveBeenCalledWith(
        file,
        1,
        expect.any(HTMLCanvasElement),
        2,
        0
      );
      expect(mockOutputDoc.embedPng).toHaveBeenCalledWith("data:image/png;base64,rendered-page");
      expect(mockOutputPage.drawImage).toHaveBeenCalledWith(mockEmbeddedImage, {
        x: 0,
        y: 0,
        width: 612,
        height: 792,
      });
      expect(mockOutputPage.setRotation).toHaveBeenCalledWith(180);
    });

    it.each([
      { scope: "workspace", selectedIndices: undefined, expectedIndices: [3, 0, 2] },
      { scope: "selection", selectedIndices: [3, 1, 0], expectedIndices: [2, 3] },
    ])(
      "exports active pages in $scope order and reports their progress",
      async ({ selectedIndices, expectedIndices }) => {
        const service = new PDFOperationsService(pdfServiceMock);
        const file = new File(["source"], "source.pdf");
        const pages = [
          createMockPage({ sourceFile: file, sourcePageNumber: 4 }),
          createMockPage({
            id: "page-2",
            sourceFile: file,
            sourcePageNumber: 2,
            markedForDeletion: true,
          }),
          createMockPage({ id: "page-3", sourceFile: file, sourcePageNumber: 1 }),
          createMockPage({ id: "page-4", sourceFile: file, sourcePageNumber: 3 }),
        ];
        const onProgress = vi.fn();

        await runEffect(service.buildPDF(pages, { selectedIndices, onProgress }));

        expect(mockOutputDoc.copyPages.mock.calls).toEqual(
          expectedIndices.map((index) => [mockSourceDoc, [index]])
        );
        expect(mockOutputDoc.addPage).toHaveBeenCalledTimes(expectedIndices.length);
        expect(onProgress.mock.calls).toEqual(
          expectedIndices.map((_, index) => [
            { completed: index + 1, total: expectedIndices.length },
          ])
        );
      }
    );
  });

  describe("imagesToPDF", () => {
    it("fits one image per A4 page in selection order", async () => {
      const service = new PDFOperationsService(pdfServiceMock);
      const files = [
        new File(["png"], "first.png", { type: "image/png" }),
        new File(["jpeg"], "second.jpg", { type: "image/jpeg" }),
      ];
      const jpegImage = { scale: vi.fn().mockReturnValue({ width: 612, height: 792 }) };
      mockOutputDoc.embedJpg.mockResolvedValueOnce(jpegImage);
      const onProgress = vi.fn();

      const result = await runEffect(service.imagesToPDF(files, { onProgress }));

      expect(result.suggestedFileName).toBe("interleaf-images.pdf");
      expect(mockOutputDoc.embedPng).toHaveBeenCalledTimes(1);
      expect(mockOutputDoc.embedJpg).toHaveBeenCalledTimes(1);
      expect(mockOutputDoc.addPage).toHaveBeenNthCalledWith(1, [595.28, 841.89]);
      expect(mockOutputDoc.addPage).toHaveBeenNthCalledWith(2, [595.28, 841.89]);
      const drawHeight = (792 * 595.28) / 612;
      expect(mockOutputPage.drawImage.mock.calls).toEqual(
        [mockEmbeddedImage, jpegImage].map((image) => [
          image,
          {
            x: 0,
            y: (841.89 - drawHeight) / 2,
            width: 595.28,
            height: drawHeight,
          },
        ])
      );
      expect(onProgress).toHaveBeenNthCalledWith(1, { completed: 1, total: 2 });
      expect(onProgress).toHaveBeenNthCalledWith(2, { completed: 2, total: 2 });
    });

    it("rejects an empty selection", async () => {
      const service = new PDFOperationsService(pdfServiceMock);

      await expect(runEffect(service.imagesToPDF([]))).rejects.toThrow(
        "Choose at least one PNG or JPEG image."
      );
    });

    it("rejects unsupported image types", async () => {
      const service = new PDFOperationsService(pdfServiceMock);
      const file = new File(["gif"], "image.gif", { type: "image/gif" });

      await expect(runEffect(service.imagesToPDF([file]))).rejects.toThrow(
        "Only PNG and JPEG images can be converted to PDF."
      );
      expect(mockPDFDocument.create).not.toHaveBeenCalled();
    });

    it("honors JPEG orientation metadata when placing a rotated image", async () => {
      const service = new PDFOperationsService(pdfServiceMock);
      const file = new File([copyBytes(JPEG_WITH_ORIENTATION_6)], "rotated.jpg", {
        type: "image/jpeg",
      });

      await runEffect(service.imagesToPDF([file]));

      expect(mockOutputDoc.addPage).toHaveBeenCalledWith([841.89, 595.28]);
      expect(mockOutputPage.drawImage).toHaveBeenCalledWith(
        mockEmbeddedImage,
        expect.objectContaining({ rotate: -90 })
      );
    });

    it("uses the MIME type when an image extension disagrees", async () => {
      const service = new PDFOperationsService(pdfServiceMock);
      const file = new File(["jpeg"], "image.png", { type: "image/jpeg" });

      await runEffect(service.imagesToPDF([file]));

      expect(mockOutputDoc.embedPng).not.toHaveBeenCalled();
      expect(mockOutputDoc.embedJpg).toHaveBeenCalledWith(expect.any(ArrayBuffer));
    });
  });

  describe("source document cache", () => {
    it("reuses loaded documents until the cache is cleared", async () => {
      const service = new PDFOperationsService(pdfServiceMock);
      const pages = [createMockPage(), createMockPage({ id: "page-2" })];

      await runEffect(service.buildPDF(pages));
      await runEffect(service.buildPDF(pages));
      expect(mockPDFDocument.load).toHaveBeenCalledTimes(2);

      await runEffect(service.clearCache());
      await runEffect(service.buildPDF(pages));

      expect(mockPDFDocument.load).toHaveBeenCalledTimes(4);
    });

    it("releases a source document cache for one file", async () => {
      const service = new PDFOperationsService(pdfServiceMock);
      const file = createMockPage().sourceFile;
      const page = createMockPage({ sourceFile: file });

      await runEffect(service.buildPDF([page]));
      await runEffect(service.releaseFile(file));
      await runEffect(service.buildPDF([page]));

      expect(mockPDFDocument.load).toHaveBeenCalledTimes(2);
    });

    it("does not cache a source document that finishes after release", async () => {
      let resolveLoad!: (sourceDoc: typeof mockSourceDoc) => void;
      mockPDFDocument.load.mockImplementationOnce(
        () => new Promise((resolve) => (resolveLoad = resolve))
      );

      const service = new PDFOperationsService(pdfServiceMock);
      const file = createMockPage().sourceFile;
      const page = createMockPage({ sourceFile: file });
      const firstBuild = runEffect(Effect.flip(service.buildPDF([page])));

      await vi.waitFor(() => expect(mockPDFDocument.load).toHaveBeenCalledTimes(1));
      await runEffect(service.releaseFile(file));
      resolveLoad(mockSourceDoc);
      expect(await firstBuild).toMatchObject({ operation: "release-source", file });

      await runEffect(service.buildPDF([page]));

      expect(mockPDFDocument.load).toHaveBeenCalledTimes(2);
    });

    it("interrupts a pending source load when the cache is cleared", async () => {
      mockPDFDocument.load.mockImplementationOnce(() => new Promise(() => undefined));

      const service = new PDFOperationsService(pdfServiceMock);
      const file = createMockPage().sourceFile;
      const page = createMockPage({ sourceFile: file });
      const firstBuild = runEffect(service.buildPDF([page]));

      await vi.waitFor(() => expect(mockPDFDocument.load).toHaveBeenCalledTimes(1));
      await runEffect(service.clearCache());
      await expect(firstBuild).rejects.toMatchObject({
        operation: "release-source",
        file,
      });

      await runEffect(service.buildPDF([page]));

      expect(mockPDFDocument.load).toHaveBeenCalledTimes(2);
    });

    it("does not strand a source load when release runs while the load is pending", async () => {
      mockPDFDocument.load.mockImplementationOnce(() => new Promise(() => undefined));

      const service = new PDFOperationsService(pdfServiceMock);
      const file = createMockPage().sourceFile;
      const page = createMockPage({ sourceFile: file });
      const firstBuild = runEffect(service.buildPDF([page]));

      await vi.waitFor(() => expect(mockPDFDocument.load).toHaveBeenCalledTimes(1));
      await runEffect(service.releaseFile(file));
      await expect(firstBuild).rejects.toMatchObject({
        operation: "release-source",
        file,
      });

      await runEffect(service.buildPDF([page]));

      expect(mockPDFDocument.load).toHaveBeenCalledTimes(2);
    });

    it("does not cache a source document that finishes after the cache is cleared", async () => {
      let resolveLoad!: (sourceDoc: typeof mockSourceDoc) => void;
      mockPDFDocument.load.mockImplementationOnce(
        () => new Promise((resolve) => (resolveLoad = resolve))
      );

      const service = new PDFOperationsService(pdfServiceMock);
      const file = createMockPage().sourceFile;
      const page = createMockPage({ sourceFile: file });
      const firstBuild = runEffect(Effect.flip(service.buildPDF([page])));

      await vi.waitFor(() => expect(mockPDFDocument.load).toHaveBeenCalledTimes(1));
      await runEffect(service.clearCache());
      resolveLoad(mockSourceDoc);
      expect(await firstBuild).toMatchObject({ operation: "release-source", file });

      await runEffect(service.buildPDF([page]));

      expect(mockPDFDocument.load).toHaveBeenCalledTimes(2);
    });
  });
});
