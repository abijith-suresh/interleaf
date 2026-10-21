export type { EncryptionReason, PDFError } from "../../../types/interfaces";
export {
  PDFNoPagesError,
  PDFPasswordRequiredError,
  PDFProcessingError,
} from "../../../types/interfaces";

export interface PageState {
  id: string;
  sourceFile: File;
  sourceOrigin?: File;
  sourcePageNumber: number;
  rotation: number;
  markedForDeletion: boolean;
  contentRevision?: number;
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
