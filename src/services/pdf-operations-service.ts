import { Effect } from "effect";
import { degrees, PageSizes, PDFDocument } from "pdf-lib";
import { IMAGES_TO_PDF_FILENAME, OUTPUT_FILENAME } from "../constants";
import type {
  PageState,
  PDFBuildProgress,
  PDFError,
  PDFOperationResult,
} from "../types/interfaces";
import { PDFNoPagesError, PDFProcessingError } from "../types/interfaces";
import { getSupportedFileKind } from "../utils/file-types";
import { type DocumentKey, type DocumentStore, makeDocumentStore } from "./document-store";
import { processingError } from "./pdf-errors";
import type { PDFService } from "./pdf-service";

const ENCRYPTED_PAGE_RENDER_SCALE = 2;

export interface PDFBuildOptions {
  readonly selectedIndices?: readonly number[];
  readonly onProgress?: (progress: PDFBuildProgress) => void;
}

export interface PDFImagesToPDFOptions {
  readonly onProgress?: (progress: PDFBuildProgress) => void;
}

function normalizeRotation(rotation: number): number {
  const normalized = rotation % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function isSupportedImageFile(file: File): boolean {
  const kind = getSupportedFileKind(file);
  return kind === "png" || kind === "jpeg";
}

type JPEGOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

function readJpegOrientation(data: ArrayBuffer): JPEGOrientation {
  const view = new DataView(data);
  if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) return 1;

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) return 1;

    const marker = view.getUint8(offset + 1);
    offset += 2;
    if (marker === 0xda || marker === 0xd9) break;

    const segmentLength = view.getUint16(offset, false);
    if (segmentLength < 2 || offset + segmentLength > view.byteLength) return 1;

    const segmentStart = offset + 2;
    const segmentEnd = offset + segmentLength;
    if (
      marker === 0xe1 &&
      segmentLength >= 16 &&
      view.getUint8(segmentStart) === 0x45 &&
      view.getUint8(segmentStart + 1) === 0x78 &&
      view.getUint8(segmentStart + 2) === 0x69 &&
      view.getUint8(segmentStart + 3) === 0x66 &&
      view.getUint8(segmentStart + 4) === 0x00 &&
      view.getUint8(segmentStart + 5) === 0x00
    ) {
      const tiffStart = segmentStart + 6;
      if (tiffStart + 8 > segmentEnd) return 1;
      const littleEndian = view.getUint16(tiffStart, false) === 0x4949;
      const readUint16 = (position: number) => view.getUint16(position, littleEndian);
      const readUint32 = (position: number) => view.getUint32(position, littleEndian);

      if (readUint16(tiffStart + 2) !== 42) return 1;
      const firstIfdOffset = readUint32(tiffStart + 4);
      const firstIfd = tiffStart + firstIfdOffset;
      if (firstIfd + 2 > segmentEnd) return 1;

      const entryCount = readUint16(firstIfd);
      for (let index = 0; index < entryCount; index += 1) {
        const entry = firstIfd + 2 + index * 12;
        if (entry + 12 > segmentEnd) return 1;
        if (readUint16(entry) !== 0x0112) continue;
        if (readUint16(entry + 2) !== 3 || readUint32(entry + 4) < 1) return 1;

        const orientation = readUint16(entry + 8);
        return orientation >= 1 && orientation <= 8 ? (orientation as JPEGOrientation) : 1;
      }
    }

    offset += segmentLength;
  }

  return 1;
}

const SOURCE_DOCUMENT_VARIANT = "source";

const sourceDocumentKey = (file: File): DocumentKey => ({
  file,
  variant: SOURCE_DOCUMENT_VARIANT,
});

export class PDFOperationsService {
  private readonly store: DocumentStore<PDFDocument>;

  constructor(private readonly pdfService: Pick<PDFService, "renderPage">) {
    this.store = makeDocumentStore<PDFDocument>({
      load: (key) => {
        const file = key.file;
        return Effect.tryPromise({
          try: async () => {
            const buffer = await file.arrayBuffer();
            // ignoreEncryption allows pdf-lib to read the page tree. Encrypted page
            // content is rasterized through the already-unlocked PDF.js document.
            return PDFDocument.load(buffer, { ignoreEncryption: true });
          },
          catch: (cause) => processingError("load-source", file, cause),
        });
      },
      cleanup: () => Effect.void,
      releaseError: (file) =>
        new PDFProcessingError({
          operation: "release-source",
          file,
          cause: new Error("The source PDF was released before loading completed."),
          message: "The source PDF was released before loading completed.",
        }),
    });
  }

  clearCache(): Effect.Effect<void> {
    return this.store.clear.pipe(Effect.catch((error) => Effect.logWarning(error)));
  }

  releaseFile(file: File): Effect.Effect<void> {
    return this.store.releaseFile(file).pipe(Effect.catch((error) => Effect.logWarning(error)));
  }

  dispose(): Effect.Effect<void> {
    return this.store.dispose();
  }

  imagesToPDF(
    files: readonly File[],
    options: PDFImagesToPDFOptions = {}
  ): Effect.Effect<PDFOperationResult, PDFProcessingError> {
    const firstFile = files[0];
    if (files.length === 0) {
      return Effect.fail(
        new PDFProcessingError({
          operation: "images-to-pdf",
          cause: new Error("No images selected"),
          message: "Choose at least one PNG or JPEG image.",
        })
      );
    }

    if (files.some((file) => !isSupportedImageFile(file))) {
      return Effect.fail(
        new PDFProcessingError({
          operation: "images-to-pdf",
          file: firstFile,
          cause: new Error("Unsupported image type"),
          message: "Only PNG and JPEG images can be converted to PDF.",
        })
      );
    }

    return Effect.gen({ self: this }, function* () {
      const outputDoc = yield* Effect.tryPromise({
        try: () => PDFDocument.create(),
        catch: (cause) => processingError("create-image-pdf", firstFile, cause),
      });

      for (const [index, file] of files.entries()) {
        const bytes = yield* Effect.tryPromise({
          try: () => file.arrayBuffer(),
          catch: (cause) => processingError("read-image", file, cause),
        });
        const image = yield* Effect.tryPromise({
          try: () =>
            getSupportedFileKind(file) === "png"
              ? outputDoc.embedPng(bytes)
              : outputDoc.embedJpg(bytes),
          catch: (cause) => processingError("embed-image", file, cause),
        });

        yield* Effect.try({
          try: () => {
            const dimensions = image.scale(1);
            const imageOrientation =
              getSupportedFileKind(file) === "jpeg" ? readJpegOrientation(bytes) : 1;
            const isQuarterTurn = imageOrientation >= 5;
            const imageWidth = isQuarterTurn ? dimensions.height : dimensions.width;
            const imageHeight = isQuarterTurn ? dimensions.width : dimensions.height;
            const [a4Width, a4Height] = PageSizes.A4;
            const pageWidth = imageWidth > imageHeight ? a4Height : a4Width;
            const pageHeight = imageWidth > imageHeight ? a4Width : a4Height;
            const scale = Math.min(pageWidth / imageWidth, pageHeight / imageHeight);
            const drawWidth = dimensions.width * scale;
            const drawHeight = dimensions.height * scale;
            const x = (pageWidth - imageWidth * scale) / 2;
            const y = (pageHeight - imageHeight * scale) / 2;
            const page = outputDoc.addPage([pageWidth, pageHeight]);

            switch (imageOrientation) {
              case 2:
                page.drawImage(image, {
                  x: x + drawWidth,
                  y,
                  width: -drawWidth,
                  height: drawHeight,
                });
                break;
              case 3:
                page.drawImage(image, {
                  x: x + drawWidth,
                  y: y + drawHeight,
                  width: -drawWidth,
                  height: -drawHeight,
                });
                break;
              case 4:
                page.drawImage(image, {
                  x,
                  y: y + drawHeight,
                  width: drawWidth,
                  height: -drawHeight,
                });
                break;
              case 5:
                page.drawImage(image, {
                  x,
                  y,
                  width: drawWidth,
                  height: -drawHeight,
                  rotate: degrees(90),
                });
                break;
              case 6:
                page.drawImage(image, {
                  x,
                  y: y + drawWidth,
                  width: drawWidth,
                  height: drawHeight,
                  rotate: degrees(-90),
                });
                break;
              case 7:
                page.drawImage(image, {
                  x: x + drawHeight,
                  y: y + drawWidth,
                  width: -drawWidth,
                  height: drawHeight,
                  rotate: degrees(90),
                });
                break;
              case 8:
                page.drawImage(image, {
                  x: x + drawHeight,
                  y,
                  width: drawWidth,
                  height: drawHeight,
                  rotate: degrees(90),
                });
                break;
              default:
                page.drawImage(image, {
                  x,
                  y,
                  width: drawWidth,
                  height: drawHeight,
                });
            }
            options.onProgress?.({ completed: index + 1, total: files.length });
          },
          catch: (cause) => processingError("add-image-page", file, cause),
        });
      }

      const data = yield* Effect.tryPromise({
        try: () => outputDoc.save(),
        catch: (cause) => processingError("save-image-pdf", firstFile, cause),
      });

      return {
        data: new Uint8Array(data),
        suggestedFileName: IMAGES_TO_PDF_FILENAME,
      };
    });
  }

  buildPDF(
    pages: readonly PageState[],
    options: PDFBuildOptions = {}
  ): Effect.Effect<PDFOperationResult, PDFError> {
    const pagesToBuild = options.selectedIndices
      ? options.selectedIndices
          .map((index) => pages[index])
          .filter((page): page is PageState => Boolean(page) && !page.markedForDeletion)
      : pages.filter((page) => !page.markedForDeletion);

    if (pagesToBuild.length === 0) {
      return Effect.fail(new PDFNoPagesError({ message: "No pages to include in the PDF" }));
    }

    return Effect.gen({ self: this }, function* () {
      const outputDoc = yield* Effect.tryPromise({
        try: () => PDFDocument.create(),
        catch: (cause) => processingError("create-output", pagesToBuild[0].sourceFile, cause),
      });

      for (const [index, page] of pagesToBuild.entries()) {
        const sourceDoc = yield* this.store.acquire(sourceDocumentKey(page.sourceFile));
        const isEncrypted = yield* Effect.try({
          try: () => sourceDoc.isEncrypted,
          catch: (cause) => processingError("inspect-source", page.sourceFile, cause),
        });

        if (isEncrypted) {
          yield* this.addEncryptedPage(outputDoc, sourceDoc, page);
        } else {
          const [copiedPage] = yield* Effect.tryPromise({
            try: () => outputDoc.copyPages(sourceDoc, [page.sourcePageNumber - 1]),
            catch: (cause) => processingError("copy-page", page.sourceFile, cause),
          });
          yield* Effect.try({
            try: () => {
              if (!copiedPage) {
                throw new Error("PDF source page was not returned");
              }

              const sourceRotation = normalizeRotation(copiedPage.getRotation().angle);
              const combinedRotation = normalizeRotation(sourceRotation + page.rotation);

              if (combinedRotation !== sourceRotation) {
                copiedPage.setRotation(degrees(combinedRotation));
              }

              outputDoc.addPage(copiedPage);
            },
            catch: (cause) => processingError("add-page", page.sourceFile, cause),
          });
        }

        yield* Effect.try({
          try: () => {
            options.onProgress?.({ completed: index + 1, total: pagesToBuild.length });
          },
          catch: (cause) => processingError("report-progress", page.sourceFile, cause),
        });
      }

      const data = yield* Effect.tryPromise({
        try: () => outputDoc.save(),
        catch: (cause) => processingError("save-output", pagesToBuild[0].sourceFile, cause),
      });

      return yield* Effect.try({
        try: () => ({
          data: new Uint8Array(data),
          suggestedFileName: OUTPUT_FILENAME,
        }),
        catch: (cause) => processingError("serialize-output", pagesToBuild[0].sourceFile, cause),
      });
    });
  }

  private addEncryptedPage(
    outputDoc: PDFDocument,
    sourceDoc: PDFDocument,
    page: PageState
  ): Effect.Effect<void, PDFError> {
    return Effect.gen({ self: this }, function* () {
      const { canvas, combinedRotation, height, width } = yield* Effect.try({
        try: () => {
          const sourcePage = sourceDoc.getPage(page.sourcePageNumber - 1);
          const sourceRotation = normalizeRotation(sourcePage.getRotation().angle);
          const combinedRotation = normalizeRotation(sourceRotation + page.rotation);

          return {
            canvas: document.createElement("canvas"),
            combinedRotation,
            height: sourcePage.getHeight(),
            width: sourcePage.getWidth(),
          };
        },
        catch: (cause) => processingError("prepare-page", page.sourceFile, cause),
      });

      yield* this.pdfService.renderPage(
        page.sourceFile,
        page.sourcePageNumber,
        canvas,
        ENCRYPTED_PAGE_RENDER_SCALE,
        0
      );

      const image = yield* Effect.tryPromise({
        try: () => outputDoc.embedPng(canvas.toDataURL("image/png")),
        catch: (cause) => processingError("embed-page", page.sourceFile, cause),
      });
      yield* Effect.try({
        try: () => {
          const outputPage = outputDoc.addPage([width, height]);
          outputPage.drawImage(image, { x: 0, y: 0, width, height });
          outputPage.setRotation(degrees(combinedRotation));
        },
        catch: (cause) => processingError("add-page", page.sourceFile, cause),
      });
    });
  }
}
