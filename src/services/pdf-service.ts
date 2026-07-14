import { PDFDocument } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PDFPasswordRequiredError } from "../types/interfaces";

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

interface LoadedPDFRecord {
  pdfDocument: PDFDocument;
  pdfjsDocument: pdfjsLib.PDFDocumentProxy;
}

export class PDFService {
  private activeFile: File | null = null;
  private passwordRegistry = new Map<File, string>();
  private documentCache = new Map<File, LoadedPDFRecord>();
  private loadPromises = new Map<File, Promise<LoadedPDFRecord>>();

  /**
   * Loads a PDF into the active session without an explicit password.
   *
   * @param file - The PDF file to load.
   * @returns A promise that resolves when the file becomes active.
   * @throws {PDFPasswordRequiredError} When the PDF is user-password protected.
   */
  async loadPDF(file: File): Promise<void> {
    await this.getOrLoadDocument(file, () => this.loadDocument(file));
    this.activeFile = file;
  }

  /**
   * Loads a password-protected PDF with the supplied password.
   *
   * @param file - The PDF file to load.
   * @param password - The password to try for the document.
   * @returns A promise that resolves when the file becomes active.
   * @throws {PDFPasswordRequiredError} When the password is missing or incorrect.
   */
  async loadPDFWithPassword(file: File, password: string): Promise<void> {
    await this.getOrLoadDocument(file, () => this.loadDocument(file, password));
    this.passwordRegistry.set(file, password);
    this.activeFile = file;
  }

  /**
   * Returns the page count for the active PDF.
   *
   * @returns The active page count, or 0 when no PDF is loaded.
   */
  getPageCount(): number {
    if (!this.activeFile) {
      return 0;
    }

    return this.documentCache.get(this.activeFile)?.pdfDocument.getPageCount() ?? 0;
  }

  /**
   * Renders a page from the requested PDF onto a canvas.
   *
   * @param file - The source PDF file to render from.
   * @param pageNumber - The 1-based page number to render.
   * @param canvas - The destination canvas element.
   * @param scale - The render scale multiplier.
   * @param rotation - Optional clockwise rotation in degrees.
   * @returns A promise that resolves after rendering completes.
   * @throws {Error} When a canvas context cannot be created.
   * @throws {PDFPasswordRequiredError} When the source PDF requires a password.
   */
  async renderPage(
    file: File,
    pageNumber: number,
    canvas: HTMLCanvasElement,
    scale: number = 1.5,
    rotation: number = 0
  ): Promise<void> {
    const record = await this.getOrLoadDocument(file);
    const page = await record.pdfjsDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale, rotation });

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Could not get canvas context");
    }

    await page.render({
      canvasContext: context,
      viewport,
      canvas,
    }).promise;
  }

  /**
   * Clears the full PDF session, including cached documents and passwords.
   *
   * @returns Nothing.
   */
  reset(): void {
    this.activeFile = null;
    this.passwordRegistry.clear();

    for (const file of this.documentCache.keys()) {
      this.disposeDocument(file);
    }

    this.loadPromises.clear();
  }

  private async getOrLoadDocument(
    file: File,
    loader?: () => Promise<LoadedPDFRecord>
  ): Promise<LoadedPDFRecord> {
    const cachedRecord = this.documentCache.get(file);
    if (cachedRecord) {
      return cachedRecord;
    }

    const inFlightRecord = this.loadPromises.get(file);
    if (inFlightRecord) {
      return inFlightRecord;
    }

    const loadRecord = loader ?? (() => this.loadDocumentWithStoredPassword(file));
    const loadPromise = loadRecord()
      .then((record) => {
        this.documentCache.set(file, record);
        return record;
      })
      .finally(() => {
        this.loadPromises.delete(file);
      });

    this.loadPromises.set(file, loadPromise);
    return loadPromise;
  }

  private loadDocumentWithStoredPassword(file: File): Promise<LoadedPDFRecord> {
    const storedPassword = this.passwordRegistry.get(file);
    if (storedPassword !== undefined) {
      return this.loadDocument(file, storedPassword);
    }

    return this.loadDocument(file);
  }

  private async loadDocument(file: File, password?: string): Promise<LoadedPDFRecord> {
    const buffer = await file.arrayBuffer();
    const typedArray = new Uint8Array(buffer);

    if (password !== undefined) {
      const encryptedRecord = await this.loadEncryptedDocument(file, typedArray, buffer, password);
      this.passwordRegistry.set(file, password);
      return encryptedRecord;
    }

    try {
      const pdfDocument = await PDFDocument.load(buffer);
      const pdfjsDocument = await pdfjsLib.getDocument({ data: typedArray }).promise;

      return {
        pdfDocument,
        pdfjsDocument,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("is encrypted")) {
        return this.loadEncryptedDocument(file, typedArray, buffer, "");
      }

      throw error;
    }
  }

  private async loadEncryptedDocument(
    file: File,
    typedArray: Uint8Array,
    buffer: ArrayBuffer,
    password: string
  ): Promise<LoadedPDFRecord> {
    const pdfDocument = await PDFDocument.load(buffer, { ignoreEncryption: true });

    try {
      const pdfjsDocument = await pdfjsLib.getDocument({ data: typedArray, password }).promise;

      if (password === "") {
        this.passwordRegistry.set(file, "");
      }

      return {
        pdfDocument,
        pdfjsDocument,
      };
    } catch (error) {
      if (error instanceof Error && error.name === "PasswordException") {
        throw new PDFPasswordRequiredError(
          file,
          password === "" ? "needs-password" : "wrong-password"
        );
      }

      throw error;
    }
  }

  private disposeDocument(file: File): void {
    const record = this.documentCache.get(file);
    if (record) {
      void record.pdfjsDocument.cleanup();
    }

    this.documentCache.delete(file);
    this.loadPromises.delete(file);
  }
}

export const pdfService = new PDFService();
