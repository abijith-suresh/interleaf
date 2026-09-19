import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { type PageState, PDFNoPagesError } from "../../types/interfaces";
import { type PDFCompressionError, PDFCompressionService } from "../pdf-compression-service";
import { QpdfProcessingError } from "../qpdf-processing";

const pages: PageState[] = [
  {
    id: "page-1",
    sourceFile: new File(["source"], "source.pdf", { type: "application/pdf" }),
    sourcePageNumber: 1,
    rotation: 0,
    markedForDeletion: false,
  },
];

const builtPDF = {
  data: new Uint8Array([1, 2, 3, 4]),
  suggestedFileName: "interleaf-output.pdf",
};

const reducedPDF = {
  data: new Uint8Array([1, 2]),
  inputBytes: 4,
  candidateBytes: 2,
  outputBytes: 2,
  reduced: true,
};

const runEffect = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

function makeServices() {
  return {
    operationsService: { buildPDF: vi.fn().mockReturnValue(Effect.succeed(builtPDF)) },
    qpdfProcessing: { optimizeLosslessly: vi.fn().mockReturnValue(Effect.succeed(reducedPDF)) },
  };
}

describe("PDFCompressionService", () => {
  it("passes selected indices and build progress through to PDFOperationsService", async () => {
    const { operationsService, qpdfProcessing } = makeServices();
    const onProgress = vi.fn();
    const service = new PDFCompressionService(operationsService, qpdfProcessing);
    const selectedIndices = [0, 2];

    await runEffect(
      service.compressPDF(pages, {
        selectedIndices,
        onProgress,
      })
    );

    expect(operationsService.buildPDF).toHaveBeenCalledWith(pages, {
      selectedIndices,
      onProgress,
    });
    expect(qpdfProcessing.optimizeLosslessly).toHaveBeenCalledWith(builtPDF.data);

    const forwardedProgress = operationsService.buildPDF.mock.calls[0]?.[1].onProgress;
    forwardedProgress?.({ completed: 1, total: 2 });
    expect(onProgress).toHaveBeenCalledWith({ completed: 1, total: 2 });
  });

  it("returns the reduced output and all compression metadata", async () => {
    const { operationsService, qpdfProcessing } = makeServices();
    const service = new PDFCompressionService(operationsService, qpdfProcessing);

    await expect(runEffect(service.compressPDF(pages))).resolves.toEqual({
      ...reducedPDF,
      suggestedFileName: builtPDF.suggestedFileName,
    });
  });

  it("returns qpdf's original output when lossless compression does not reduce the file", async () => {
    const { operationsService, qpdfProcessing } = makeServices();
    const unchangedPDF = {
      data: builtPDF.data,
      inputBytes: 4,
      candidateBytes: 5,
      outputBytes: 4,
      reduced: false,
    };
    qpdfProcessing.optimizeLosslessly.mockReturnValue(Effect.succeed(unchangedPDF));
    const service = new PDFCompressionService(operationsService, qpdfProcessing);

    await expect(runEffect(service.compressPDF(pages))).resolves.toEqual({
      ...unchangedPDF,
      suggestedFileName: builtPDF.suggestedFileName,
    });
  });

  it("preserves a typed build failure and does not start qpdf", async () => {
    const { operationsService, qpdfProcessing } = makeServices();
    const failure = new PDFNoPagesError({ message: "No pages to include in the PDF" });
    operationsService.buildPDF.mockReturnValue(Effect.fail(failure));
    const service = new PDFCompressionService(operationsService, qpdfProcessing);

    await expect(runEffect(service.compressPDF(pages))).rejects.toBe(failure);
    expect(qpdfProcessing.optimizeLosslessly).not.toHaveBeenCalled();
  });

  it("preserves a typed qpdf failure after building the PDF", async () => {
    const { operationsService, qpdfProcessing } = makeServices();
    const failure = new QpdfProcessingError({
      operation: "optimize",
      cause: new Error("qpdf failed"),
      message: "qpdf failed",
    });
    qpdfProcessing.optimizeLosslessly.mockReturnValue(Effect.fail(failure));
    const service = new PDFCompressionService(operationsService, qpdfProcessing);

    await expect(runEffect(service.compressPDF(pages))).rejects.toBe(failure);
  });

  it("reports the compression stage before invoking qpdf", async () => {
    const { operationsService, qpdfProcessing } = makeServices();
    const onCompressionStage = vi.fn();
    const service = new PDFCompressionService(operationsService, qpdfProcessing);

    await runEffect(service.compressPDF(pages, { onCompressionStage }));

    expect(onCompressionStage).toHaveBeenCalledWith("compressing");
    expect(onCompressionStage.mock.invocationCallOrder[0]).toBeLessThan(
      qpdfProcessing.optimizeLosslessly.mock.invocationCallOrder[0]
    );
  });

  it("models a compression stage callback failure as a typed error", async () => {
    const { operationsService, qpdfProcessing } = makeServices();
    const callbackFailure = new Error("stage callback failed");
    const service = new PDFCompressionService(operationsService, qpdfProcessing);

    await expect(
      runEffect(
        service.compressPDF(pages, {
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
