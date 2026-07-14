import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PageState } from "../../types/interfaces";

const createMockPage = (overrides: Partial<PageState> = {}): PageState => ({
  id: "page-1",
  sourceFile: new File([""], "test.pdf"),
  sourcePageNumber: 1,
  rotation: 0,
  markedForDeletion: false,
  ...overrides,
});

const mockPDFDoc = {
  copyPages: vi.fn().mockResolvedValue([{ setRotation: vi.fn() }]),
  addPage: vi.fn(),
  save: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  getPageCount: vi.fn().mockReturnValue(1),
};

const mockPDFDocument = {
  load: vi.fn().mockResolvedValue(mockPDFDoc),
  create: vi.fn().mockResolvedValue(mockPDFDoc),
};

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
    const module = await import("../pdf-operations-service");
    PDFOperationsService = module.PDFOperationsService;
  });

  describe("buildPDF", () => {
    it("should create PDF from valid pages", async () => {
      const service = new PDFOperationsService();
      const pages = [createMockPage()];

      const result = await service.buildPDF(pages);

      expect(result.data).toBeInstanceOf(Uint8Array);
      expect(result.suggestedFileName).toBe("interleaf-output.pdf");
    });

    it("should handle multiple pages", async () => {
      const service = new PDFOperationsService();
      const pages = [
        createMockPage({ id: "page-1", sourcePageNumber: 1 }),
        createMockPage({ id: "page-2", sourcePageNumber: 2 }),
      ];

      const result = await service.buildPDF(pages);

      expect(result.data).toBeInstanceOf(Uint8Array);
    });

    it("should throw error when no pages provided", async () => {
      const service = new PDFOperationsService();

      await expect(service.buildPDF([])).rejects.toThrow("No pages to include in the PDF");
    });

    it("should handle page rotation", async () => {
      const service = new PDFOperationsService();
      const rotatedPage = createMockPage({ rotation: 90 });

      const result = await service.buildPDF([rotatedPage]);

      expect(result.data).toBeInstanceOf(Uint8Array);
    });

    it("should throw error when all pages are deleted", async () => {
      const service = new PDFOperationsService();
      const deletedPage = createMockPage({ markedForDeletion: true });

      await expect(service.buildPDF([deletedPage])).rejects.toThrow(
        "No pages to include in the PDF"
      );
    });

    it("should filter out deleted pages", async () => {
      const service = new PDFOperationsService();
      const pages = [
        createMockPage({ id: "page-1", markedForDeletion: false }),
        createMockPage({ id: "page-2", markedForDeletion: true }),
      ];

      const result = await service.buildPDF(pages);

      expect(result.data).toBeInstanceOf(Uint8Array);
    });

    it("should report progress while building", async () => {
      const service = new PDFOperationsService();
      const onProgress = vi.fn();

      await service.buildPDF(
        [createMockPage(), createMockPage({ id: "page-2", sourcePageNumber: 2 })],
        onProgress
      );

      expect(onProgress).toHaveBeenNthCalledWith(1, { completed: 1, total: 2 });
      expect(onProgress).toHaveBeenNthCalledWith(2, { completed: 2, total: 2 });
    });
  });

  describe("buildPDFFromSubset", () => {
    it("should extract specific pages", async () => {
      const service = new PDFOperationsService();
      const pages = [createMockPage()];

      const result = await service.buildPDFFromSubset(pages, [0]);

      expect(result.data).toBeInstanceOf(Uint8Array);
      expect(result.suggestedFileName).toBe("interleaf-extract.pdf");
    });

    it("should report progress while extracting", async () => {
      const service = new PDFOperationsService();
      const onProgress = vi.fn();

      await service.buildPDFFromSubset([createMockPage()], [0], onProgress);

      expect(onProgress).toHaveBeenCalledWith({ completed: 1, total: 1 });
    });

    it("should handle multiple indices", async () => {
      const service = new PDFOperationsService();
      const pages = [
        createMockPage({ id: "page-1", sourcePageNumber: 1 }),
        createMockPage({ id: "page-2", sourcePageNumber: 2 }),
      ];

      const result = await service.buildPDFFromSubset(pages, [0, 1]);

      expect(result.data).toBeInstanceOf(Uint8Array);
    });

    it("should throw error for invalid indices", async () => {
      const service = new PDFOperationsService();
      const pages = [createMockPage()];

      await expect(service.buildPDFFromSubset(pages, [5])).rejects.toThrow();
    });

    it("should throw error when no pages selected", async () => {
      const service = new PDFOperationsService();
      const pages = [createMockPage()];

      await expect(service.buildPDFFromSubset(pages, [])).rejects.toThrow(
        "No pages selected for extraction"
      );
    });
  });

  describe("clearCache", () => {
    it("should clear the cache", () => {
      const service = new PDFOperationsService();

      expect(() => service.clearCache()).not.toThrow();
    });
  });
});
