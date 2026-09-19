import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { type PDFCompressionError, PDFCompressionService } from "../pdf-compression-service";
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

const runEffect = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

function makeServices() {
  return {
    qpdfProcessing: { optimizeLosslessly: vi.fn().mockReturnValue(Effect.succeed(reducedPDF)) },
  };
}

describe("PDFCompressionService", () => {
  it("passes the original file bytes and password to qpdf", async () => {
    const { qpdfProcessing } = makeServices();
    const onCompressionStage = vi.fn();
    const service = new PDFCompressionService(qpdfProcessing);

    await runEffect(service.compressPDF(sourceFile, "623", { onCompressionStage }));

    expect(qpdfProcessing.optimizeLosslessly).toHaveBeenCalledWith(
      new Uint8Array(await sourceFile.arrayBuffer()),
      "623"
    );
    expect(onCompressionStage).toHaveBeenCalledWith("compressing");
  });

  it("returns the reduced output and source-based filename", async () => {
    const { qpdfProcessing } = makeServices();
    const service = new PDFCompressionService(qpdfProcessing);

    await expect(runEffect(service.compressPDF(sourceFile, undefined))).resolves.toEqual({
      ...reducedPDF,
      suggestedFileName: "source-compressed.pdf",
    });
  });

  it("returns qpdf's original output when lossless compression does not reduce the file", async () => {
    const { qpdfProcessing } = makeServices();
    const unchangedPDF = {
      data: new Uint8Array([3, 4, 5]),
      inputBytes: 18,
      candidateBytes: 20,
      outputBytes: 18,
      reduced: false,
    };
    qpdfProcessing.optimizeLosslessly.mockReturnValue(Effect.succeed(unchangedPDF));
    const service = new PDFCompressionService(qpdfProcessing);

    await expect(runEffect(service.compressPDF(sourceFile, undefined))).resolves.toEqual({
      ...unchangedPDF,
      suggestedFileName: "source-compressed.pdf",
    });
  });

  it("preserves a typed qpdf failure", async () => {
    const { qpdfProcessing } = makeServices();
    const failure = new QpdfProcessingError({
      operation: "optimize",
      cause: new Error("qpdf failed"),
      message: "qpdf failed",
    });
    qpdfProcessing.optimizeLosslessly.mockReturnValue(Effect.fail(failure));
    const service = new PDFCompressionService(qpdfProcessing);

    await expect(runEffect(service.compressPDF(sourceFile, undefined))).rejects.toBe(failure);
  });

  it("models a compression stage callback failure as a typed error", async () => {
    const { qpdfProcessing } = makeServices();
    const callbackFailure = new Error("stage callback failed");
    const service = new PDFCompressionService(qpdfProcessing);

    await expect(
      runEffect(
        service.compressPDF(sourceFile, undefined, {
          onCompressionStage: () => {
            throw callbackFailure;
          },
        })
      )
    ).rejects.toMatchObject<Partial<PDFCompressionError>>({
      _tag: "PDFCompressionError",
      operation: "report-stage",
      cause: callbackFailure,
      message: "stage callback failed",
    });
    expect(qpdfProcessing.optimizeLosslessly).not.toHaveBeenCalled();
  });
});
