import { Cause, Deferred, Effect, Exit, Fiber, Option, Semaphore } from "effect";
import type * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { hasPageAdditions } from "../controllers/editor-additions-state";
import {
  type PageGeometry,
  type PageState,
  type PDFError,
  PDFPasswordRequiredError,
  type PDFProcessingError,
} from "../types/interfaces";
import { type DocumentKey, makeDocumentStore } from "./document-store";
import { PageRenderer } from "./page-renderer";
import { PageResources } from "./page-resources";
import { collectFirstError, processingError } from "./pdf-errors";

let pdfjsModule: Promise<typeof pdfjsLib> | null = null;

function loadPdfjs(): Promise<typeof pdfjsLib> {
  pdfjsModule ??= import("pdfjs-dist").then((module) => {
    module.GlobalWorkerOptions.workerSrc = pdfjsWorker;
    return module;
  });
  return pdfjsModule;
}

interface PageMetadata extends PageGeometry {
  readonly rotation: number;
  readonly width: number;
  readonly height: number;
}

// Adapt the prototype's entry cap per loaded document, retaining only scalars.
const PAGE_METADATA_LIMIT = 512;

interface LoadedPDFRecord {
  // PDF.js is enough for page counts, password handling, and thumbnails. The
  // export service loads pdf-lib only when it needs to build a new document.
  readonly file: File;
  readonly pdfjsDocument: pdfjsLib.PDFDocumentProxy;
  readonly loadingTask: ReturnType<typeof pdfjsLib.getDocument>;
  readonly pageMetadata: Map<number, PageMetadata>;
  readonly measuring: Map<number, Deferred.Deferred<Exit.Exit<PageMetadata, PDFProcessingError>>>;
}

function isPasswordException(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "name" in cause &&
    cause.name === "PasswordException"
  );
}

const AUTO_VARIANT = "auto";
const PASSWORD_VARIANT_PREFIX = "password:";

export class PDFService {
  private activeFile: File | null = null;
  private passwordRegistry = new Map<File, string>();
  private readonly documents = makeDocumentStore<LoadedPDFRecord>({
    load: (key) => this.loadDocumentRecord(key),
    cleanup: (record) => this.cleanupRecord(record),
    drain: (file) => this.pageResources.drain(file),
  });
  private readonly pageResources = new PageResources();
  private readonly pageRenderer = new PageRenderer();
  // Bound source reads and PDF generation too, before the shared bitmap permit.
  private readonly editedRenders = Semaphore.makeUnsafe(2);

  loadPDF(file: File): Effect.Effect<void, PDFError> {
    const version = this.documents.version(file);

    return this.documents.gate(
      file,
      "load-pdf"
    )(
      this.documents.acquire({ file, variant: AUTO_VARIANT }).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            if (this.documents.isCurrent(file, version)) {
              this.activeFile = file;
            }
          })
        ),
        Effect.asVoid
      )
    );
  }

  loadPDFWithPassword(file: File, password: string): Effect.Effect<void, PDFError> {
    const version = this.documents.version(file);

    return this.documents.gate(
      file,
      "load-pdf-with-password"
    )(
      Effect.suspend(() => {
        const storedPassword = this.passwordRegistry.get(file);
        if (storedPassword !== undefined && storedPassword !== password) {
          return Effect.fail(new PDFPasswordRequiredError(file, "wrong-password"));
        }

        return this.documents
          .acquire({ file, variant: `${PASSWORD_VARIANT_PREFIX}${password}` })
          .pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                if (!this.documents.isCurrent(file, version)) return;
                this.passwordRegistry.set(file, password);
                this.activeFile = file;
              })
            ),
            Effect.asVoid
          );
      })
    );
  }

  getPageCount(): number {
    if (!this.activeFile) return 0;
    return Option.match(this.documents.peek(this.activeFile), {
      onNone: () => 0,
      onSome: (record) => record.pdfjsDocument.numPages,
    });
  }

  getPassword(file: File): string | undefined {
    return this.passwordRegistry.get(file);
  }

  getPageRotation(file: File, pageNumber: number): Effect.Effect<number, PDFError> {
    return this.documents.track(
      file,
      "get-page-rotation"
    )(
      Effect.gen({ self: this }, function* () {
        const record = yield* this.documents.acquire({ file, variant: AUTO_VARIANT });
        const metadata = yield* this.getPageMetadata(record, pageNumber, "get-page-rotation");
        return metadata.rotation;
      })
    );
  }

  getPageSize(
    file: File,
    pageNumber: number,
    rotation = 0
  ): Effect.Effect<{ readonly width: number; readonly height: number }, PDFError> {
    return this.documents.track(
      file,
      "get-page-size"
    )(
      Effect.gen({ self: this }, function* () {
        const record = yield* this.documents.acquire({ file, variant: AUTO_VARIANT });
        const metadata = yield* this.getPageMetadata(record, pageNumber, "get-page-size");
        return yield* Effect.try({
          try: () => {
            // PDF.js normalizes requested rotations before accepting quarter-turns.
            let normalized = rotation % 360;
            if (normalized < 0) normalized += 360;
            switch (normalized) {
              case 0:
              case 180:
                return { width: metadata.width, height: metadata.height };
              case 90:
              case 270:
                return { width: metadata.height, height: metadata.width };
              default:
                throw new Error(
                  "PageViewport: Invalid rotation, must be a multiple of 90 degrees."
                );
            }
          },
          catch: (cause) => processingError("get-page-size", file, cause),
        });
      })
    );
  }

  getPageGeometry(file: File, pageNumber: number): Effect.Effect<PageGeometry, PDFError> {
    return this.documents.track(
      file,
      "get-page-geometry"
    )(
      Effect.gen({ self: this }, function* () {
        const record = yield* this.documents.acquire({ file, variant: AUTO_VARIANT });
        return yield* this.getPageMetadata(record, pageNumber, "get-page-geometry");
      })
    );
  }

  renderPageState(
    page: PageState,
    canvas: HTMLCanvasElement,
    scale: number,
    rotation: number,
    maxRasterPixels?: number
  ): Effect.Effect<void, PDFError> {
    if (!hasPageAdditions(page))
      return this.renderPage(page.sourceFile, page.sourcePageNumber, canvas, scale, rotation);
    // No derived-document cache. The temporary file lives until render cancellation
    // and page cleanup settle, then its loading task is destroyed.
    return this.documents.track(
      page.sourceFile,
      "render-edited-page"
    )(
      this.editedRenders.withPermit(
        Effect.gen({ self: this }, function* () {
          const { PDFOperationsService } = yield* Effect.tryPromise({
            try: () => import("./pdf-operations-service"),
            catch: (cause) => processingError("load-text-renderer", page.sourceFile, cause),
          });
          return yield* Effect.acquireUseRelease(
            Effect.sync(() => new PDFOperationsService(this)),
            (operations) =>
              Effect.gen({ self: this }, function* () {
                // Source metadata/render calls track their own fiber. Keep this
                // outer source operation registered until derived cleanup completes.
                const result = yield* Effect.acquireUseRelease(
                  Effect.forkChild(
                    operations.buildPDF([{ ...page, rotation: 0, markedForDeletion: false }], {
                      maxRasterPixels,
                    })
                  ),
                  Fiber.join,
                  (fiber) => Fiber.interrupt(fiber).pipe(Effect.asVoid)
                );
                const temporary = new File([new Uint8Array(result.data)], "edited-page.pdf", {
                  type: "application/pdf",
                });
                // This store must be separate from the source store. A source reset
                // waits for this fiber; its finalizer must not await that reset barrier.
                yield* Effect.acquireUseRelease(
                  Effect.sync(() => new PDFService()),
                  (derived) =>
                    this.pageRenderer.withPermit(
                      derived.renderPage(temporary, 1, canvas, scale, rotation)
                    ),
                  (derived) => derived.dispose()
                );
              }),
            (operations) => operations.dispose()
          );
        })
      )
    );
  }

  private getPageMetadata(
    record: LoadedPDFRecord,
    pageNumber: number,
    operation: string
  ): Effect.Effect<PageMetadata, PDFProcessingError> {
    const file = record.file;
    return Effect.suspend(() => {
      const cached = record.pageMetadata.get(pageNumber);
      if (cached) {
        record.pageMetadata.delete(pageNumber);
        record.pageMetadata.set(pageNumber, cached);
        return Effect.succeed(cached);
      }
      const pending = record.measuring.get(pageNumber);
      if (pending) {
        return Deferred.await(pending).pipe(
          Effect.flatMap((exit) => {
            if (Exit.isSuccess(exit)) return Effect.succeed(exit.value);
            // Only the owner was cancelled. An independent live caller can take
            // over after its cleanup, unless release/reset retired this load.
            if (exit.cause.reasons.every(Cause.isInterruptReason)) {
              const resident = this.documents.peek(file);
              if (Option.isSome(resident) && resident.value === record) {
                return this.getPageMetadata(record, pageNumber, operation);
              }
            }
            return Effect.failCause(
              Cause.map(exit.cause, (error) => processingError(operation, file, error.cause))
            );
          })
        );
      }

      const completion = Deferred.makeUnsafe<Exit.Exit<PageMetadata, PDFProcessingError>>();
      record.measuring.set(pageNumber, completion);
      return this.pageResources
        .withPageCleanup(
          file,
          pageNumber,
          this.pageResources.getPage(record.pdfjsDocument, file, pageNumber, operation),
          (page) =>
            Effect.try({
              try: () => {
                // An explicit zero rotation gives CropBox/UserUnit dimensions without
                // applying the intrinsic rotation that getPageRotation reports.
                const viewport = page.getViewport({ scale: 1, rotation: 0 });
                return {
                  rotation: page.rotate,
                  width: viewport.width,
                  height: viewport.height,
                  bounds: [...page.view] as [number, number, number, number],
                  userUnit: page.userUnit,
                  transform: [...viewport.transform] as [
                    number,
                    number,
                    number,
                    number,
                    number,
                    number,
                  ],
                };
              },
              catch: (cause) => processingError(operation, file, cause),
            })
        )
        .pipe(
          Effect.tap((metadata) =>
            Effect.sync(() => {
              // Release/reset removes the resident before interrupting operations.
              // Only publish after page cleanup and while this exact load is resident.
              const resident = this.documents.peek(file);
              if (Option.isNone(resident) || resident.value !== record) return;
              record.pageMetadata.set(pageNumber, metadata);
              if (record.pageMetadata.size > PAGE_METADATA_LIMIT) {
                const oldest = record.pageMetadata.keys().next().value;
                if (oldest !== undefined) record.pageMetadata.delete(oldest);
              }
            })
          ),
          Effect.onExit((exit) =>
            Effect.sync(() => record.measuring.delete(pageNumber)).pipe(
              Effect.andThen(Deferred.succeed(completion, exit))
            )
          )
        );
    });
  }

  renderPage(
    file: File,
    pageNumber: number,
    canvas: HTMLCanvasElement,
    scale = 1.5,
    rotation = 0
  ): Effect.Effect<void, PDFError> {
    return this.documents.track(
      file,
      "render-page"
    )(
      Effect.gen({ self: this }, function* () {
        const record = yield* this.documents.acquire({ file, variant: AUTO_VARIANT });
        yield* this.pageRenderer.withPermit(
          this.pageResources.withPageCleanup(
            file,
            pageNumber,
            this.pageResources.getPage(record.pdfjsDocument, file, pageNumber, "render-page"),
            (page) =>
              Effect.gen({ self: this }, function* () {
                const { context, viewport } = yield* Effect.try({
                  try: () => {
                    const nextViewport = page.getViewport({ scale, rotation });
                    canvas.width = nextViewport.width;
                    canvas.height = nextViewport.height;

                    const nextContext = canvas.getContext("2d");
                    if (!nextContext) {
                      throw new Error("Could not get canvas context");
                    }

                    return { context: nextContext, viewport: nextViewport };
                  },
                  catch: (cause) => processingError("render-page", file, cause),
                });

                yield* this.pageRenderer.render(file, page, canvas, context, viewport);
              })
          )
        );
      })
    );
  }

  releaseFile(file: File): Effect.Effect<void, PDFProcessingError> {
    return Effect.uninterruptible(
      Effect.suspend(() => {
        if (this.activeFile === file) this.activeFile = null;
        this.passwordRegistry.delete(file);
        return this.documents.releaseFile(file);
      })
    );
  }

  reset(): Effect.Effect<void, PDFProcessingError> {
    return Effect.uninterruptible(
      Effect.suspend(() => {
        this.activeFile = null;
        this.passwordRegistry.clear();
        return this.documents.reset;
      })
    );
  }

  dispose(): Effect.Effect<void> {
    return this.documents.dispose();
  }

  private cleanupRecord(record: LoadedPDFRecord): Effect.Effect<void, PDFProcessingError> {
    return collectFirstError([
      Effect.sync(() => record.pageMetadata.clear()),
      Effect.tryPromise({
        try: () => Promise.resolve(record.pdfjsDocument.cleanup()),
        catch: (cause) => processingError("cleanup-pdf-js", record.file, cause),
      }),
      this.destroyLoadingTaskForFile(record.file, record.loadingTask),
    ]);
  }

  private destroyLoadingTaskForFile(
    file: File,
    loadingTask: ReturnType<typeof pdfjsLib.getDocument>
  ): Effect.Effect<void, PDFProcessingError> {
    return Effect.tryPromise({
      try: () => loadingTask.destroy(),
      catch: (cause) => processingError("destroy-pdf-js", file, cause),
    });
  }

  private loadDocumentRecord(key: DocumentKey): Effect.Effect<LoadedPDFRecord, PDFError> {
    const file = key.file;
    const explicitPassword = key.variant.startsWith(PASSWORD_VARIANT_PREFIX)
      ? key.variant.slice(PASSWORD_VARIANT_PREFIX.length)
      : undefined;

    return Effect.suspend(() => {
      let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | undefined;
      let documentResolution: Deferred.Deferred<void, PDFProcessingError> | undefined;
      let resolvedRecord: LoadedPDFRecord | undefined;
      let cleanupError: PDFProcessingError | undefined;
      let cancelled = false;

      const cleanupPartial = (): Effect.Effect<void, PDFProcessingError> =>
        Effect.suspend(() => {
          cancelled = true;
          const resolution = documentResolution;
          const record = resolvedRecord;
          const cleanupResolvedDocument = record
            ? Effect.tryPromise({
                try: () => Promise.resolve(record.pdfjsDocument.cleanup()),
                catch: (cause) => processingError("cleanup-pdf-js", file, cause),
              })
            : Effect.void;

          return collectFirstError([
            cleanupResolvedDocument,
            loadingTask ? this.destroyLoadingTaskForFile(file, loadingTask) : Effect.void,
          ]).pipe(
            Effect.andThen(
              Effect.suspend(() => {
                if (!resolution) return Effect.void;
                return Deferred.await(resolution);
              })
            )
          );
        });

      const load = Effect.gen({ self: this }, function* () {
        const pdfjs = yield* Effect.tryPromise({
          try: () => loadPdfjs(),
          catch: (cause) => processingError("load-pdf-js", file, cause),
        });
        const buffer = yield* Effect.tryPromise({
          try: () => file.arrayBuffer(),
          catch: (cause) => processingError("read-file", file, cause),
        });
        const data = new Uint8Array(buffer);
        const password = explicitPassword ?? this.passwordRegistry.get(file);
        const task = yield* Effect.try({
          try: () =>
            password === undefined
              ? pdfjs.getDocument({ data })
              : pdfjs.getDocument({ data, password }),
          catch: (cause) => processingError("load-pdf-js", file, cause),
        });
        loadingTask = task;
        const resolution = Deferred.makeUnsafe<void, PDFProcessingError>();
        documentResolution = resolution;

        return yield* Effect.tryPromise({
          try: () =>
            task.promise.then(
              async (pdfjsDocument) => {
                try {
                  if (cancelled) {
                    try {
                      await Promise.resolve(pdfjsDocument.cleanup());
                    } catch (cause) {
                      cleanupError ??= processingError("cleanup-pdf-js", file, cause);
                      throw cleanupError;
                    }
                    throw new Error("The PDF.js document resolved after its load was released.");
                  }

                  const loadedRecord = {
                    file,
                    pdfjsDocument,
                    loadingTask: task,
                    pageMetadata: new Map(),
                    measuring: new Map(),
                  } satisfies LoadedPDFRecord;
                  resolvedRecord = loadedRecord;
                  return loadedRecord;
                } finally {
                  Deferred.doneUnsafe(
                    resolution,
                    cleanupError ? Effect.fail(cleanupError) : Effect.void
                  );
                }
              },
              (cause) => {
                Deferred.doneUnsafe(resolution, Effect.void);
                return Promise.reject(cause);
              }
            ),
          catch: (cause) => {
            if (isPasswordException(cause)) {
              return new PDFPasswordRequiredError(
                file,
                password === undefined || password === "" ? "needs-password" : "wrong-password"
              );
            }
            return cleanupError ?? processingError("load-pdf-js", file, cause);
          },
        });
      });

      // Keep cleanup error handling masked so a pending interruption cannot
      // replace the combined load and finalizer cause with interruption alone.
      return Effect.uninterruptibleMask((restore) =>
        restore(load).pipe(
          Effect.onExit((exit) => {
            if (Exit.isSuccess(exit)) return Effect.void;
            const cleanup = cleanupPartial();
            if (exit.cause.reasons.some(Cause.isInterruptReason)) {
              // Interrupted loads finish their partial cleanup in the fiber exit so
              // release/reset can report a failed loading-task destruction.
              return Effect.uninterruptible(cleanup);
            }
            return Effect.uninterruptible(
              cleanup.pipe(
                Effect.catch((error) =>
                  Effect.sync(() => {
                    cleanupError = error;
                  })
                )
              )
            );
          }),
          Effect.catchCause((cause) => {
            const error = cleanupError;
            return Effect.failCause(error ? Cause.map(cause, () => error) : cause);
          })
        )
      );
    });
  }
}
