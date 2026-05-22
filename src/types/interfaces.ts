type EncryptionReason = "needs-password" | "wrong-password";

export class PDFPasswordRequiredError extends Error {
  readonly file: File;
  readonly reason: EncryptionReason;

  constructor(file: File, reason: EncryptionReason = "needs-password") {
    super(`PDF requires a password: ${file.name}`);
    this.name = "PDFPasswordRequiredError";
    this.file = file;
    this.reason = reason;
  }
}

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

export interface PDFBuildProgress {
  completed: number;
  total: number;
}
