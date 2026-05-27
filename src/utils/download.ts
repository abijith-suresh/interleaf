import type { PDFOperationResult } from "../types/interfaces";

export function downloadPDF(result: PDFOperationResult): void {
  const blob = new Blob([result.data as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = result.suggestedFileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
