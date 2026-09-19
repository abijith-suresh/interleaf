import { Data, Effect } from "effect";
import type {
  PageState,
  PDFBuildProgress,
  PDFCompressionResult,
  PDFError,
} from "../types/interfaces";
import type { PDFBuildOptions, PDFOperationsService } from "./pdf-operations-service";
import type { QpdfProcessingError, QpdfProcessingShape } from "./qpdf-processing";

export type PDFCompressionStage = "compressing";

export interface PDFCompressionOptions {
  readonly selectedIndices?: readonly number[];
  readonly onProgress?: (progress: PDFBuildProgress) => void;
  readonly onCompressionStage?: (stage: PDFCompressionStage) => void;
}

export class PDFCompressionError extends Data.TaggedError("PDFCompressionError")<{
  readonly operation: "report-stage";
  readonly cause: unknown;
  readonly message: string;
}> {}

function messageFromCause(cause: unknown): string {
  if (cause instanceof Error && cause.message) return cause.message;
  if (typeof cause === "string" && cause.length > 0) return cause;
  return "Could not report PDF compression progress.";
}

export class PDFCompressionService {
  constructor(
    private readonly operationsService: Pick<PDFOperationsService, "buildPDF">,
    private readonly qpdfProcessing: Pick<QpdfProcessingShape, "optimizeLosslessly">
  ) {}

  compressPDF(
    pages: readonly PageState[],
    options: PDFCompressionOptions = {}
  ): Effect.Effect<PDFCompressionResult, PDFError | QpdfProcessingError | PDFCompressionError> {
    const buildOptions: PDFBuildOptions = {
      ...(options.selectedIndices === undefined
        ? {}
        : { selectedIndices: options.selectedIndices }),
      ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
    };

    return Effect.gen({ self: this }, function* () {
      const built = yield* this.operationsService.buildPDF(pages, buildOptions);

      yield* Effect.try({
        try: () => options.onCompressionStage?.("compressing"),
        catch: (cause) =>
          new PDFCompressionError({
            operation: "report-stage",
            cause,
            message: messageFromCause(cause),
          }),
      });

      const optimized = yield* this.qpdfProcessing.optimizeLosslessly(built.data);

      return {
        data: optimized.data,
        inputBytes: optimized.inputBytes,
        candidateBytes: optimized.candidateBytes,
        outputBytes: optimized.outputBytes,
        suggestedFileName: built.suggestedFileName,
        reduced: optimized.reduced,
      };
    });
  }
}
