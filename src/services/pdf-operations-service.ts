import { Deferred, Effect, Fiber } from "effect";
import { degrees, PDFDocument } from "pdf-lib";
import { OUTPUT_FILENAME } from "../constants";
import type {
  PageState,
  PDFBuildProgress,
  PDFError,
  PDFOperationResult,
} from "../types/interfaces";
import { PDFNoPagesError, PDFProcessingError } from "../types/interfaces";
import type { PDFService } from "./pdf-service";

const ENCRYPTED_PAGE_RENDER_SCALE = 2;

export interface PDFBuildOptions {
  readonly selectedIndices?: readonly number[];
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

interface InFlightSourceDocument {
  readonly deferred: Deferred.Deferred<PDFDocument, PDFProcessingError>;
  fiber: Fiber.Fiber<PDFDocument, PDFProcessingError> | null;
}

export class PDFOperationsService {
  private sourceDocCache = new Map<File, PDFDocument>();
  private sourceDocEffects = new Map<File, InFlightSourceDocument>();
  private cacheVersion = 0;

  constructor(private readonly pdfService: Pick<PDFService, "renderPage">) {}

  clearCache(): Effect.Effect<void> {
    return Effect.suspend(() => {
      const fibers = Array.from(this.sourceDocEffects.values())
        .map((load) => load.fiber)
        .filter((fiber): fiber is Fiber.Fiber<PDFDocument, PDFProcessingError> => fiber !== null);
      this.sourceDocCache.clear();
      this.sourceDocEffects.clear();
      this.cacheVersion += 1;

      return Effect.forEach(fibers, Fiber.interrupt, { discard: true });
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
      const load: InFlightSourceDocument = { deferred, fiber: null };
      this.sourceDocEffects.set(file, load);
      const version = this.cacheVersion;
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
            if (version === this.cacheVersion) {
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

      return Effect.gen(function* () {
        load.fiber = yield* Effect.forkDetach(loadEffect);
        return yield* Deferred.await(load.deferred);
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
