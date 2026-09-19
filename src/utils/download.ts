import type { PDFOperationResult } from "../types/interfaces";

type DownloadResult = Pick<PDFOperationResult, "suggestedFileName"> & {
  data: Uint8Array | Blob;
};

export function downloadFile(result: DownloadResult, contentType: string): void {
  const blob =
    result.data instanceof Blob && result.data.type === contentType
      ? result.data
      : new Blob([result.data as BlobPart], { type: contentType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = result.suggestedFileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function downloadPDF(result: PDFOperationResult): void {
  downloadFile(result, "application/pdf");
}
