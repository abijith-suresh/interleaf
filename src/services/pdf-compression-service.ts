import { Data, Effect } from "effect";
import type { PDFCompressionResult, PDFError } from "../types/interfaces";
import { PDFProcessingError } from "../types/interfaces";
import { errorMessage, messageFromCause } from "./pdf-errors";
import type { QpdfProcessingError, QpdfProcessingShape } from "./qpdf-processing";

export type PDFCompressionStage = "compressing";

export interface PDFCompressionOptions {
  readonly onCompressionStage?: (stage: PDFCompressionStage) => void;
}

export class PDFCompressionError extends Data.TaggedError("PDFCompressionError")<{
  readonly operation: "report-stage";
  readonly cause: unknown;
  readonly message: string;
}> {}

export class PDFCompressionService {
  constructor(private readonly qpdfProcessing: Pick<QpdfProcessingShape, "optimizeLosslessly">) {}

  compressPDF(
    file: File,
    password: string | undefined,
    options: PDFCompressionOptions = {}
  ): Effect.Effect<PDFCompressionResult, PDFError | QpdfProcessingError | PDFCompressionError> {
    return Effect.gen({ self: this }, function* () {
      const input = yield* Effect.tryPromise({
        try: async () => new Uint8Array(await file.arrayBuffer()),
        catch: (cause) =>
          new PDFProcessingError({
            operation: "read-file",
            file,
            cause,
            message: errorMessage(cause, `Could not read ${file.name}.`),
          }),
      });

      yield* Effect.try({
        try: () => options.onCompressionStage?.("compressing"),
        catch: (cause) =>
          new PDFCompressionError({
            operation: "report-stage",
            cause,
            message: messageFromCause(cause, "Could not report PDF compression progress."),
          }),
      });

      const optimized = yield* this.qpdfProcessing.optimizeLosslessly(input, password);

      return {
        data: optimized.data,
        inputBytes: optimized.inputBytes,
        candidateBytes: optimized.candidateBytes,
        outputBytes: optimized.outputBytes,
        suggestedFileName: compressedFileName(file.name),
        reduced: optimized.reduced,
      };
    });
  }
}

function compressedFileName(fileName: string): string {
  const baseName = fileName.replace(/\.pdf$/i, "");
  return `${baseName || "interleaf"}-compressed.pdf`;
}
