import { Deferred, Effect, Fiber, Semaphore } from "effect";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { type PDFError, PDFPasswordRequiredError, PDFProcessingError } from "../types/interfaces";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

interface LoadedPDFRecord {
  // PDF.js is enough for page counts, password handling, and thumbnails. The
  // export service loads pdf-lib only when it needs to build a new document.
  readonly pdfjsDocument: pdfjsLib.PDFDocumentProxy;
}

interface InFlightLoad {
  readonly deferred: Deferred.Deferred<LoadedPDFRecord, PDFError>;
  readonly file: File;
  fiber: Fiber.Fiber<LoadedPDFRecord, PDFError> | null;
  released: boolean;
}

interface PendingPageRequest {
  readonly completion: Deferred.Deferred<void>;
  readonly file: File;
  page: pdfjsLib.PDFPageProxy | undefined;
  claimed: boolean;
  interrupted: boolean;
  cleaned: boolean;
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

function cleanupPage(page: pdfjsLib.PDFPageProxy): Effect.Effect<void> {
  return Effect.try({
    try: () => page.cleanup(),
    catch: () => undefined,
  }).pipe(
    Effect.catch(() => Effect.void),
    Effect.asVoid
  );
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
  private fileReleaseBarriers = new Map<File, Deferred.Deferred<void>>();
  private resetBarrier: Deferred.Deferred<void> | null = null;
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
        this.getOrLoadDocument(file, () => this.loadDocument(file)).pipe(
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
          () => this.loadDocument(file, password),
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
        const page = yield* this.getPage(file, record, pageNumber, "get-page-rotation");
        return yield* Effect.try({
          try: () => page.rotate,
          catch: (cause) => processingError("get-page-rotation", file, cause),
        }).pipe(Effect.ensuring(cleanupPage(page)));
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
        const page = yield* this.getPage(file, record, pageNumber, "get-page-size");
        return yield* Effect.try({
          try: () => {
            const viewport = page.getViewport({ scale: 1, rotation });
            return { width: viewport.width, height: viewport.height };
          },
          catch: (cause) => processingError("get-page-size", file, cause),
        }).pipe(Effect.ensuring(cleanupPage(page)));
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
        const page = yield* this.getPage(file, record, pageNumber, "render-page");
        yield* Effect.gen({ self: this }, function* () {
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
        }).pipe(Effect.ensuring(cleanupPage(page)));
      })
    );
  }

  releaseFile(file: File): Effect.Effect<void> {
    return Effect.uninterruptible(
      Effect.suspend(() => {
        const resetBarrier = this.resetBarrier;
        if (resetBarrier) {
          return Deferred.await(resetBarrier).pipe(Effect.andThen(this.releaseFile(file)));
        }

        const existingBarrier = this.fileReleaseBarriers.get(file);
        if (existingBarrier) return Deferred.await(existingBarrier);

        const releaseBarrier = Deferred.makeUnsafe<void>();
        this.fileReleaseBarriers.set(file, releaseBarrier);
        this.fileVersions.set(file, this.getFileVersion(file) + 1);
        const record = this.documentCache.get(file);
        const loads = Array.from(this.loadEffects.get(file)?.values() ?? []);
        const operations = this.takeDocumentOperationFibers(file);
        const pendingPageRequests = this.takePendingPageRequests(file);
        for (const load of loads) {
          load.released = true;
        }

        if (this.activeFile === file) this.activeFile = null;
        this.passwordRegistry.delete(file);
        this.documentCache.delete(file);
        this.loadEffects.delete(file);

        return Effect.forEach(loads, (load) => this.cancelLoad(load), { discard: true })
          .pipe(
            Effect.andThen(this.interruptOperationFibers(operations)),
            Effect.andThen(this.awaitPendingPageRequests(pendingPageRequests)),
            Effect.andThen(
              record
                ? Effect.tryPromise({
                    try: () => record.pdfjsDocument.cleanup(),
                    catch: () => undefined,
                  }).pipe(Effect.catch(() => Effect.void))
                : Effect.void
            )
          )
          .pipe(Effect.ensuring(this.completeFileRelease(file, releaseBarrier)));
      })
    );
  }

  reset(): Effect.Effect<void> {
    return Effect.uninterruptible(
      Effect.suspend(() => {
        const existingBarrier = this.resetBarrier;
        if (existingBarrier) return Deferred.await(existingBarrier);

        const resetBarrier = Deferred.makeUnsafe<void>();
        this.resetBarrier = resetBarrier;
        const fileReleaseBarriers = Array.from(this.fileReleaseBarriers.values());
        const records = Array.from(this.documentCache.values());
        const loads = Array.from(this.loadEffects.values()).flatMap((fileEffects) =>
          Array.from(fileEffects.values())
        );
        const operations = this.takeAllDocumentOperationFibers();
        const pendingPageRequests = this.takeAllPendingPageRequests();
        for (const load of loads) {
          load.released = true;
        }
        this.activeFile = null;
        this.passwordRegistry.clear();
        this.documentCache.clear();
        this.loadEffects.clear();
        this.sessionVersion += 1;

        return Effect.forEach(fileReleaseBarriers, Deferred.await, { discard: true })
          .pipe(
            Effect.andThen(
              Effect.forEach(loads, (load) => this.cancelLoad(load), { discard: true })
            ),
            Effect.andThen(this.interruptOperationFibers(operations)),
            Effect.andThen(this.awaitPendingPageRequests(pendingPageRequests)),
            Effect.andThen(this.cleanupRecords(records))
          )
          .pipe(Effect.ensuring(this.completeReset(resetBarrier)));
      })
    );
  }

  private cleanupRecords(records: readonly LoadedPDFRecord[]): Effect.Effect<void> {
    return Effect.forEach(
      records,
      (record) =>
        Effect.tryPromise({
          try: () => record.pdfjsDocument.cleanup(),
          catch: () => undefined,
        }).pipe(Effect.catch(() => Effect.void)),
      { discard: true }
    );
  }

  private getPage(
    file: File,
    record: LoadedPDFRecord,
    pageNumber: number,
    operation: string
  ): Effect.Effect<pdfjsLib.PDFPageProxy, PDFProcessingError> {
    return Effect.callback<pdfjsLib.PDFPageProxy, PDFProcessingError>((resume) => {
      let pagePromise: Promise<pdfjsLib.PDFPageProxy>;

      try {
        pagePromise = record.pdfjsDocument.getPage(pageNumber);
      } catch (cause) {
        resume(Effect.fail(processingError(operation, file, cause)));
        return;
      }

      const request: PendingPageRequest = {
        completion: Deferred.makeUnsafe<void>(),
        file,
        page: undefined,
        claimed: false,
        interrupted: false,
        cleaned: false,
      };
      const requests = this.pendingPageRequests.get(file) ?? new Set();
      requests.add(request);
      this.pendingPageRequests.set(file, requests);

      void pagePromise.then(
        (page) => {
          request.page = page;
          if (request.interrupted) {
            Effect.runFork(this.cleanupPendingPage(request));
            return;
          }

          request.claimed = true;
          this.removePendingPageRequest(request);
          Deferred.doneUnsafe(request.completion, Effect.void);
          resume(Effect.succeed(page));
        },
        (cause) => {
          this.removePendingPageRequest(request);
          Deferred.doneUnsafe(request.completion, Effect.void);
          if (!request.interrupted) {
            resume(Effect.fail(processingError(operation, file, cause)));
          }
        }
      );

      return Effect.sync(() => {
        request.interrupted = true;
      });
    });
  }

  private cleanupPendingPage(request: PendingPageRequest): Effect.Effect<void> {
    const page = request.page;
    if (!page) {
      this.removePendingPageRequest(request);
      Deferred.doneUnsafe(request.completion, Effect.void);
      return Effect.void;
    }

    return cleanupPage(page).pipe(
      Effect.andThen(
        Effect.sync(() => {
          request.cleaned = true;
          this.removePendingPageRequest(request);
          Deferred.doneUnsafe(request.completion, Effect.void);
        })
      )
    );
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

  private takeAllPendingPageRequests(): readonly PendingPageRequest[] {
    const requests = Array.from(this.pendingPageRequests.values()).flatMap((fileRequests) =>
      Array.from(fileRequests)
    );
    this.pendingPageRequests.clear();
    return requests;
  }

  private awaitPendingPageRequests(requests: readonly PendingPageRequest[]): Effect.Effect<void> {
    return Effect.forEach(requests, (request) => Deferred.await(request.completion), {
      discard: true,
    });
  }

  private getOrLoadDocument(
    file: File,
    loader?: () => Effect.Effect<LoadedPDFRecord, PDFError>,
    key = "auto"
  ): Effect.Effect<LoadedPDFRecord, PDFError> {
    return Effect.suspend(() => {
      const cachedRecord = this.documentCache.get(file);
      if (cachedRecord) return Effect.succeed(cachedRecord);

      const inFlight = this.loadEffects.get(file)?.get(key);
      if (inFlight) return Deferred.await(inFlight.deferred);

      const deferred = Deferred.makeUnsafe<LoadedPDFRecord, PDFError>();
      const load: InFlightLoad = { deferred, file, fiber: null, released: false };
      const fileEffects = this.loadEffects.get(file) ?? new Map();
      fileEffects.set(key, load);
      this.loadEffects.set(file, fileEffects);

      const sessionVersion = this.sessionVersion;
      const fileVersion = this.getFileVersion(file);
      const loadEffect = (loader ?? (() => this.loadDocumentWithStoredPassword(file)))().pipe(
        Effect.tap((record) =>
          Effect.suspend(() => {
            if (
              sessionVersion === this.sessionVersion &&
              fileVersion === this.getFileVersion(file)
            ) {
              this.documentCache.set(file, record);
              return Effect.void;
            } else {
              return Effect.uninterruptible(this.cleanupRecords([record]));
            }
          })
        ),
        Effect.onExit((exit) =>
          Deferred.done(load.deferred, exit).pipe(
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
        if (load.released) {
          yield* Fiber.interrupt(fiber);
        }
        return yield* Deferred.await(load.deferred);
      });
    });
  }

  private cancelLoad(load: InFlightLoad): Effect.Effect<void> {
    return Effect.gen(function* () {
      yield* Deferred.fail(
        load.deferred,
        new PDFProcessingError({
          operation: "release-file",
          file: load.file,
          cause: new Error("The PDF was released before loading completed."),
          message: "The PDF was released before loading completed.",
        })
      );
      if (load.fiber) {
        yield* Fiber.interrupt(load.fiber);
      }
    });
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

        return Effect.ensuring(
          Effect.sync(() => {
            const operations = this.activeOperationFibers.get(file) ?? new Set();
            operations.add(fiber);
            this.activeOperationFibers.set(file, operations);
          }).pipe(Effect.andThen(effect)),
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

  private completeFileRelease(file: File, barrier: Deferred.Deferred<void>): Effect.Effect<void> {
    return Effect.sync(() => {
      if (this.fileReleaseBarriers.get(file) === barrier) {
        this.fileReleaseBarriers.delete(file);
      }
    }).pipe(Effect.andThen(Deferred.succeed(barrier, undefined)), Effect.asVoid);
  }

  private completeReset(barrier: Deferred.Deferred<void>): Effect.Effect<void> {
    return Effect.sync(() => {
      if (this.resetBarrier === barrier) this.resetBarrier = null;
    }).pipe(Effect.andThen(Deferred.succeed(barrier, undefined)), Effect.asVoid);
  }

  private isCurrentDocumentVersion(file: File, sessionVersion: number, fileVersion: number) {
    return sessionVersion === this.sessionVersion && fileVersion === this.getFileVersion(file);
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
  ): Effect.Effect<void> {
    return Effect.forEach(operations, (fiber) => Fiber.interrupt(fiber), { discard: true });
  }

  private getFileVersion(file: File): number {
    return this.fileVersions.get(file) ?? 0;
  }

  private loadDocumentWithStoredPassword(file: File): Effect.Effect<LoadedPDFRecord, PDFError> {
    const storedPassword = this.passwordRegistry.get(file);
    return this.loadDocument(file, storedPassword);
  }

  private loadDocument(file: File, password?: string): Effect.Effect<LoadedPDFRecord, PDFError> {
    return Effect.gen({ self: this }, function* () {
      const buffer = yield* Effect.tryPromise({
        try: () => file.arrayBuffer(),
        catch: (cause) => processingError("read-file", file, cause),
      });
      return {
        pdfjsDocument: yield* this.loadPdfJsDocument(file, new Uint8Array(buffer), password),
      };
    });
  }

  private loadPdfJsDocument(
    file: File,
    data: Uint8Array,
    password?: string
  ): Effect.Effect<pdfjsLib.PDFDocumentProxy, PDFError> {
    return Effect.callback<pdfjsLib.PDFDocumentProxy, PDFError>((resume) => {
      let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | undefined;

      try {
        loadingTask =
          password === undefined
            ? pdfjsLib.getDocument({ data })
            : pdfjsLib.getDocument({ data, password });
      } catch (cause) {
        resume(Effect.fail(processingError("load-pdf-js", file, cause)));
        return;
      }

      void loadingTask.promise.then(
        (document) => resume(Effect.succeed(document)),
        (cause) => {
          if (isPasswordException(cause)) {
            resume(
              Effect.fail(
                new PDFPasswordRequiredError(
                  file,
                  password === undefined || password === "" ? "needs-password" : "wrong-password"
                )
              )
            );
          } else {
            resume(Effect.fail(processingError("load-pdf-js", file, cause)));
          }
        }
      );

      return Effect.tryPromise({
        try: () => loadingTask?.destroy() ?? Promise.resolve(),
        catch: () => undefined,
      }).pipe(Effect.catch(() => Effect.void));
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
