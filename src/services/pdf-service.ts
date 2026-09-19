import { Deferred, Effect, Fiber, Result } from "effect";
import { PDFDocument } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { type PDFError, PDFPasswordRequiredError, PDFProcessingError } from "../types/interfaces";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

interface LoadedPDFRecord {
  readonly pdfDocument: PDFDocument;
  readonly pdfjsDocument: pdfjsLib.PDFDocumentProxy;
}

interface InFlightLoad {
  readonly deferred: Deferred.Deferred<LoadedPDFRecord, PDFError>;
  fiber: Fiber.Fiber<LoadedPDFRecord, PDFError> | null;
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

function isPasswordException(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "name" in cause &&
    cause.name === "PasswordException"
  );
}

function isEncryptedPDFError(error: PDFProcessingError): boolean {
  return (
    error.operation === "load-pdf-lib" &&
    error.cause instanceof Error &&
    error.cause.message.includes("is encrypted")
  );
}

export class PDFService {
  private activeFile: File | null = null;
  private passwordRegistry = new Map<File, string>();
  private documentCache = new Map<File, LoadedPDFRecord>();
  private loadEffects = new Map<File, Map<string, InFlightLoad>>();
  private sessionVersion = 0;

  loadPDF(file: File): Effect.Effect<void, PDFError> {
    return this.getOrLoadDocument(file, () => this.loadDocument(file)).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          this.activeFile = file;
        })
      ),
      Effect.asVoid
    );
  }

  loadPDFWithPassword(file: File, password: string): Effect.Effect<void, PDFError> {
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
          this.passwordRegistry.set(file, password);
          this.activeFile = file;
        })
      ),
      Effect.asVoid
    );
  }

  getPageCount(): number {
    if (!this.activeFile) return 0;
    return this.documentCache.get(this.activeFile)?.pdfDocument.getPageCount() ?? 0;
  }

  getPassword(file: File): string | undefined {
    return this.passwordRegistry.get(file);
  }

  renderPage(
    file: File,
    pageNumber: number,
    canvas: HTMLCanvasElement,
    scale = 1.5,
    rotation = 0
  ): Effect.Effect<void, PDFError> {
    return Effect.gen({ self: this }, function* () {
      const record = yield* this.getOrLoadDocument(file);
      const page = yield* Effect.tryPromise({
        try: () => record.pdfjsDocument.getPage(pageNumber),
        catch: (cause) => processingError("get-page", file, cause),
      });
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

      yield* this.renderPDFPage(file, page, canvas, context, viewport);
    });
  }

  reset(): Effect.Effect<void> {
    return Effect.suspend(() => {
      const records = Array.from(this.documentCache.values());
      const fibers = Array.from(this.loadEffects.values()).flatMap((fileEffects) =>
        Array.from(fileEffects.values())
          .map((load) => load.fiber)
          .filter((fiber): fiber is Fiber.Fiber<LoadedPDFRecord, PDFError> => fiber !== null)
      );
      this.activeFile = null;
      this.passwordRegistry.clear();
      this.documentCache.clear();
      this.loadEffects.clear();
      this.sessionVersion += 1;

      return Effect.forEach(fibers, Fiber.interrupt, { discard: true }).pipe(
        Effect.andThen(
          Effect.forEach(
            records,
            (record) =>
              Effect.tryPromise({
                try: () => record.pdfjsDocument.cleanup(),
                catch: () => undefined,
              }).pipe(Effect.catch(() => Effect.void)),
            { discard: true }
          )
        )
      );
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
      const load: InFlightLoad = { deferred, fiber: null };
      const fileEffects = this.loadEffects.get(file) ?? new Map();
      fileEffects.set(key, load);
      this.loadEffects.set(file, fileEffects);

      const version = this.sessionVersion;
      const loadEffect = (loader ?? (() => this.loadDocumentWithStoredPassword(file)))().pipe(
        Effect.tap((record) =>
          Effect.sync(() => {
            if (version === this.sessionVersion) {
              this.documentCache.set(file, record);
            } else {
              void record.pdfjsDocument.cleanup().catch(() => undefined);
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
        load.fiber = yield* Effect.forkDetach(loadEffect);
        return yield* Deferred.await(load.deferred);
      });
    });
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
      const typedArray = new Uint8Array(buffer);

      if (password !== undefined) {
        return yield* this.loadEncryptedDocument(file, typedArray, buffer, password);
      }

      const pdfDocumentResult = yield* Effect.result(this.loadPdfLib(file, buffer));
      if (Result.isFailure(pdfDocumentResult)) {
        if (isEncryptedPDFError(pdfDocumentResult.failure)) {
          return yield* this.loadEncryptedDocument(file, typedArray, buffer, "");
        }
        return yield* Effect.fail(pdfDocumentResult.failure);
      }

      const pdfjsDocument = yield* this.loadPdfJsDocument(file, typedArray);
      return { pdfDocument: pdfDocumentResult.success, pdfjsDocument };
    });
  }

  private loadEncryptedDocument(
    file: File,
    typedArray: Uint8Array,
    buffer: ArrayBuffer,
    password: string
  ): Effect.Effect<LoadedPDFRecord, PDFError> {
    return Effect.gen({ self: this }, function* () {
      const pdfDocument = yield* this.loadPdfLib(file, buffer, true);
      const pdfjsDocument = yield* this.loadPdfJsDocument(file, typedArray, password);

      return { pdfDocument, pdfjsDocument };
    });
  }

  private loadPdfLib(
    file: File,
    buffer: ArrayBuffer,
    ignoreEncryption = false
  ): Effect.Effect<PDFDocument, PDFProcessingError> {
    return Effect.tryPromise({
      try: () =>
        ignoreEncryption
          ? PDFDocument.load(buffer, { ignoreEncryption: true })
          : PDFDocument.load(buffer),
      catch: (cause) => processingError("load-pdf-lib", file, cause),
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
                  password === "" ? "needs-password" : "wrong-password"
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
        () => resume(Effect.succeed(undefined)),
        (cause) => resume(Effect.fail(processingError("render-page", file, cause)))
      );

      return Effect.sync(() => {
        try {
          renderTask.cancel();
        } catch {
          // Render cancellation is best effort when PDF.js has already completed.
        }
      });
    });
  }
}
