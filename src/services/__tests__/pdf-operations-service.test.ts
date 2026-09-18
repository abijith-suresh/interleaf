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

const mockEmbeddedImage = {};

const mockSourceDoc = {
  getPage: vi.fn().mockReturnValue(mockSourcePage),
  isEncrypted: false,
};

const mockOutputDoc = {
  addPage: vi.fn().mockReturnValue(mockOutputPage),
  copyPages: vi.fn().mockResolvedValue([mockCopiedPage]),
  embedPng: vi.fn().mockResolvedValue(mockEmbeddedImage),
  save: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
};

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
