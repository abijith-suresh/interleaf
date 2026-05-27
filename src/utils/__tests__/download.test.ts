import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PDFOperationResult } from "../../types/interfaces";

const mockPDFOperationResult: PDFOperationResult = {
  data: new Uint8Array([1, 2, 3, 4, 5]),
  suggestedFileName: "interleaf-output.pdf",
};

describe("download utility", () => {
  let downloadPDF: typeof import("../download").downloadPDF;

  beforeEach(async () => {
    const module = await import("../download");
    downloadPDF = module.downloadPDF;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should create blob with correct MIME type", () => {
    const urlSpy = vi.spyOn(URL, "createObjectURL");

    downloadPDF(mockPDFOperationResult);

    const blobArg = urlSpy.mock.calls[0][0] as Blob;
    expect(blobArg.type).toBe("application/pdf");
  });

  it("should create anchor with correct download filename", () => {
    const appendSpy = vi.spyOn(document.body, "appendChild");

    downloadPDF({ ...mockPDFOperationResult, suggestedFileName: "custom-name.pdf" });

    const anchor = appendSpy.mock.calls[0][0] as HTMLAnchorElement;
    expect(anchor.tagName).toBe("A");
    expect(anchor.download).toBe("custom-name.pdf");
    expect(anchor.href).toBeTruthy();
  });

  it("should handle empty data", () => {
    const urlSpy = vi.spyOn(URL, "createObjectURL");

    downloadPDF({ data: new Uint8Array(0), suggestedFileName: "empty.pdf" });

    const blobArg = urlSpy.mock.calls[0][0] as Blob;
    expect(blobArg.size).toBe(0);
  });

  it("should pass data through to blob", () => {
    const urlSpy = vi.spyOn(URL, "createObjectURL");

    const testData = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    downloadPDF({ data: testData, suggestedFileName: "test.pdf" });

    const blobArg = urlSpy.mock.calls[0][0] as Blob;
    expect(blobArg.size).toBe(4);
  });
});
