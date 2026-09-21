import { Cause, Deferred, Effect, Exit, Fiber, Semaphore } from "effect";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { type PDFError, PDFPasswordRequiredError, PDFProcessingError } from "../types/interfaces";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

interface LoadedPDFRecord {
  // PDF.js is enough for page counts, password handling, and thumbnails. The
  // export service loads pdf-lib only when it needs to build a new document.
  readonly file: File;
  readonly pdfjsDocument: pdfjsLib.PDFDocumentProxy;
  readonly loadingTask: ReturnType<typeof pdfjsLib.getDocument>;
}

interface InFlightLoad {
  readonly deferred: Deferred.Deferred<LoadedPDFRecord, PDFError>;
  readonly file: File;
  readonly fiberReady: Deferred.Deferred<Fiber.Fiber<LoadedPDFRecord, PDFError>>;
  fiber: Fiber.Fiber<LoadedPDFRecord, PDFError> | null;
  documentResolution: Deferred.Deferred<void> | undefined;
  loadingTask: ReturnType<typeof pdfjsLib.getDocument> | undefined;
  record: LoadedPDFRecord | undefined;
  cleanupError: PDFProcessingError | undefined;
  loadingTaskCleanupStarted: boolean;
  loadingTaskCleanupFailed: boolean;
  released: boolean;
}

interface PendingPageRequest {
  readonly completion: Deferred.Deferred<void>;
  readonly file: File;
  readonly operation: string;
  readonly pagePromise: Promise<pdfjsLib.PDFPageProxy>;
  page: pdfjsLib.PDFPageProxy | undefined;
  cleanupError: PDFProcessingError | undefined;
  interrupted: boolean;
  pageSettled: boolean;
  cleanupStarted: boolean;
  cleaned: boolean;
}

interface PageResource {
  readonly page: pdfjsLib.PDFPageProxy;
  readonly request: PendingPageRequest;
}

type ForkDetached = <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<Fiber.Fiber<A, E>>;

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

function cleanupPage(
  page: pdfjsLib.PDFPageProxy,
  file: File,
  operation: string
): Effect.Effect<void, PDFProcessingError> {
  return Effect.try({
    try: () => {
      if (page.cleanup() === false) {
        throw new Error("PDF.js did not finish cleaning up the page.");
      }
    },
    catch: (cause) => processingError(operation, file, cause),
  });
}

function isPasswordException(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "name" in cause &&
    cause.name === "PasswordException"
  );
}

const MAX_CONCURRENT_PAGE_RENDERS = 2;

export class PDFService {
  private activeFile: File | null = null;
  private passwordRegistry = new Map<File, string>();
  private documentCache = new Map<File, LoadedPDFRecord>();
  private loadEffects = new Map<File, Map<string, InFlightLoad>>();
  private pendingPageRequests = new Map<File, Set<PendingPageRequest>>();
  private activeOperationFibers = new Map<File, Set<Fiber.Fiber<unknown, unknown>>>();
  private fileReleaseBarriers = new Map<File, Deferred.Deferred<void, PDFProcessingError>>();
  private resetBarrier: Deferred.Deferred<void, PDFProcessingError> | null = null;
  private readonly renderSemaphore = Semaphore.makeUnsafe(MAX_CONCURRENT_PAGE_RENDERS);
  private fileVersions = new WeakMap<File, number>();
  private sessionVersion = 0;

  constructor(private readonly forkDetached: ForkDetached = Effect.forkDetach) {}

  loadPDF(file: File): Effect.Effect<void, PDFError> {
    const sessionVersion = this.sessionVersion;
    const fileVersion = this.getFileVersion(file);

    return this.gateDocumentOperation(
      file,
      "load-pdf",
      sessionVersion,
      fileVersion,
      Effect.suspend(() =>
        this.getOrLoadDocument(file, (load) => this.loadDocument(file, undefined, load)).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              if (
                sessionVersion === this.sessionVersion &&
                fileVersion === this.getFileVersion(file)
              ) {
                this.activeFile = file;
              }
            })
          ),
          Effect.asVoid
        )
      )
    );
  }

  loadPDFWithPassword(file: File, password: string): Effect.Effect<void, PDFError> {
    const sessionVersion = this.sessionVersion;
    const fileVersion = this.getFileVersion(file);

    return this.gateDocumentOperation(
      file,
      "load-pdf-with-password",
      sessionVersion,
      fileVersion,
      Effect.suspend(() => {
        const storedPassword = this.passwordRegistry.get(file);
        if (storedPassword !== undefined && storedPassword !== password) {
          return Effect.fail(new PDFPasswordRequiredError(file, "wrong-password"));
        }

        return this.getOrLoadDocument(
          file,
          (load) => this.loadDocument(file, password, load),
          `password:${password}`
        ).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              if (
                sessionVersion !== this.sessionVersion ||
                fileVersion !== this.getFileVersion(file)
              ) {
                return;
              }
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
    return this.documentCache.get(this.activeFile)?.pdfjsDocument.numPages ?? 0;
  }

  getPassword(file: File): string | undefined {
    return this.passwordRegistry.get(file);
  }

  getPageRotation(file: File, pageNumber: number): Effect.Effect<number, PDFError> {
    const sessionVersion = this.sessionVersion;
    const fileVersion = this.getFileVersion(file);

    return this.trackDocumentOperation(
      file,
      "get-page-rotation",
      sessionVersion,
      fileVersion,
      Effect.gen({ self: this }, function* () {
        const record = yield* this.getOrLoadDocument(file);
        return yield* this.withPageCleanup(
          this.getPage(file, record, pageNumber, "get-page-rotation"),
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
    const sessionVersion = this.sessionVersion;
    const fileVersion = this.getFileVersion(file);

    return this.trackDocumentOperation(
      file,
      "get-page-size",
      sessionVersion,
      fileVersion,
      Effect.gen({ self: this }, function* () {
        const record = yield* this.getOrLoadDocument(file);
        return yield* this.withPageCleanup(
          this.getPage(file, record, pageNumber, "get-page-size"),
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
    const sessionVersion = this.sessionVersion;
    const fileVersion = this.getFileVersion(file);

    return this.trackDocumentOperation(
      file,
      "render-page",
      sessionVersion,
      fileVersion,
      Effect.gen({ self: this }, function* () {
        const record = yield* this.getOrLoadDocument(file);
        yield* this.withPageCleanup(this.getPage(file, record, pageNumber, "render-page"), (page) =>
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

            yield* this.renderSemaphore.withPermit(
              this.renderPDFPage(file, page, canvas, context, viewport)
            );
          })
        );
      })
    );
  }

  releaseFile(file: File): Effect.Effect<void, PDFProcessingError> {
    return Effect.uninterruptible(
      Effect.suspend(() => {
        const resetBarrier = this.resetBarrier;
        if (resetBarrier) {
          return Deferred.await(resetBarrier).pipe(Effect.andThen(this.releaseFile(file)));
        }

        const existingBarrier = this.fileReleaseBarriers.get(file);
        if (existingBarrier) return Deferred.await(existingBarrier);

        const releaseBarrier = Deferred.makeUnsafe<void, PDFProcessingError>();
        this.fileReleaseBarriers.set(file, releaseBarrier);
        this.fileVersions.set(file, this.getFileVersion(file) + 1);
        const record = this.documentCache.get(file);
        const loads = this.takeDocumentLoads(file);
        const operations = this.takeDocumentOperationFibers(file);
        for (const load of loads) {
          load.released = true;
        }

        if (this.activeFile === file) this.activeFile = null;
        this.passwordRegistry.delete(file);
        this.documentCache.delete(file);

        let firstError: PDFProcessingError | undefined;
        const continueAfterError = (effect: Effect.Effect<void, PDFProcessingError>) =>
          effect.pipe(
            Effect.catch((error) =>
              Effect.sync(() => {
                firstError ??= error;
              })
            )
          );

        return continueAfterError(this.cancelLoads(loads))
          .pipe(
            Effect.andThen(continueAfterError(this.interruptOperationFibers(operations))),
            Effect.andThen(continueAfterError(this.cancelLateLoads(file, loads))),
            Effect.andThen(continueAfterError(this.drainPendingPageRequests(file))),
            Effect.andThen(continueAfterError(record ? this.cleanupRecord(record) : Effect.void)),
            Effect.andThen(
              Effect.suspend(() => (firstError ? Effect.fail(firstError) : Effect.void))
            )
          )
          .pipe(Effect.onExit((exit) => this.completeFileRelease(file, releaseBarrier, exit)));
      })
    );
  }

  reset(): Effect.Effect<void, PDFProcessingError> {
    return Effect.uninterruptible(
      Effect.suspend(() => {
        const existingBarrier = this.resetBarrier;
        if (existingBarrier) return Deferred.await(existingBarrier);

        const resetBarrier = Deferred.makeUnsafe<void, PDFProcessingError>();
        this.resetBarrier = resetBarrier;
        const fileReleaseBarriers = Array.from(this.fileReleaseBarriers.values());
        const records = Array.from(this.documentCache.values());
        const loads = this.takeAllDocumentLoads();
        const operations = this.takeAllDocumentOperationFibers();
        for (const load of loads) {
          load.released = true;
        }
        this.activeFile = null;
        this.passwordRegistry.clear();
        this.documentCache.clear();
        this.sessionVersion += 1;

        let firstError: PDFProcessingError | undefined;
        const continueAfterError = (effect: Effect.Effect<void, PDFProcessingError>) =>
          effect.pipe(
            Effect.catch((error) =>
              Effect.sync(() => {
                firstError ??= error;
              })
            )
          );

        return Effect.forEach(
          fileReleaseBarriers,
          (barrier) =>
            Deferred.await(barrier).pipe(
              Effect.catch((error) =>
                Effect.sync(() => {
                  firstError ??= error;
                })
              )
            ),
          { discard: true }
        )
          .pipe(
            Effect.andThen(continueAfterError(this.cancelLoads(loads))),
            Effect.andThen(continueAfterError(this.interruptOperationFibers(operations))),
            Effect.andThen(continueAfterError(this.cancelLateLoads(undefined, loads))),
            Effect.andThen(continueAfterError(this.drainPendingPageRequests())),
            Effect.andThen(continueAfterError(this.cleanupRecords(records))),
            Effect.andThen(
              Effect.suspend(() => (firstError ? Effect.fail(firstError) : Effect.void))
            )
          )
          .pipe(Effect.onExit((exit) => this.completeReset(resetBarrier, exit)));
      })
    );
  }

  private cleanupRecords(
    records: readonly LoadedPDFRecord[]
  ): Effect.Effect<void, PDFProcessingError> {
    return Effect.suspend(() => {
      let firstError: PDFProcessingError | undefined;

      return Effect.forEach(
        records,
        (record) =>
          this.cleanupRecord(record).pipe(
            Effect.catch((error) =>
              Effect.sync(() => {
                firstError ??= error;
              })
            )
          ),
        { discard: true }
      ).pipe(
        Effect.andThen(Effect.suspend(() => (firstError ? Effect.fail(firstError) : Effect.void)))
      );
    });
  }

  private cleanupRecord(record: LoadedPDFRecord): Effect.Effect<void, PDFProcessingError> {
    let firstError: PDFProcessingError | undefined;
    const continueAfterError = (effect: Effect.Effect<void, PDFProcessingError>) =>
      effect.pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            firstError ??= error;
          })
        )
      );

    return continueAfterError(
      Effect.tryPromise({
        try: () => Promise.resolve(record.pdfjsDocument.cleanup()),
        catch: (cause) => processingError("cleanup-pdf-js", record.file, cause),
      })
    ).pipe(
      Effect.andThen(continueAfterError(this.destroyLoadingTask(record))),
      Effect.andThen(Effect.suspend(() => (firstError ? Effect.fail(firstError) : Effect.void)))
    );
  }

  private cleanupInFlightRecord(
    load: InFlightLoad,
    record: LoadedPDFRecord
  ): Effect.Effect<void, PDFProcessingError> {
    let firstError: PDFProcessingError | undefined;
    const continueAfterError = (effect: Effect.Effect<void, PDFProcessingError>) =>
      effect.pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            firstError ??= error;
          })
        )
      );

    return continueAfterError(
      Effect.tryPromise({
        try: () => Promise.resolve(record.pdfjsDocument.cleanup()),
        catch: (cause) => processingError("cleanup-pdf-js", record.file, cause),
      })
    ).pipe(
      Effect.andThen(continueAfterError(this.destroyLoadingTaskForLoad(load))),
      Effect.andThen(Effect.suspend(() => (firstError ? Effect.fail(firstError) : Effect.void)))
    );
  }

  private cleanupPartialLoad(load: InFlightLoad): Effect.Effect<void, PDFProcessingError> {
    let firstError: PDFProcessingError | undefined;
    const continueAfterError = (effect: Effect.Effect<void, PDFProcessingError>) =>
      effect.pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            firstError ??= error;
          })
        )
      );

    return continueAfterError(this.destroyLoadingTaskForLoad(load))
      .pipe(
        Effect.andThen(
          Effect.suspend(() =>
            !load.loadingTaskCleanupFailed
              ? continueAfterError(this.awaitDocumentResolution(load))
              : Effect.void
          )
        )
      )
      .pipe(
        Effect.andThen(Effect.suspend(() => (firstError ? Effect.fail(firstError) : Effect.void)))
      );
  }

  private awaitDocumentResolution(load: InFlightLoad): Effect.Effect<void> {
    return load.documentResolution ? Deferred.await(load.documentResolution) : Effect.void;
  }

  private destroyLoadingTask(record: LoadedPDFRecord): Effect.Effect<void, PDFProcessingError> {
    return this.destroyLoadingTaskForFile(record.file, record.loadingTask);
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

  private destroyLoadingTaskForLoad(load: InFlightLoad): Effect.Effect<void, PDFProcessingError> {
    if (!load.loadingTask || load.loadingTaskCleanupStarted) return Effect.void;

    const loadingTask = load.loadingTask;
    load.loadingTaskCleanupStarted = true;
    return this.destroyLoadingTaskForFile(load.file, loadingTask).pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          if (Exit.isSuccess(exit)) {
            load.loadingTask = undefined;
          } else {
            load.loadingTaskCleanupFailed = true;
          }
        })
      )
    );
  }

  private getPage(
    file: File,
    record: LoadedPDFRecord,
    pageNumber: number,
    operation: string
  ): Effect.Effect<PageResource, PDFProcessingError> {
    return Effect.suspend(() => {
      let pagePromise: Promise<pdfjsLib.PDFPageProxy>;

      try {
        pagePromise = record.pdfjsDocument.getPage(pageNumber);
      } catch (cause) {
        return Effect.fail(processingError(operation, file, cause));
      }

      const request: PendingPageRequest = {
        completion: Deferred.makeUnsafe<void>(),
        file,
        operation,
        pagePromise,
        page: undefined,
        cleanupError: undefined,
        interrupted: false,
        pageSettled: false,
        cleanupStarted: false,
        cleaned: false,
      };
      const requests = this.pendingPageRequests.get(file) ?? new Set();
      requests.add(request);
      this.pendingPageRequests.set(file, requests);

      return Effect.tryPromise({
        try: () => pagePromise,
        catch: (cause) => processingError(operation, file, cause),
      }).pipe(
        Effect.tap((page) =>
          Effect.sync(() => {
            request.pageSettled = true;
            request.page = page;
          })
        ),
        Effect.map((page) => ({ page, request })),
        Effect.onExit((exit) => {
          if (Exit.isSuccess(exit)) return Effect.void;
          return this.cleanupPendingPage(request);
        })
      );
    });
  }

  private withPageCleanup<A, E>(
    acquire: Effect.Effect<PageResource, PDFProcessingError>,
    use: (page: pdfjsLib.PDFPageProxy) => Effect.Effect<A, E>
  ): Effect.Effect<A, E | PDFProcessingError> {
    return Effect.acquireUseRelease(
      acquire,
      ({ page }) => use(page),
      ({ request }) => this.cleanupPendingPage(request)
    );
  }

  private cleanupPendingPage(request: PendingPageRequest): Effect.Effect<void, PDFProcessingError> {
    return Effect.suspend(() => {
      request.interrupted = true;
      if (request.cleaned || request.cleanupStarted) {
        return Deferred.await(request.completion).pipe(
          Effect.andThen(
            Effect.suspend(() =>
              request.cleanupError ? Effect.fail(request.cleanupError) : Effect.void
            )
          )
        );
      }

      request.cleanupStarted = true;
      const waitForPage =
        request.page || request.pageSettled
          ? Effect.void
          : Effect.tryPromise({
              try: () => request.pagePromise,
              catch: () => undefined,
            }).pipe(
              Effect.tap((page) =>
                Effect.sync(() => {
                  request.pageSettled = true;
                  request.page = page;
                })
              ),
              Effect.catch(() =>
                Effect.sync(() => {
                  request.pageSettled = true;
                })
              )
            );

      return Effect.uninterruptible(
        waitForPage.pipe(
          Effect.andThen(
            request.page ? cleanupPage(request.page, request.file, request.operation) : Effect.void
          ),
          Effect.catch((error) =>
            Effect.sync(() => {
              request.cleanupError = error;
            })
          ),
          Effect.andThen(
            Effect.sync(() => {
              request.cleaned = true;
              this.removePendingPageRequest(request);
              Deferred.doneUnsafe(request.completion, Effect.void);
            })
          ),
          Effect.andThen(
            Effect.suspend(() =>
              request.cleanupError ? Effect.fail(request.cleanupError) : Effect.void
            )
          )
        )
      );
    });
  }

  private removePendingPageRequest(request: PendingPageRequest): void {
    const requests = this.pendingPageRequests.get(request.file);
    if (!requests) return;
    requests.delete(request);
    if (requests.size === 0) this.pendingPageRequests.delete(request.file);
  }

  private takePendingPageRequests(file: File): readonly PendingPageRequest[] {
    const requests = this.pendingPageRequests.get(file);
    this.pendingPageRequests.delete(file);
    return requests ? Array.from(requests) : [];
  }

  private awaitPendingPageRequests(
    requests: readonly PendingPageRequest[]
  ): Effect.Effect<void, PDFProcessingError> {
    return Effect.suspend(() => {
      let firstError: PDFProcessingError | undefined;

      return Effect.forEach(
        requests,
        (request) =>
          Deferred.await(request.completion).pipe(
            Effect.andThen(
              Effect.suspend(() =>
                request.cleanupError ? Effect.fail(request.cleanupError) : Effect.void
              )
            ),
            Effect.catch((error) =>
              Effect.sync(() => {
                firstError ??= error;
              })
            )
          ),
        { discard: true }
      ).pipe(
        Effect.andThen(Effect.suspend(() => (firstError ? Effect.fail(firstError) : Effect.void)))
      );
    });
  }

  private drainPendingPageRequests(file?: File): Effect.Effect<void, PDFProcessingError> {
    return Effect.suspend(() => {
      const requests = file
        ? this.takePendingPageRequests(file)
        : Array.from(this.pendingPageRequests.values()).flatMap((fileRequests) =>
            Array.from(fileRequests)
          );
      if (!file) this.pendingPageRequests.clear();
      if (requests.length === 0) return Effect.void;

      let firstError: PDFProcessingError | undefined;
      return this.awaitPendingPageRequests(requests).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            firstError = error;
          })
        ),
        Effect.andThen(this.drainPendingPageRequests(file)),
        Effect.andThen(Effect.suspend(() => (firstError ? Effect.fail(firstError) : Effect.void)))
      );
    });
  }

  private getOrLoadDocument(
    file: File,
    loader?: (load: InFlightLoad) => Effect.Effect<LoadedPDFRecord, PDFError>,
    key = "auto"
  ): Effect.Effect<LoadedPDFRecord, PDFError> {
    return Effect.suspend(() => {
      const barrier = this.resetBarrier ?? this.fileReleaseBarriers.get(file);
      if (barrier) {
        return Deferred.await(barrier).pipe(
          Effect.andThen(
            Effect.fail(
              processingError(
                "document-operation",
                file,
                new Error("The PDF changed before the document operation could start.")
              )
            )
          )
        );
      }

      const cachedRecord = this.documentCache.get(file);
      if (cachedRecord) return Effect.succeed(cachedRecord);

      const inFlight = this.loadEffects.get(file)?.get(key);
      if (inFlight) return Deferred.await(inFlight.deferred);

      const deferred = Deferred.makeUnsafe<LoadedPDFRecord, PDFError>();
      const load: InFlightLoad = {
        deferred,
        file,
        fiberReady: Deferred.makeUnsafe<Fiber.Fiber<LoadedPDFRecord, PDFError>>(),
        fiber: null,
        documentResolution: undefined,
        loadingTask: undefined,
        record: undefined,
        cleanupError: undefined,
        loadingTaskCleanupStarted: false,
        loadingTaskCleanupFailed: false,
        released: false,
      };
      const fileEffects = this.loadEffects.get(file) ?? new Map();
      fileEffects.set(key, load);
      this.loadEffects.set(file, fileEffects);

      const sessionVersion = this.sessionVersion;
      const fileVersion = this.getFileVersion(file);
      let recordTransferred = false;
      let recordCleaned = false;
      const cleanupOwnedRecord = () => {
        if (!load.record || recordTransferred || recordCleaned) return Effect.void;
        recordCleaned = true;
        return Effect.uninterruptible(this.cleanupInFlightRecord(load, load.record));
      };
      const cleanupUnownedResources = () => {
        if (recordTransferred || recordCleaned) return Effect.void;
        recordCleaned = true;
        return Effect.uninterruptible(this.cleanupPartialLoad(load));
      };
      const loadEffect = (
        loader ?? ((currentLoad) => this.loadDocumentWithStoredPassword(file, currentLoad))
      )(load).pipe(
        Effect.tap((record) =>
          Effect.suspend(() => {
            load.record ??= record;

            if (
              sessionVersion === this.sessionVersion &&
              fileVersion === this.getFileVersion(file)
            ) {
              const cachedRecord = this.documentCache.get(file);
              if (!cachedRecord) {
                this.documentCache.set(file, record);
                recordTransferred = true;
                return Effect.void;
              }

              if (cachedRecord === record) {
                recordTransferred = true;
                return Effect.void;
              }
            }

            return cleanupOwnedRecord();
          })
        ),
        Effect.onExit((exit) =>
          (load.record ? cleanupOwnedRecord() : cleanupUnownedResources()).pipe(
            Effect.catch((error) =>
              Effect.sync(() => {
                load.cleanupError = error;
              })
            ),
            Effect.andThen(
              Effect.suspend(() =>
                Deferred.done(
                  load.deferred,
                  load.cleanupError ? Exit.fail(load.cleanupError) : exit
                )
              )
            ),
            Effect.andThen(
              Effect.sync(() => {
                const currentFileEffects = this.loadEffects.get(file);
                if (currentFileEffects?.get(key) !== load) return;
                currentFileEffects.delete(key);
                if (currentFileEffects.size === 0) this.loadEffects.delete(file);
              })
            )
          )
        )
      );

      // Deferred is the v4 coordination primitive for sharing one in-flight
      // Effect between fibers without storing a Promise in the service. The
      // loader is detached from an individual thumbnail so one consumer being
      // interrupted cannot cancel a load still needed by another consumer.
      return Effect.gen({ self: this }, function* () {
        const fiber = yield* this.forkDetached(loadEffect);
        load.fiber = fiber;
        yield* Deferred.succeed(load.fiberReady, fiber);
        if (load.released) {
          yield* this.interruptLoadFiber(load, fiber);
        }
        return yield* Deferred.await(load.deferred);
      });
    });
  }

  private cancelLoad(load: InFlightLoad): Effect.Effect<void, PDFProcessingError> {
    return Effect.gen({ self: this }, function* () {
      yield* Deferred.fail(
        load.deferred,
        new PDFProcessingError({
          operation: "release-file",
          file: load.file,
          cause: new Error("The PDF was released before loading completed."),
          message: "The PDF was released before loading completed.",
        })
      );
      const fiber = load.fiber ?? (yield* Deferred.await(load.fiberReady));
      yield* this.interruptLoadFiber(load, fiber);
    });
  }

  private interruptLoadFiber(
    load: InFlightLoad,
    fiber: Fiber.Fiber<LoadedPDFRecord, PDFError>
  ): Effect.Effect<void, PDFProcessingError> {
    return Fiber.interrupt(fiber).pipe(
      Effect.andThen(Fiber.await(fiber)),
      Effect.andThen((exit) => {
        if (load.cleanupError) {
          return Effect.fail(load.cleanupError);
        }
        const error = this.getProcessingError(exit);
        return error ? Effect.fail(error) : Effect.void;
      })
    );
  }

  private trackDocumentOperation<A, E extends PDFError>(
    file: File,
    operation: string,
    sessionVersion: number,
    fileVersion: number,
    effect: Effect.Effect<A, E>
  ): Effect.Effect<A, E | PDFError> {
    return Effect.withFiber((fiber) =>
      Effect.suspend(() => {
        if (!this.isCurrentDocumentVersion(file, sessionVersion, fileVersion)) {
          return Effect.fail(
            processingError(
              operation,
              file,
              new Error("The PDF changed before the operation started.")
            )
          );
        }

        const barrier = this.resetBarrier ?? this.fileReleaseBarriers.get(file);
        if (barrier) {
          return Deferred.await(barrier).pipe(
            Effect.andThen(
              this.trackDocumentOperation(file, operation, sessionVersion, fileVersion, effect)
            )
          );
        }

        const operations = this.activeOperationFibers.get(file) ?? new Set();
        operations.add(fiber);
        this.activeOperationFibers.set(file, operations);

        return Effect.ensuring(
          effect,
          Effect.sync(() => {
            const operations = this.activeOperationFibers.get(file);
            if (!operations) return;
            operations.delete(fiber);
            if (operations.size === 0) this.activeOperationFibers.delete(file);
          })
        );
      })
    );
  }

  private gateDocumentOperation<A, E extends PDFError>(
    file: File,
    operation: string,
    sessionVersion: number,
    fileVersion: number,
    effect: Effect.Effect<A, E>
  ): Effect.Effect<A, E | PDFError> {
    return Effect.suspend(() => {
      if (!this.isCurrentDocumentVersion(file, sessionVersion, fileVersion)) {
        return Effect.fail(
          processingError(
            operation,
            file,
            new Error("The PDF changed before the operation started.")
          )
        );
      }

      const barrier = this.resetBarrier ?? this.fileReleaseBarriers.get(file);
      if (barrier) {
        return Deferred.await(barrier).pipe(
          Effect.andThen(
            this.gateDocumentOperation(file, operation, sessionVersion, fileVersion, effect)
          )
        );
      }

      return effect;
    });
  }

  private completeFileRelease(
    file: File,
    barrier: Deferred.Deferred<void, PDFProcessingError>,
    exit: Exit.Exit<void, PDFProcessingError>
  ): Effect.Effect<void> {
    return Effect.sync(() => {
      if (this.fileReleaseBarriers.get(file) === barrier) {
        this.fileReleaseBarriers.delete(file);
      }
    }).pipe(Effect.andThen(Deferred.done(barrier, exit)), Effect.asVoid);
  }

  private completeReset(
    barrier: Deferred.Deferred<void, PDFProcessingError>,
    exit: Exit.Exit<void, PDFProcessingError>
  ): Effect.Effect<void> {
    return Effect.sync(() => {
      if (this.resetBarrier === barrier) this.resetBarrier = null;
    }).pipe(Effect.andThen(Deferred.done(barrier, exit)), Effect.asVoid);
  }

  private isCurrentDocumentVersion(file: File, sessionVersion: number, fileVersion: number) {
    return sessionVersion === this.sessionVersion && fileVersion === this.getFileVersion(file);
  }

  private takeDocumentLoads(file: File): readonly InFlightLoad[] {
    const loads = Array.from(this.loadEffects.get(file)?.values() ?? []);
    this.loadEffects.delete(file);
    for (const load of loads) {
      load.released = true;
    }
    return loads;
  }

  private takeAllDocumentLoads(): readonly InFlightLoad[] {
    const loads = Array.from(this.loadEffects.values()).flatMap((fileEffects) =>
      Array.from(fileEffects.values())
    );
    this.loadEffects.clear();
    for (const load of loads) {
      load.released = true;
    }
    return loads;
  }

  private cancelLateLoads(
    file: File | undefined,
    knownLoads: readonly InFlightLoad[]
  ): Effect.Effect<void, PDFProcessingError> {
    const lateLoads = file
      ? this.takeDocumentLoads(file).filter((load) => !knownLoads.includes(load))
      : this.takeAllDocumentLoads().filter((load) => !knownLoads.includes(load));

    return this.cancelLoads(lateLoads);
  }

  private cancelLoads(loads: readonly InFlightLoad[]): Effect.Effect<void, PDFProcessingError> {
    let firstError: PDFProcessingError | undefined;

    return Effect.forEach(
      loads,
      (load) =>
        this.cancelLoad(load).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              firstError ??= error;
            })
          )
        ),
      { discard: true }
    ).pipe(
      Effect.andThen(Effect.suspend(() => (firstError ? Effect.fail(firstError) : Effect.void)))
    );
  }

  private takeDocumentOperationFibers(file: File): readonly Fiber.Fiber<unknown, unknown>[] {
    const operations = this.activeOperationFibers.get(file);
    this.activeOperationFibers.delete(file);
    return operations ? Array.from(operations) : [];
  }

  private takeAllDocumentOperationFibers(): readonly Fiber.Fiber<unknown, unknown>[] {
    const operations = Array.from(this.activeOperationFibers.values()).flatMap((fileOperations) =>
      Array.from(fileOperations)
    );
    this.activeOperationFibers.clear();
    return operations;
  }

  private interruptOperationFibers(
    operations: readonly Fiber.Fiber<unknown, unknown>[]
  ): Effect.Effect<void, PDFProcessingError> {
    return Effect.suspend(() => {
      let firstError: PDFProcessingError | undefined;

      return Effect.forEach(
        operations,
        (fiber) =>
          Fiber.interrupt(fiber).pipe(
            Effect.andThen(Fiber.await(fiber)),
            Effect.andThen((exit) => {
              const error = this.getProcessingError(exit);
              return error ? Effect.fail(error) : Effect.void;
            }),
            Effect.catch((error) =>
              Effect.sync(() => {
                firstError ??= error;
              })
            )
          ),
        { discard: true }
      ).pipe(
        Effect.andThen(Effect.suspend(() => (firstError ? Effect.fail(firstError) : Effect.void)))
      );
    });
  }

  private getProcessingError(exit: Exit.Exit<unknown, unknown>): PDFProcessingError | undefined {
    if (Exit.isSuccess(exit)) return undefined;

    for (const reason of exit.cause.reasons) {
      if (Cause.isFailReason(reason) && reason.error instanceof PDFProcessingError) {
        return reason.error;
      }
    }

    return undefined;
  }

  private getFileVersion(file: File): number {
    return this.fileVersions.get(file) ?? 0;
  }

  private loadDocumentWithStoredPassword(
    file: File,
    load: InFlightLoad
  ): Effect.Effect<LoadedPDFRecord, PDFError> {
    const storedPassword = this.passwordRegistry.get(file);
    return this.loadDocument(file, storedPassword, load);
  }

  private loadDocument(
    file: File,
    password: string | undefined,
    load: InFlightLoad
  ): Effect.Effect<LoadedPDFRecord, PDFError> {
    return Effect.gen({ self: this }, function* () {
      const buffer = yield* Effect.tryPromise({
        try: () => file.arrayBuffer(),
        catch: (cause) => processingError("read-file", file, cause),
      });
      const loaded = yield* this.loadPdfJsDocument(file, new Uint8Array(buffer), password, load);
      return loaded;
    });
  }

  private loadPdfJsDocument(
    file: File,
    data: Uint8Array,
    password: string | undefined,
    load: InFlightLoad
  ): Effect.Effect<LoadedPDFRecord, PDFError> {
    return Effect.gen({ self: this }, function* () {
      const loadingTask = yield* Effect.try({
        try: () =>
          password === undefined
            ? pdfjsLib.getDocument({ data })
            : pdfjsLib.getDocument({ data, password }),
        catch: (cause) => processingError("load-pdf-js", file, cause),
      });
      load.loadingTask = loadingTask;
      const documentResolution = Deferred.makeUnsafe<void>();
      load.documentResolution = documentResolution;

      const record = yield* Effect.tryPromise({
        try: () =>
          loadingTask.promise.then(
            async (pdfjsDocument) => {
              try {
                if (load.released || load.loadingTaskCleanupStarted) {
                  try {
                    await Promise.resolve(pdfjsDocument.cleanup());
                  } catch (cause) {
                    load.cleanupError ??= processingError("cleanup-pdf-js", file, cause);
                    throw load.cleanupError;
                  }
                  throw new Error("The PDF.js document resolved after its load was released.");
                }

                const loadedRecord: LoadedPDFRecord = { file, pdfjsDocument, loadingTask };
                load.record = loadedRecord;
                return loadedRecord;
              } finally {
                Deferred.doneUnsafe(documentResolution, Effect.void);
              }
            },
            (cause) => {
              Deferred.doneUnsafe(documentResolution, Effect.void);
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
          return processingError("load-pdf-js", file, cause);
        },
      }).pipe(
        Effect.onExit((exit) => {
          if (Exit.isSuccess(exit)) return Effect.void;
          return this.destroyLoadingTaskForLoad(load).pipe(
            Effect.catch((error) =>
              Effect.sync(() => {
                load.cleanupError = error;
              })
            )
          );
        }),
        Effect.catch((error) =>
          Effect.suspend(() =>
            load.cleanupError ? Effect.fail(load.cleanupError) : Effect.fail(error)
          )
        )
      );

      return record;
    });
  }

  private renderPDFPage(
    file: File,
    page: pdfjsLib.PDFPageProxy,
    canvas: HTMLCanvasElement,
    context: CanvasRenderingContext2D,
    viewport: pdfjsLib.PageViewport
  ): Effect.Effect<void, PDFProcessingError> {
    return Effect.callback<void, PDFProcessingError>((resume) => {
      let renderTask: ReturnType<typeof page.render>;
      let cancelled = false;

      try {
        renderTask = page.render({
          canvasContext: context,
          viewport,
          canvas,
        });
      } catch (cause) {
        resume(Effect.fail(processingError("render-page", file, cause)));
        return;
      }

      void renderTask.promise.then(
        () => {
          if (!cancelled) resume(Effect.succeed(undefined));
        },
        (cause) => {
          if (!cancelled) resume(Effect.fail(processingError("render-page", file, cause)));
        }
      );

      return Effect.uninterruptible(
        Effect.sync(() => {
          cancelled = true;
          try {
            renderTask.cancel();
          } catch {
            // Render cancellation is best effort when PDF.js has already completed.
          }
        }).pipe(
          Effect.andThen(
            Effect.tryPromise({
              try: () =>
                renderTask.promise.then(
                  () => undefined,
                  () => undefined
                ),
              catch: () => undefined,
            }).pipe(Effect.catch(() => Effect.void))
          )
        )
      );
    });
  }
}
