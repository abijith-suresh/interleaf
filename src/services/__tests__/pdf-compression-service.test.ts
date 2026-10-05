import { Effect } from "effect";
import { runPromise } from "effect/Effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFCompressionService } from "../pdf-compression-service";
import { QpdfProcessingError } from "../qpdf-processing";

const sourceFile = new File(["original PDF bytes"], "source.pdf", {
  type: "application/pdf",
});

const reducedPDF = {
  data: new Uint8Array([1, 2]),
  inputBytes: 18,
  candidateBytes: 2,
  outputBytes: 2,
  reduced: true,
};

describe("PDFCompressionService", () => {
  const qpdfProcessing = { optimizeLosslessly: vi.fn() };
  const service = new PDFCompressionService(qpdfProcessing);

  beforeEach(() => {
    qpdfProcessing.optimizeLosslessly.mockReset().mockReturnValue(Effect.succeed(reducedPDF));
  });

  it("passes the original file bytes and password to qpdf", async () => {
    await runPromise(service.compressPDF(sourceFile, "623"));

    expect(qpdfProcessing.optimizeLosslessly).toHaveBeenCalledWith(
      new Uint8Array(await sourceFile.arrayBuffer()),
      "623"
    );
  });

  it("returns the reduced output and source-based filename", async () => {
    await expect(runPromise(service.compressPDF(sourceFile, undefined))).resolves.toEqual({
      ...reducedPDF,
      suggestedFileName: "source-compressed.pdf",
    });
  });

  it("returns qpdf's original output when lossless compression does not reduce the file", async () => {
    const unchangedPDF = {
      data: new Uint8Array([3, 4, 5]),
      inputBytes: 18,
      candidateBytes: 20,
      outputBytes: 18,
      reduced: false,
    };
    qpdfProcessing.optimizeLosslessly.mockReturnValue(Effect.succeed(unchangedPDF));

    await expect(runPromise(service.compressPDF(sourceFile, undefined))).resolves.toEqual({
      ...unchangedPDF,
      suggestedFileName: "source-compressed.pdf",
    });
  });

  it("preserves a typed qpdf failure", async () => {
    const failure = new QpdfProcessingError({
      operation: "optimize",
      cause: new Error("qpdf failed"),
      message: "qpdf failed",
    });
    qpdfProcessing.optimizeLosslessly.mockReturnValue(Effect.fail(failure));

    await expect(runPromise(service.compressPDF(sourceFile, undefined))).rejects.toBe(failure);
  });
});
