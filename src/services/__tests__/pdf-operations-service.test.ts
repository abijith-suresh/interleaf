import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PageState } from "../../types/interfaces";

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
    it("should create PDF from valid pages", async () => {
      const service = new PDFOperationsService(pdfServiceMock);
      const pages = [createMockPage()];

      const result = await runEffect(service.buildPDF(pages));

      expect(result.data).toBeInstanceOf(Uint8Array);
      expect(result.suggestedFileName).toBe("interleaf-output.pdf");
    });

    it("should handle multiple pages", async () => {
      const service = new PDFOperationsService(pdfServiceMock);
      const pages = [
        createMockPage({ id: "page-1", sourcePageNumber: 1 }),
        createMockPage({ id: "page-2", sourcePageNumber: 2 }),
      ];

      const result = await runEffect(service.buildPDF(pages));

      expect(result.data).toBeInstanceOf(Uint8Array);
    });

    it("should throw error when no pages provided", async () => {
      const service = new PDFOperationsService(pdfServiceMock);

      await expect(runEffect(service.buildPDF([]))).rejects.toThrow(
        "No pages to include in the PDF"
      );
    });

    it("composes editor rotation with the source page rotation", async () => {
      const service = new PDFOperationsService(pdfServiceMock);
      const rotatedPage = createMockPage({ rotation: 90 });
      mockCopiedPage.getRotation.mockReturnValue({ angle: 90 });

      const result = await runEffect(service.buildPDF([rotatedPage]));

      expect(result.data).toBeInstanceOf(Uint8Array);
      expect(mockCopiedPage.setRotation).toHaveBeenCalledWith(180);
    });

    it("normalizes a composed rotation that wraps past 360 degrees", async () => {
      const service = new PDFOperationsService(pdfServiceMock);
      const rotatedPage = createMockPage({ rotation: 90 });
      mockCopiedPage.getRotation.mockReturnValue({ angle: 270 });

      await runEffect(service.buildPDF([rotatedPage]));

      expect(mockCopiedPage.setRotation).toHaveBeenCalledWith(0);
    });

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

      const result = await runEffect(service.buildPDF([page]));

      expect(result.data).toBeInstanceOf(Uint8Array);
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

    it("should throw error when all pages are deleted", async () => {
      const service = new PDFOperationsService(pdfServiceMock);
      const deletedPage = createMockPage({ markedForDeletion: true });

      await expect(runEffect(service.buildPDF([deletedPage]))).rejects.toThrow(
        "No pages to include in the PDF"
      );
    });

    it("should filter out deleted pages", async () => {
      const service = new PDFOperationsService(pdfServiceMock);
      const pages = [
        createMockPage({ id: "page-1", markedForDeletion: false }),
        createMockPage({ id: "page-2", markedForDeletion: true }),
      ];

      const result = await runEffect(service.buildPDF(pages));

      expect(result.data).toBeInstanceOf(Uint8Array);
    });

    it("should report progress while building", async () => {
      const service = new PDFOperationsService(pdfServiceMock);
      const onProgress = vi.fn();

      await runEffect(
        service.buildPDF(
          [createMockPage(), createMockPage({ id: "page-2", sourcePageNumber: 2 })],
          { onProgress }
        )
      );

      expect(onProgress).toHaveBeenNthCalledWith(1, { completed: 1, total: 2 });
      expect(onProgress).toHaveBeenNthCalledWith(2, { completed: 2, total: 2 });
    });
  });

  describe("imagesToPDF", () => {
    it("fits one image per A4 page in selection order", async () => {
      const service = new PDFOperationsService(pdfServiceMock);
      const files = [
        new File(["png"], "first.png", { type: "image/png" }),
        new File(["jpeg"], "second.jpg", { type: "image/jpeg" }),
      ];
      const onProgress = vi.fn();

      const result = await runEffect(service.imagesToPDF(files, { onProgress }));

      expect(result.data).toBeInstanceOf(Uint8Array);
      expect(result.suggestedFileName).toBe("interleaf-images.pdf");
      expect(mockOutputDoc.embedPng).toHaveBeenCalledTimes(1);
      expect(mockOutputDoc.embedJpg).toHaveBeenCalledTimes(1);
      expect(mockOutputDoc.addPage).toHaveBeenNthCalledWith(1, [595.28, 841.89]);
      expect(mockOutputDoc.addPage).toHaveBeenNthCalledWith(2, [595.28, 841.89]);
      const drawHeight = (792 * 595.28) / 612;
      expect(mockOutputPage.drawImage).toHaveBeenNthCalledWith(
        1,
        mockEmbeddedImage,
        expect.objectContaining({
          x: 0,
          y: (841.89 - drawHeight) / 2,
          width: 595.28,
          height: drawHeight,
        })
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

  describe("selected pages", () => {
    it("should export specific active pages", async () => {
      const service = new PDFOperationsService(pdfServiceMock);
      const pages = [createMockPage()];

      const result = await runEffect(service.buildPDF(pages, { selectedIndices: [0] }));

      expect(result.data).toBeInstanceOf(Uint8Array);
      expect(result.suggestedFileName).toBe("interleaf-output.pdf");
    });

    it("should skip marked pages from a selected export", async () => {
      const service = new PDFOperationsService(pdfServiceMock);
      const pages = [
        createMockPage({ id: "page-1" }),
        createMockPage({ id: "page-2", sourcePageNumber: 2, markedForDeletion: true }),
      ];

      await runEffect(service.buildPDF(pages, { selectedIndices: [0, 1] }));

      expect(mockOutputDoc.copyPages).toHaveBeenCalledTimes(1);
      expect(mockOutputDoc.copyPages).toHaveBeenCalledWith(mockSourceDoc, [0]);
    });

    it("should report progress while exporting selected pages", async () => {
      const service = new PDFOperationsService(pdfServiceMock);
      const onProgress = vi.fn();

      await runEffect(service.buildPDF([createMockPage()], { selectedIndices: [0], onProgress }));

      expect(onProgress).toHaveBeenCalledWith({ completed: 1, total: 1 });
    });

    it("should export selected pages in the requested order", async () => {
      const service = new PDFOperationsService(pdfServiceMock);
      const pages = [
        createMockPage({ id: "page-1", sourcePageNumber: 1 }),
        createMockPage({ id: "page-2", sourcePageNumber: 2 }),
      ];

      const result = await runEffect(service.buildPDF(pages, { selectedIndices: [1, 0] }));

      expect(result.data).toBeInstanceOf(Uint8Array);
    });

    it("should throw error when selected indices contain no pages", async () => {
      const service = new PDFOperationsService(pdfServiceMock);
      const pages = [createMockPage()];

      await expect(runEffect(service.buildPDF(pages, { selectedIndices: [5] }))).rejects.toThrow();
    });

    it("should throw error when selected pages are all marked for deletion", async () => {
      const service = new PDFOperationsService(pdfServiceMock);
      const pages = [createMockPage({ markedForDeletion: true })];

      await expect(runEffect(service.buildPDF(pages, { selectedIndices: [0] }))).rejects.toThrow(
        "No pages to include in the PDF"
      );
    });
  });

  describe("clearCache", () => {
    it("should clear the cache", () => {
      const service = new PDFOperationsService(pdfServiceMock);

      expect(() => Effect.runSync(service.clearCache())).not.toThrow();
    });
  });
});
