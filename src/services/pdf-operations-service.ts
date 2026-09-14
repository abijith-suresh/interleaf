import { degrees, PDFDocument } from "pdf-lib";
import { EXTRACT_FILENAME, OUTPUT_FILENAME } from "../constants";
import type { PageState, PDFBuildProgress, PDFOperationResult } from "../types/interfaces";
import { pdfService } from "./pdf-service";

const ENCRYPTED_PAGE_RENDER_SCALE = 2;

function normalizeRotation(rotation: number): number {
  const normalized = rotation % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

export class PDFOperationsService {
  // Class-level cache: avoids re-reading the same File on multiple build/extract
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
   * Builds a new PDF from every page that is not marked for deletion.
   *
   * @param pages - The current editor page state to export.
   * @param onProgress - Optional callback invoked after each page is copied.
   * @returns The generated PDF bytes and a suggested download filename.
   * @throws {Error} When there are no active pages to include in the output.
   */
  async buildPDF(
    pages: PageState[],
    onProgress?: (progress: PDFBuildProgress) => void
  ): Promise<PDFOperationResult> {
    const activePages = pages.filter((page) => !page.markedForDeletion);

    return this.buildOutputFromPages(
      activePages,
      "No pages to include in the PDF",
      OUTPUT_FILENAME,
      onProgress
    );
  }

  /**
   * Builds a new PDF from a subset of the current editor pages.
   *
   * @param pages - The full editor page state for the current session.
   * @param indices - The page indices to include in the extracted output.
   * @param onProgress - Optional callback invoked after each selected page is copied.
   * @returns The generated PDF bytes and a suggested extract filename.
   * @throws {Error} When the requested subset resolves to no exportable pages.
   */
  async buildPDFFromSubset(
    pages: PageState[],
    indices: number[],
    onProgress?: (progress: PDFBuildProgress) => void
  ): Promise<PDFOperationResult> {
    const subsetPages = indices
      .map((index) => pages[index])
      .filter((page): page is PageState => Boolean(page));

    return this.buildOutputFromPages(
      subsetPages,
      "No pages selected for extraction",
      EXTRACT_FILENAME,
      onProgress
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
