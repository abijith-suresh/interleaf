import { Effect } from "effect";
import type { PDFCompressionResult, PDFError } from "../types/interfaces";
import { PDFProcessingError } from "../types/interfaces";
import { fileStem } from "../utils/file-names";
import { errorMessage } from "./pdf-errors";
import type { QpdfProcessingError, QpdfProcessingShape } from "./qpdf-processing";

export class PDFCompressionService {
  constructor(private readonly qpdfProcessing: Pick<QpdfProcessingShape, "optimizeLosslessly">) {}

  compressPDF(
    file: File,
    password: string | undefined
  ): Effect.Effect<PDFCompressionResult, PDFError | QpdfProcessingError> {
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

      const optimized = yield* this.qpdfProcessing.optimizeLosslessly(input, password);

      return {
        data: optimized.data,
        inputBytes: optimized.inputBytes,
        candidateBytes: optimized.candidateBytes,
        outputBytes: optimized.outputBytes,
        suggestedFileName: `${fileStem(file.name)}${optimized.reduced ? "-compressed" : ""}.pdf`,
        reduced: optimized.reduced,
      };
    });
  }
}
