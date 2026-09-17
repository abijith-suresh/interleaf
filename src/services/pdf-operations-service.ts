import { degrees, PDFDocument } from "pdf-lib";
import { OUTPUT_FILENAME } from "../constants";
import type { PageState, PDFBuildProgress, PDFOperationResult } from "../types/interfaces";
import { pdfService } from "./pdf-service";

const ENCRYPTED_PAGE_RENDER_SCALE = 2;

interface PDFBuildOptions {
  selectedIndices?: number[];
  onProgress?: (progress: PDFBuildProgress) => void;
}

function normalizeRotation(rotation: number): number {
  const normalized = rotation % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

export class PDFOperationsService {
  // Class-level cache: avoids re-reading the same File on multiple build
  // calls within one session. Cleared on session reset via clearCache().
  private sourceDocCache = new Map<File, PDFDocument>();

  /**
   * Clears cached source documents for the current editor session.
   *
   * @returns Nothing.
   */
  clearCache(): void {
    this.sourceDocCache.clear();
  }

  /**
   * Builds a new PDF from every active page, or from the selected active pages.
   *
   * @param pages - The current editor page state to export.
   * @param options - Optional selected page indices and progress callback.
   * @returns The generated PDF bytes and a suggested download filename.
   * @throws {Error} When there are no active pages to include in the output.
   */
  async buildPDF(pages: PageState[], options: PDFBuildOptions = {}): Promise<PDFOperationResult> {
    const pagesToBuild = options.selectedIndices
      ? options.selectedIndices
          .map((index) => pages[index])
          .filter((page): page is PageState => Boolean(page) && !page.markedForDeletion)
      : pages.filter((page) => !page.markedForDeletion);

    return this.buildOutputFromPages(
      pagesToBuild,
      "No pages to include in the PDF",
      OUTPUT_FILENAME,
      options.onProgress
    );
  }

  private async buildOutputFromPages(
    pagesToBuild: PageState[],
    emptyStateMessage: string,
    suggestedFileName: string,
    onProgress?: (progress: PDFBuildProgress) => void
  ): Promise<PDFOperationResult> {
    if (pagesToBuild.length === 0) {
      throw new Error(emptyStateMessage);
    }

    const outputDoc = await PDFDocument.create();

    for (const [index, page] of pagesToBuild.entries()) {
      const sourceDoc = await this.getOrLoadSourceDoc(page.sourceFile);

      if (sourceDoc.isEncrypted) {
        await this.addEncryptedPage(outputDoc, sourceDoc, page);
      } else {
        const [copiedPage] = await outputDoc.copyPages(sourceDoc, [page.sourcePageNumber - 1]);
        const sourceRotation = normalizeRotation(copiedPage.getRotation().angle);
        const combinedRotation = normalizeRotation(sourceRotation + page.rotation);

        if (combinedRotation !== sourceRotation) {
          copiedPage.setRotation(degrees(combinedRotation));
        }

        outputDoc.addPage(copiedPage);
      }

      onProgress?.({ completed: index + 1, total: pagesToBuild.length });
    }

    const data = await outputDoc.save();

    return {
      data: new Uint8Array(data),
      suggestedFileName,
    };
  }

  private async getOrLoadSourceDoc(file: File): Promise<PDFDocument> {
    const cachedDocument = this.sourceDocCache.get(file);
    if (cachedDocument) {
      return cachedDocument;
    }

    const buffer = await file.arrayBuffer();
    // ignoreEncryption: true is a no-op for unencrypted PDFs and allows loading
    // owner-password PDFs. For user-password PDFs, content streams remain encrypted
    // (pdf-lib has no decryption support), so output quality is not guaranteed.
    const sourceDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    this.sourceDocCache.set(file, sourceDoc);
    return sourceDoc;
  }

  private async addEncryptedPage(
    outputDoc: PDFDocument,
    sourceDoc: PDFDocument,
    page: PageState
  ): Promise<void> {
    // pdf-lib can read the page tree of an encrypted document with
    // ignoreEncryption, but it cannot decrypt the page content streams. PDF.js
    // already has the unlocked document for the editor, so render the page
    // locally and place that result into a fresh, unencrypted PDF page.
    const sourcePage = sourceDoc.getPage(page.sourcePageNumber - 1);
    const sourceRotation = normalizeRotation(sourcePage.getRotation().angle);
    const combinedRotation = normalizeRotation(sourceRotation + page.rotation);
    const width = sourcePage.getWidth();
    const height = sourcePage.getHeight();
    const canvas = document.createElement("canvas");

    await pdfService.renderPage(
      page.sourceFile,
      page.sourcePageNumber,
      canvas,
      ENCRYPTED_PAGE_RENDER_SCALE,
      0
    );

    const image = await outputDoc.embedPng(canvas.toDataURL("image/png"));
    const outputPage = outputDoc.addPage([width, height]);

    outputPage.drawImage(image, { x: 0, y: 0, width, height });
    outputPage.setRotation(degrees(combinedRotation));
  }
}

export const pdfOperationsService = new PDFOperationsService();
