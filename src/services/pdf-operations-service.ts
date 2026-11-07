import { Effect } from "effect";
import { degrees, PageSizes, PDFDocument } from "pdf-lib";
import { IMAGES_TO_PDF_FILENAME } from "../constants";
import type {
  FieldAnswer,
  PageState,
  PDFBuildProgress,
  PDFError,
  PDFFields,
  PDFOperationResult,
} from "../types/interfaces";
import { PDFNoPagesError, PDFProcessingError } from "../types/interfaces";
import { fileStem } from "../utils/file-names";
import { getSupportedFileKind } from "../utils/file-types";
import { type DocumentKey, type DocumentStore, makeDocumentStore } from "./document-store";
import { drawPageAdditions } from "./pdf-additions";
import { processingError } from "./pdf-errors";
import { PDFExportCopy, type PDFExportSource, validatePDFSourcePages } from "./pdf-export-copy";
import { applyFieldAnswers, inspectPDFFields } from "./pdf-fields";
import type { PDFService } from "./pdf-service";

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

interface ExportSource {
  readonly doc: PDFDocument;
  // The source File itself, or its decrypted copy when the source is encrypted.
  readonly file: File;
  readonly decrypted: boolean;
}

export class PDFOperationsService {
  private readonly store: DocumentStore<ExportSource>;
  // Field inspection is a pure function of the File's bytes. Keep only the
  // small result, not a parsed document, until the File is released.
  private readonly fields = new Map<File, Promise<PDFFields>>();

  constructor(
    private readonly pdfService: Partial<Pick<PDFService, "getPageGeometry" | "getExportSource">>
  ) {
    this.store = makeDocumentStore<ExportSource>({
      load: (key) =>
        Effect.gen({ self: this }, function* () {
          // ignoreEncryption is enough to see whether the trailer has /Encrypt.
          // pdf-lib cannot decrypt object streams, so encrypted sources export
          // from a copy that PDFService decrypts with qpdf.
          const original = yield* Effect.tryPromise({
            try: async () =>
              PDFDocument.load(await key.file.arrayBuffer(), { ignoreEncryption: true }),
            catch: (cause) => processingError("load-source", key.file, cause),
          });
          if (!original.isEncrypted) return { doc: original, file: key.file, decrypted: false };
          if (!this.pdfService.getExportSource)
            return yield* Effect.fail(
              processingError(
                "load-source",
                key.file,
                new Error("Protected PDFs cannot be prepared for export.")
              )
            );
          const file = yield* this.pdfService.getExportSource(key.file);
          const doc = yield* Effect.tryPromise({
            try: async () => PDFDocument.load(await file.arrayBuffer()),
            catch: (cause) => processingError("load-source", key.file, cause),
          });
          return { doc, file, decrypted: true };
        }),
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
    return Effect.sync(() => this.fields.clear()).pipe(
      Effect.andThen(this.store.clear),
      Effect.catch((error) => Effect.logWarning(error))
    );
  }

  releaseFile(file: File): Effect.Effect<void> {
    return Effect.sync(() => this.fields.delete(file)).pipe(
      Effect.andThen(this.store.releaseFile(file)),
      Effect.catch((error) => Effect.logWarning(error))
    );
  }

  dispose(): Effect.Effect<void> {
    return Effect.sync(() => this.fields.clear()).pipe(Effect.andThen(this.store.dispose()));
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
                  x: x + drawHeight,
                  y: y + drawWidth,
                  width: -drawWidth,
                  height: drawHeight,
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
                  x,
                  y,
                  width: drawWidth,
                  height: -drawHeight,
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
        data,
        suggestedFileName: IMAGES_TO_PDF_FILENAME,
      };
    });
  }

  getFields(file: File): Effect.Effect<PDFFields, PDFProcessingError> {
    return Effect.tryPromise({
      try: () => {
        const cached = this.fields.get(file);
        if (cached) return cached;
        const inspection = (async () => {
          const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
          if (!doc.isEncrypted) validatePDFSourcePages(doc, file);
          return inspectPDFFields(doc);
        })();
        this.fields.set(file, inspection);
        // A failed read stays retryable. Release may already have dropped it.
        inspection.catch(() => {
          if (this.fields.get(file) === inspection) this.fields.delete(file);
        });
        return inspection;
      },
      catch: (cause) => processingError("read-fields", file, cause),
    });
  }

  validateFieldAnswer(
    file: File,
    answer: FieldAnswer,
    pageNumbers: readonly number[]
  ): Effect.Effect<void, PDFProcessingError> {
    return Effect.tryPromise({
      try: async () => {
        const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
        validatePDFSourcePages(doc, file);
        await applyFieldAnswers(doc, [answer], pageNumbers);
      },
      catch: (cause) => processingError("fill-field", file, cause),
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

      const sourceDocuments = new Map<File, ExportSource>();
      const privateSources: PDFExportSource[] = [];
      const scopes = new Map<File, Set<string>>();
      for (const page of pagesToBuild) {
        const sourceFile = page.sourceFile;
        let source = sourceDocuments.get(sourceFile);
        if (!source) {
          source = yield* this.store.acquire(sourceDocumentKey(sourceFile));
          const validatedSource = source.doc;
          yield* Effect.try({
            try: () => validatePDFSourcePages(validatedSource, sourceFile),
            catch: (cause) =>
              cause instanceof PDFProcessingError
                ? cause
                : processingError("inspect-source", sourceFile, cause),
          });
          sourceDocuments.set(sourceFile, source);
        }
        if (source.decrypted && page.fieldAnswers?.length)
          return yield* Effect.fail(
            processingError(
              "fill-field",
              sourceFile,
              new Error("Embedded filling is unavailable for protected PDFs.")
            )
          );
        const exportFile = source.file;
        const scope = page.fieldAnswers?.length ? (page.fieldGroupId ?? "") : "";
        const prepared = scopes.get(sourceFile) ?? new Set<string>();
        if (prepared.has(scope)) continue;
        prepared.add(scope);
        scopes.set(sourceFile, prepared);
        // Private per-build scopes never replace original Files or the cached source.
        const doc = yield* Effect.tryPromise({
          try: async () => {
            const doc = await PDFDocument.load(await exportFile.arrayBuffer());
            const group = pages.filter(
              (candidate) =>
                candidate.sourceFile === sourceFile && candidate.fieldGroupId === page.fieldGroupId
            );
            if (
              group.some(
                (candidate) =>
                  JSON.stringify(candidate.fieldAnswers ?? []) !==
                  JSON.stringify(page.fieldAnswers ?? [])
              )
            )
              throw new Error("Linked field answers differ.");
            await applyFieldAnswers(
              doc,
              page.fieldAnswers ?? [],
              group.map((candidate) => candidate.sourcePageNumber)
            );
            await doc.flush();
            return doc;
          },
          catch: (cause) => processingError("prepare-export", sourceFile, cause),
        });
        privateSources.push({ file: sourceFile, doc, scope });
      }
      const exportCopy = yield* Effect.try({
        try: () => new PDFExportCopy(outputDoc, privateSources),
        catch: (cause) =>
          cause instanceof PDFProcessingError
            ? cause
            : processingError("prepare-export", pagesToBuild[0].sourceFile, cause),
      });
      // Every source is unencrypted here, so all pages are copied in one batch.
      const copiedPages = yield* Effect.tryPromise({
        try: () =>
          exportCopy.copyPages(
            pagesToBuild.map((page) => ({
              file: page.sourceFile,
              pageNumber: page.sourcePageNumber,
              scope: page.fieldAnswers?.length ? (page.fieldGroupId ?? "") : "",
              editable: Boolean(page.addedText?.length || page.addedCheckmarks?.length),
            }))
          ),
        catch: (cause) =>
          cause instanceof PDFProcessingError
            ? cause
            : processingError("copy-page", pagesToBuild[0].sourceFile, cause),
      });

      for (const [index, page] of pagesToBuild.entries()) {
        const copiedPage = copiedPages[index];
        if (!copiedPage)
          return yield* Effect.fail(
            processingError(
              "copy-page",
              page.sourceFile,
              new Error("PDF source page was not returned")
            )
          );
        if (page.addedText?.length || page.addedCheckmarks?.length) {
          if (!this.pdfService.getPageGeometry)
            return yield* Effect.fail(
              processingError(
                "draw-text",
                page.sourceFile,
                new Error("Page geometry is unavailable.")
              )
            );
          const geometry = yield* this.pdfService.getPageGeometry(
            page.sourceFile,
            page.sourcePageNumber
          );
          yield* Effect.tryPromise({
            try: () => drawPageAdditions(outputDoc, copiedPage, page, geometry),
            catch: (cause) => processingError("draw-text", page.sourceFile, cause),
          });
        }
        yield* Effect.try({
          try: () => {
            const sourceRotation = normalizeRotation(copiedPage.getRotation().angle);
            const combinedRotation = normalizeRotation(sourceRotation + page.rotation);

            if (combinedRotation !== sourceRotation) {
              copiedPage.setRotation(degrees(combinedRotation));
            }

            outputDoc.addPage(copiedPage);
          },
          catch: (cause) => processingError("add-page", page.sourceFile, cause),
        });

        yield* Effect.try({
          try: () => {
            options.onProgress?.({ completed: index + 1, total: pagesToBuild.length });
          },
          catch: (cause) => processingError("report-progress", page.sourceFile, cause),
        });
      }

      yield* Effect.tryPromise({
        try: () => exportCopy.finish(),
        catch: (cause) =>
          cause instanceof PDFProcessingError
            ? cause
            : processingError("reconcile-export", pagesToBuild[0].sourceFile, cause),
      });
      const data = yield* Effect.tryPromise({
        try: () => outputDoc.save(),
        catch: (cause) => processingError("save-output", pagesToBuild[0].sourceFile, cause),
      });

      return { data, suggestedFileName: `${fileStem(pagesToBuild[0].sourceFile.name)}-edited.pdf` };
    });
  }
}
