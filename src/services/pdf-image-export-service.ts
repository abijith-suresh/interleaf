import { Effect } from "effect";
import { Zip, ZipPassThrough } from "fflate";
import type { PageState, PDFError, PDFImageExportResult } from "../types/interfaces";
import { PDFNoPagesError, PDFProcessingError } from "../types/interfaces";
import type { PDFService } from "./pdf-service";

const IMAGE_EXPORT_SCALE = 2;
const MAX_IMAGE_ARCHIVE_BYTES = 128 * 1024 * 1024;
const IMAGE_EXPORT_LIMIT_MESSAGE = "Image export is too large. Export fewer pages and try again.";

export interface PDFImageExportOptions {
  readonly selectedIndices?: readonly number[];
  readonly onProgress?: (progress: { completed: number; total: number }) => void;
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

function fileStem(fileName: string): string {
  return fileName.replace(/\.pdf$/i, "").trim() || "interleaf";
}

function archiveFileName(pages: readonly PageState[]): string {
  const sourceFiles = new Set(pages.map((page) => page.sourceFile));
  if (sourceFiles.size !== 1) return "interleaf-images.zip";

  const [sourceFile] = sourceFiles;
  return `${fileStem(sourceFile?.name ?? "")}-images.zip`;
}

function imageFileName(index: number): string {
  return `page-${String(index + 1).padStart(3, "0")}.png`;
}

function canvasToPNG(
  canvas: HTMLCanvasElement,
  file: File
): Effect.Effect<Uint8Array, PDFProcessingError> {
  return Effect.gen(function* () {
    let cancelled = false;
    const blob = yield* Effect.callback<Blob, PDFProcessingError>((resume) => {
      try {
        canvas.toBlob((nextBlob) => {
          if (cancelled) return;
          if (nextBlob) {
            resume(Effect.succeed(nextBlob));
            return;
          }

          resume(
            Effect.fail(
              processingError("encode-image", file, new Error("Could not encode the page as PNG"))
            )
          );
        }, "image/png");
      } catch (cause) {
        resume(Effect.fail(processingError("encode-image", file, cause)));
      }

      return Effect.sync(() => {
        cancelled = true;
      });
    });

    return yield* Effect.tryPromise({
      try: async () => new Uint8Array(await blob.arrayBuffer()),
      catch: (cause) => processingError("read-image", file, cause),
    });
  });
}

export class PDFImageExportService {
  constructor(private readonly pdfService: Pick<PDFService, "getPageRotation" | "renderPage">) {}

  exportImages(
    pages: readonly PageState[],
    options: PDFImageExportOptions = {}
  ): Effect.Effect<PDFImageExportResult, PDFError> {
    const pagesToExport = options.selectedIndices
      ? options.selectedIndices
          .map((index) => pages[index])
          .filter((page): page is PageState => Boolean(page) && !page.markedForDeletion)
      : pages.filter((page) => !page.markedForDeletion);

    if (pagesToExport.length === 0) {
      return Effect.fail(new PDFNoPagesError({ message: "No pages to export as images" }));
    }

    return Effect.scoped(
      Effect.gen({ self: this }, function* () {
        const archiveChunks: BlobPart[] = [];
        let archiveError: unknown = null;
        let archiveBytes = 0;
        const nextArchive = yield* Effect.acquireRelease(
          Effect.sync(
            () =>
              new Zip((error, chunk) => {
                if (error) {
                  archiveError = error;
                  return;
                }
                if (!chunk) return;
                if (archiveBytes + chunk.byteLength > MAX_IMAGE_ARCHIVE_BYTES) {
                  archiveError = new PDFProcessingError({
                    operation: "image-export-limit",
                    file: pagesToExport[0].sourceFile,
                    cause: new Error(IMAGE_EXPORT_LIMIT_MESSAGE),
                    message: IMAGE_EXPORT_LIMIT_MESSAGE,
                  });
                  return;
                }
                archiveBytes += chunk.byteLength;
                archiveChunks.push(chunk);
              })
          ),
          (archive) => Effect.sync(() => archive.terminate())
        );

        for (const [index, page] of pagesToExport.entries()) {
          const canvas = yield* Effect.try({
            try: () => document.createElement("canvas"),
            catch: (cause) => processingError("create-image-canvas", page.sourceFile, cause),
          });

          const imageData = yield* Effect.gen({ self: this }, function* () {
            const sourceRotation = yield* this.pdfService.getPageRotation(
              page.sourceFile,
              page.sourcePageNumber
            );
            yield* this.pdfService.renderPage(
              page.sourceFile,
              page.sourcePageNumber,
              canvas,
              IMAGE_EXPORT_SCALE,
              (sourceRotation + page.rotation) % 360
            );
            return yield* canvasToPNG(canvas, page.sourceFile);
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                canvas.width = 0;
                canvas.height = 0;
              })
            )
          );

          yield* Effect.try({
            try: () => {
              if (archiveError) throw archiveError;
              const entry = new ZipPassThrough(imageFileName(index));
              nextArchive.add(entry);
              entry.push(imageData, true);
              if (archiveError) throw archiveError;
            },
            catch: (cause) =>
              cause instanceof PDFProcessingError
                ? cause
                : processingError("zip-images", page.sourceFile, cause),
          });

          yield* Effect.try({
            try: () => options.onProgress?.({ completed: index + 1, total: pagesToExport.length }),
            catch: (cause) => processingError("report-progress", page.sourceFile, cause),
          });
        }

        const data = yield* Effect.try({
          try: () => {
            if (archiveError) throw archiveError;
            nextArchive.end();
            if (archiveError) throw archiveError;
            return new Blob(archiveChunks, { type: "application/zip" });
          },
          catch: (cause) =>
            cause instanceof PDFProcessingError
              ? cause
              : processingError("zip-images", pagesToExport[0].sourceFile, cause),
        });

        return { data, suggestedFileName: archiveFileName(pagesToExport) };
      })
    );
  }
}
