import { Cause, Deferred, Effect, Exit, Option } from "effect";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  type PDFError,
  PDFPasswordRequiredError,
  type PDFProcessingError,
} from "../types/interfaces";
import { type DocumentKey, makeDocumentStore } from "./document-store";
import { PageRenderer } from "./page-renderer";
import { PageResources } from "./page-resources";
import { collectFirstError, processingError } from "./pdf-errors";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

interface LoadedPDFRecord {
  // PDF.js is enough for page counts, password handling, and thumbnails. The
  // export service loads pdf-lib only when it needs to build a new document.
  readonly file: File;
  readonly pdfjsDocument: pdfjsLib.PDFDocumentProxy;
  readonly loadingTask: ReturnType<typeof pdfjsLib.getDocument>;
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
        return yield* this.pageResources.withPageCleanup(
          file,
          pageNumber,
          this.pageResources.getPage(record.pdfjsDocument, file, pageNumber, "get-page-rotation"),
          (page) =>
            Effect.try({
              try: () => page.rotate,
              catch: (cause) => processingError("get-page-rotation", file, cause),
            })
        );
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
        return yield* this.pageResources.withPageCleanup(
          file,
          pageNumber,
          this.pageResources.getPage(record.pdfjsDocument, file, pageNumber, "get-page-size"),
          (page) =>
            Effect.try({
              try: () => {
                const viewport = page.getViewport({ scale: 1, rotation });
                return { width: viewport.width, height: viewport.height };
              },
              catch: (cause) => processingError("get-page-size", file, cause),
            })
        );
      })
    );
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
    const destroy = loadingTask?.destroy;
    if (typeof destroy !== "function") return Effect.void;

    return Effect.tryPromise({
      try: () => Promise.resolve(destroy.call(loadingTask)),
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
      let documentResolution: Deferred.Deferred<void> | undefined;
      let resolvedRecord: LoadedPDFRecord | undefined;
      let cleanupError: PDFProcessingError | undefined;
      let cleanupStarted = false;
      let cleanupFailed = false;
      let cancelled = false;

      const destroyLoadingTask = (): Effect.Effect<void, PDFProcessingError> => {
        const task = loadingTask;
        if (!task || cleanupStarted) return Effect.void;
        cleanupStarted = true;

        return this.destroyLoadingTaskForFile(file, task).pipe(
          Effect.onExit((exit) =>
            Effect.sync(() => {
              if (Exit.isSuccess(exit)) {
                loadingTask = undefined;
              } else {
                cleanupFailed = true;
              }
            })
          )
        );
      };

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

          return collectFirstError([cleanupResolvedDocument, destroyLoadingTask()]).pipe(
            Effect.andThen(
              Effect.suspend(() => {
                if (cleanupFailed || !resolution) return Effect.void;
                return Deferred.await(resolution);
              })
            )
          );
        });

      const load = Effect.gen({ self: this }, function* () {
        const buffer = yield* Effect.tryPromise({
          try: () => file.arrayBuffer(),
          catch: (cause) => processingError("read-file", file, cause),
        });
        const data = new Uint8Array(buffer);
        const password = explicitPassword ?? this.passwordRegistry.get(file);
        const task = yield* Effect.try({
          try: () =>
            password === undefined
              ? pdfjsLib.getDocument({ data })
              : pdfjsLib.getDocument({ data, password }),
          catch: (cause) => processingError("load-pdf-js", file, cause),
        });
        loadingTask = task;
        const resolution = Deferred.makeUnsafe<void>();
        documentResolution = resolution;

        return yield* Effect.tryPromise({
          try: () =>
            task.promise.then(
              async (pdfjsDocument) => {
                try {
                  if (cancelled || cleanupStarted) {
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
                  } satisfies LoadedPDFRecord;
                  resolvedRecord = loadedRecord;
                  return loadedRecord;
                } finally {
                  Deferred.doneUnsafe(resolution, Effect.void);
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

      return load.pipe(
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
        Effect.catch((error) =>
          Effect.suspend(() => (cleanupError ? Effect.fail(cleanupError) : Effect.fail(error)))
        )
      );
    });
  }
}
