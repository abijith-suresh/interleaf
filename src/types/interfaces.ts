import { Data, Hash } from "effect";

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
}> {
  [Hash.symbol](): number {
    return Hash.string(`${this._tag}:${this.operation}:${this.file?.name ?? ""}:${this.message}`);
  }
}

export class PDFNoPagesError extends Data.TaggedError("PDFNoPagesError")<{
  readonly message: string;
}> {}

export type PDFError = PDFPasswordRequiredError | PDFProcessingError | PDFNoPagesError;

// Baseline position and rotation use source PDF coordinates. Size is physical points.
export interface AddedText {
  readonly id: string;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly fontSize: number;
  readonly rotation: number;
}

// Anchor and rotation use source PDF coordinates. Size is physical points.
export interface AddedCheckmark {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly rotation: number;
}

export interface PageGeometry {
  readonly bounds: readonly [number, number, number, number];
  readonly userUnit: number;
  readonly transform: readonly [number, number, number, number, number, number];
  readonly width: number;
  readonly height: number;
}

export interface FieldAnswer {
  readonly fieldRef: string;
  readonly value: string;
}

export interface TextFieldWidget {
  readonly widgetRef: string;
  readonly fieldRef: string;
  readonly pageNumber: number;
  readonly label: string;
  readonly value: string;
  readonly rect: readonly [number, number, number, number];
  readonly maxLength?: number;
  readonly reason?: string;
}

export interface PDFFields {
  readonly widgets: readonly TextFieldWidget[];
  readonly reason?: string;
}

export interface PageState {
  id: string;
  sourceFile: File;
  sourcePageNumber: number;
  rotation: number;
  markedForDeletion: boolean;
  fieldGroupId?: string;
  fieldAnswers?: readonly FieldAnswer[];
  addedText?: readonly AddedText[];
  addedCheckmarks?: readonly AddedCheckmark[];
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
