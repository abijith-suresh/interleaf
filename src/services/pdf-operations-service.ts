import { Deferred, Effect, Fiber } from "effect";
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

function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message) return cause.message;
  if (typeof cause === "string" && cause.length > 0) return cause;
  return fallback;
}

function processingError(operation: string, file: File, cause: unknown): PDFProcessingError {
  return new PDFProcessingError({
    operation,
    file,
    cause,
    message: errorMessage(cause, `PDF ${operation} failed.`),
  });
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

interface InFlightSourceDocument {
  readonly deferred: Deferred.Deferred<PDFDocument, PDFProcessingError>;
  readonly file: File;
  fiber: Fiber.Fiber<PDFDocument, PDFProcessingError> | null;
  released: boolean;
}

type ForkDetached = <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<Fiber.Fiber<A, E>>;

export class PDFOperationsService {
  private sourceDocCache = new Map<File, PDFDocument>();
  private sourceDocEffects = new Map<File, InFlightSourceDocument>();
  private fileVersions = new WeakMap<File, number>();
  private cacheVersion = 0;

  constructor(
    private readonly pdfService: Pick<PDFService, "renderPage">,
    private readonly forkDetached: ForkDetached = Effect.forkDetach
  ) {}

  clearCache(): Effect.Effect<void> {
    return Effect.suspend(() => {
      const loads = Array.from(this.sourceDocEffects.values());
      for (const load of loads) {
        load.released = true;
      }
      this.sourceDocCache.clear();
      this.sourceDocEffects.clear();
      this.cacheVersion += 1;

      return Effect.uninterruptible(
        Effect.forEach(loads, (load) => this.cancelSourceLoad(load), { discard: true })
      );
    });
  }

  releaseFile(file: File): Effect.Effect<void> {
    return Effect.suspend(() => {
      this.fileVersions.set(file, this.getFileVersion(file) + 1);
      this.sourceDocCache.delete(file);

      const load = this.sourceDocEffects.get(file);
      if (load) {
        load.released = true;
      }
      this.sourceDocEffects.delete(file);
      if (!load) return Effect.void;

      return Effect.uninterruptible(this.cancelSourceLoad(load));
    });
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

    return this.buildOutputFromPages(
      pagesToBuild,
      "No pages to include in the PDF",
      OUTPUT_FILENAME,
      options.onProgress
    );
  }

  private buildOutputFromPages(
    pagesToBuild: readonly PageState[],
    emptyStateMessage: string,
    suggestedFileName: string,
    onProgress?: (progress: PDFBuildProgress) => void
  ): Effect.Effect<PDFOperationResult, PDFError> {
    if (pagesToBuild.length === 0) {
      return Effect.fail(new PDFNoPagesError({ message: emptyStateMessage }));
    }

    return Effect.gen({ self: this }, function* () {
      const outputDoc = yield* Effect.tryPromise({
        try: () => PDFDocument.create(),
        catch: (cause) => processingError("create-output", pagesToBuild[0].sourceFile, cause),
      });

      for (const [index, page] of pagesToBuild.entries()) {
        const sourceDoc = yield* this.getOrLoadSourceDoc(page.sourceFile);
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
            onProgress?.({ completed: index + 1, total: pagesToBuild.length });
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
          suggestedFileName,
        }),
        catch: (cause) => processingError("serialize-output", pagesToBuild[0].sourceFile, cause),
      });
    });
  }

  private getOrLoadSourceDoc(file: File): Effect.Effect<PDFDocument, PDFProcessingError> {
    return Effect.suspend(() => {
      const cachedDocument = this.sourceDocCache.get(file);
      if (cachedDocument) return Effect.succeed(cachedDocument);

      const inFlight = this.sourceDocEffects.get(file);
      if (inFlight) return Deferred.await(inFlight.deferred);

      const deferred = Deferred.makeUnsafe<PDFDocument, PDFProcessingError>();
      const load: InFlightSourceDocument = { deferred, file, fiber: null, released: false };
      this.sourceDocEffects.set(file, load);
      const cacheVersion = this.cacheVersion;
      const fileVersion = this.getFileVersion(file);
      const loadEffect = Effect.tryPromise({
        try: async () => {
          const buffer = await file.arrayBuffer();
          // ignoreEncryption allows pdf-lib to read the page tree. Encrypted page
          // content is rasterized through the already-unlocked PDF.js document.
          return PDFDocument.load(buffer, { ignoreEncryption: true });
        },
        catch: (cause) => processingError("load-source", file, cause),
      }).pipe(
        Effect.tap((sourceDoc) =>
          Effect.sync(() => {
            if (
              cacheVersion === this.cacheVersion &&
              fileVersion === this.getFileVersion(file) &&
              this.sourceDocEffects.get(file) === load
            ) {
              this.sourceDocCache.set(file, sourceDoc);
            }
          })
        ),
        Effect.onExit((exit) =>
          Deferred.done(load.deferred, exit).pipe(
            Effect.andThen(
              Effect.sync(() => {
                if (this.sourceDocEffects.get(file) !== load) return;
                this.sourceDocEffects.delete(file);
              })
            )
          )
        )
      );

      return Effect.gen({ self: this }, function* () {
        load.fiber = yield* this.forkDetached(loadEffect);
        if (load.released) {
          yield* Fiber.interrupt(load.fiber);
        }
        return yield* Deferred.await(load.deferred);
      });
    });
  }

  private cancelSourceLoad(load: InFlightSourceDocument): Effect.Effect<void> {
    return Effect.gen(function* () {
      yield* Deferred.fail(
        load.deferred,
        new PDFProcessingError({
          operation: "release-source",
          file: load.file,
          cause: new Error("The source PDF was released before loading completed."),
          message: "The source PDF was released before loading completed.",
        })
      );
      if (load.fiber) {
        yield* Fiber.interrupt(load.fiber);
      }
    });
  }

  private getFileVersion(file: File): number {
    return this.fileVersions.get(file) ?? 0;
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
