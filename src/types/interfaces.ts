import { Data } from "effect";

export type EncryptionReason = "needs-password" | "wrong-password";

export class PDFPasswordRequiredError extends Data.TaggedError("PDFPasswordRequiredError")<{
  readonly file: File;
  readonly reason: EncryptionReason;
  readonly message: string;
}> {
  constructor(file: File, reason: EncryptionReason = "needs-password") {
    super({
      file,
      reason,
      message: `PDF requires a password: ${file.name}`,
    });
  }
}

export class PDFProcessingError extends Data.TaggedError("PDFProcessingError")<{
  readonly operation: string;
  readonly file?: File;
  readonly cause: unknown;
  readonly message: string;
}> {}

export class PDFNoPagesError extends Data.TaggedError("PDFNoPagesError")<{
  readonly message: string;
}> {}

export type PDFError = PDFPasswordRequiredError | PDFProcessingError | PDFNoPagesError;

export interface PageState {
  id: string;
  sourceFile: File;
  sourcePageNumber: number;
  rotation: number;
  markedForDeletion: boolean;
}

export interface PDFOperationResult {
  data: Uint8Array;
  suggestedFileName: string;
}

export interface PDFImageExportResult {
  data: Blob;
  suggestedFileName: string;
}

export interface PDFCompressionResult {
  data: Uint8Array;
  inputBytes: number;
  candidateBytes: number;
  outputBytes: number;
  suggestedFileName: string;
  reduced: boolean;
}

export interface PDFBuildProgress {
  completed: number;
  total: number;
}
