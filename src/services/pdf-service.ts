import { Cause, Deferred, Effect, Exit, Fiber, Option, Semaphore } from "effect";
import type * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { hasPageAdditions } from "../controllers/editor-additions-state";
import {
  type PageGeometry,
  type PageState,
  type PDFError,
  type PDFFields,
  PDFPasswordRequiredError,
  type PDFProcessingError,
} from "../types/interfaces";
import { type DocumentKey, makeDocumentStore } from "./document-store";
import { PageRenderer } from "./page-renderer";
import { PageResources } from "./page-resources";
import { collectFirstError, processingError } from "./pdf-errors";
import type { PDFOperationsService } from "./pdf-operations-service";
import { clampScaleToPixelBudget } from "./render-scale";

let pdfjsModule: Promise<typeof pdfjsLib> | null = null;

function loadPdfjs(): Promise<typeof pdfjsLib> {
  pdfjsModule ??= import("pdfjs-dist").then((module) => {
    module.GlobalWorkerOptions.workerSrc = pdfjsWorker;
    return module;
  });
  return pdfjsModule;
}

// One PDF.js worker serves every document of a runtime. Without one, getDocument
// starts, and later terminates, a separate worker for each loading task.
export class SharedPDFWorker {
  private worker: pdfjsLib.PDFWorker | undefined;
  private destroyed = false;

  get(pdfjs: typeof pdfjsLib): pdfjsLib.PDFWorker {
    if (this.destroyed) throw new Error("The PDF.js worker has been destroyed.");
    this.worker ??= new pdfjs.PDFWorker();
    return this.worker;
  }

  destroy(): void {
    this.destroyed = true;
    this.worker?.destroy();
    this.worker = undefined;
  }
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
  // pdf-lib cannot decrypt every PDF, so exports read an unencrypted copy that
  // is made on first use and kept until this record is released.
  readonly exportSource: Effect.Effect<File, PDFError>;
}

export type PDFDecrypt = (
  input: ArrayBuffer,
  password: string | undefined
) => Effect.Effect<Uint8Array<ArrayBuffer>, unknown>;

export type PDFEditedPageOperations = Pick<PDFOperationsService, "buildPDF" | "getFields">;

export interface PDFServiceOptions {
  readonly decrypt?: PDFDecrypt;
  // The runtime's editing support. Without it, this service loads and owns one.
  readonly operations?: Effect.Effect<PDFEditedPageOperations, PDFProcessingError>;
  // Without a shared worker, this service creates one and destroys it on dispose.
  readonly worker?: SharedPDFWorker;
}

// A single-page PDF built from an edited page, with its additions and the
// field answers that have a widget on that page.
interface DerivedPage {
  readonly key: string;
  readonly source: File;
  readonly file: File;
  readonly size: number;
  users: number;
  retired: boolean;
}

// Thumbnails, the viewer, and the filmstrip render the same edited page.
const DERIVED_PAGE_LIMIT = 32;
const DERIVED_PAGE_BYTES = 64 * 1024 * 1024;

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
  private readonly worker: SharedPDFWorker;
  private readonly ownsWorker: boolean;
  private ownedOperations: Promise<PDFOperationsService> | undefined;
  private readonly fileIds = new WeakMap<File, number>();
  private nextFileId = 0;
  // Insertion order is recency order.
  private readonly derivedPages = new Map<string, DerivedPage>();
  private readonly derivedBuilds = new Map<
    string,
    Deferred.Deferred<Exit.Exit<DerivedPage, PDFError>>
  >();
  // Derived documents need their own store. A source release or reset waits for
  // edited renders, so their cleanup must never wait on the source store.
  private derivedDocuments: PDFService | undefined;
  private disposed = false;

  constructor(private readonly options: PDFServiceOptions = {}) {
    this.ownsWorker = options.worker === undefined;
    this.worker = options.worker ?? new SharedPDFWorker();
  }

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

  // Returns the file itself when it is not encrypted.
  getExportSource(file: File): Effect.Effect<File, PDFError> {
    return this.documents.track(
      file,
      "get-export-source"
    )(
      Effect.gen({ self: this }, function* () {
        const record = yield* this.documents.acquire({ file, variant: AUTO_VARIANT });
        return yield* record.exportSource;
      })
    );
  }

  renderPageState(
    page: PageState,
    canvas: HTMLCanvasElement,
    scale: number,
    rotation: number,
    maxCanvasPixels?: number
  ): Effect.Effect<void, PDFError> {
    if (!hasPageAdditions(page))
      return this.renderPage(
        page.sourceFile,
        page.sourcePageNumber,
        canvas,
        scale,
        rotation,
        maxCanvasPixels
      );
    return this.documents.track(
      page.sourceFile,
      "render-edited-page"
    )(
      Effect.gen({ self: this }, function* () {
        const operations = yield* this.getOperations(page.sourceFile);
        const edited = yield* this.withVisibleFieldAnswers(operations, page);
        if (!hasPageAdditions(edited))
          return yield* this.renderSourcePage(
            page.sourceFile,
            page.sourcePageNumber,
            canvas,
            scale,
            rotation,
            maxCanvasPixels
          );
        const key = this.derivedPageKey(edited);
        const derivedDocuments = this.getDerivedDocuments();
        // Claiming outside the interruptible build keeps an entry from being
        // released while it is rendered. A retired entry is released by its last user.
        yield* Effect.uninterruptibleMask((restore) =>
          restore(this.derivedPage(operations, edited, key)).pipe(
            Effect.tap((entry) =>
              Effect.sync(() => {
                entry.users++;
              })
            ),
            Effect.flatMap((entry) =>
              restore(
                this.pageRenderer.withPermit(
                  derivedDocuments.renderPage(
                    entry.file,
                    1,
                    canvas,
                    scale,
                    rotation,
                    maxCanvasPixels
                  )
                )
              ).pipe(Effect.ensuring(this.unclaimDerivedPage(entry)))
            )
          )
        );
      })
    );
  }

  private getOperations(file: File): Effect.Effect<PDFEditedPageOperations, PDFProcessingError> {
    if (this.options.operations) return this.options.operations;
    return Effect.tryPromise({
      try: () => {
        if (this.disposed) throw new Error("The PDF service has been disposed.");
        if (!this.ownedOperations) {
          const loading = import("./pdf-operations-service").then(
            ({ PDFOperationsService }) => new PDFOperationsService(this)
          );
          this.ownedOperations = loading;
          loading.catch(() => {
            if (this.ownedOperations === loading) this.ownedOperations = undefined;
          });
        }
        return this.ownedOperations;
      },
      catch: (cause) => processingError("load-text-renderer", file, cause),
    });
  }

  private withOwnedOperations(
    use: (operations: PDFOperationsService) => Effect.Effect<void>,
    release = false
  ): Effect.Effect<void> {
    return Effect.suspend(() => {
      const loading = this.ownedOperations;
      if (!loading) return Effect.void;
      if (release) this.ownedOperations = undefined;
      return Effect.promise(() => loading.then(use, () => Effect.void)).pipe(Effect.flatten);
    });
  }

  // Answers are copied to every page of a field group. Only pages with a
  // widget for an answered field look different, so the rest render as-is.
  private withVisibleFieldAnswers(
    operations: PDFEditedPageOperations,
    page: PageState
  ): Effect.Effect<PageState> {
    const answers = page.fieldAnswers;
    if (!answers?.length) return Effect.succeed(page);
    return operations.getFields(page.sourceFile).pipe(
      Effect.map((fields: PDFFields) => {
        const visible = new Set(
          fields.widgets
            .filter((widget) => widget.pageNumber === page.sourcePageNumber)
            .map((widget) => widget.fieldRef)
        );
        return {
          ...page,
          fieldAnswers: answers.filter((answer) => visible.has(answer.fieldRef)),
        };
      }),
      // Build with every answer, as exports do, when fields cannot be read here.
      Effect.orElseSucceed(() => page)
    );
  }

  private derivedPageKey(page: PageState): string {
    let id = this.fileIds.get(page.sourceFile);
    if (id === undefined) {
      id = this.nextFileId++;
      this.fileIds.set(page.sourceFile, id);
    }
    return `${id}:${page.sourcePageNumber}:${JSON.stringify([
      page.addedText ?? [],
      page.addedCheckmarks ?? [],
      page.fieldAnswers ?? [],
    ])}`;
  }

  private getDerivedDocuments(): PDFService {
    this.derivedDocuments ??= new PDFService({ worker: this.worker });
    return this.derivedDocuments;
  }

  private derivedPage(
    operations: PDFEditedPageOperations,
    page: PageState,
    key: string
  ): Effect.Effect<DerivedPage, PDFError> {
    return Effect.suspend(() => {
      const cached = this.derivedPages.get(key);
      if (cached) {
        this.derivedPages.delete(key);
        this.derivedPages.set(key, cached);
        return Effect.succeed(cached);
      }
      const pending = this.derivedBuilds.get(key);
      if (pending) {
        return Deferred.await(pending).pipe(
          Effect.flatMap((exit) => {
            if (Exit.isSuccess(exit)) return Effect.succeed(exit.value);
            // Only the builder was cancelled. A live waiter builds instead.
            if (exit.cause.reasons.every(Cause.isInterruptReason))
              return this.derivedPage(operations, page, key);
            return Effect.failCause(exit.cause);
          })
        );
      }

      const source = page.sourceFile;
      const version = this.documents.version(source);
      const completion = Deferred.makeUnsafe<Exit.Exit<DerivedPage, PDFError>>();
      this.derivedBuilds.set(key, completion);
      return this.editedRenders
        .withPermit(
          // Source metadata calls track their own fiber. Keep the outer source
          // operation registered until the build settles.
          Effect.acquireUseRelease(
            Effect.forkChild(
              Effect.suspend(() =>
                operations.buildPDF([{ ...page, rotation: 0, markedForDeletion: false }])
              )
            ),
            Fiber.join,
            (fiber) => Fiber.interrupt(fiber).pipe(Effect.asVoid)
          )
        )
        .pipe(
          Effect.map(({ data }) => {
            const bytes =
              data.buffer instanceof ArrayBuffer
                ? (data as Uint8Array<ArrayBuffer>)
                : new Uint8Array(data);
            const entry: DerivedPage = {
              key,
              source,
              file: new File([bytes], "edited-page.pdf", { type: "application/pdf" }),
              size: bytes.byteLength,
              users: 0,
              retired: false,
            };
            // A build that outlives its source's release or reset is used once.
            if (!this.disposed && this.documents.isCurrent(source, version))
              this.derivedPages.set(key, entry);
            else entry.retired = true;
            return entry;
          }),
          Effect.onExit((exit) =>
            Effect.sync(() => {
              if (this.derivedBuilds.get(key) === completion) this.derivedBuilds.delete(key);
            }).pipe(Effect.andThen(Deferred.succeed(completion, exit)))
          )
        );
    });
  }

  private unclaimDerivedPage(entry: DerivedPage): Effect.Effect<void> {
    return Effect.suspend(() => {
      entry.users--;
      const released: DerivedPage[] = [];
      if (entry.retired && entry.users === 0) released.push(entry);
      let count = this.derivedPages.size;
      let bytes = 0;
      for (const cached of this.derivedPages.values()) bytes += cached.size;
      for (const cached of this.derivedPages.values()) {
        if (count <= DERIVED_PAGE_LIMIT && bytes <= DERIVED_PAGE_BYTES) break;
        if (cached.users > 0) continue;
        this.derivedPages.delete(cached.key);
        cached.retired = true;
        released.push(cached);
        count--;
        bytes -= cached.size;
      }
      return this.releaseDerivedFiles(released).pipe(
        Effect.catch((error) => Effect.logWarning(error))
      );
    });
  }

  private retireDerivedPages(
    matches: (entry: DerivedPage) => boolean
  ): Effect.Effect<void, PDFProcessingError> {
    return Effect.suspend(() => {
      const released: DerivedPage[] = [];
      for (const entry of [...this.derivedPages.values()]) {
        if (!matches(entry)) continue;
        this.derivedPages.delete(entry.key);
        entry.retired = true;
        if (entry.users === 0) released.push(entry);
      }
      return this.releaseDerivedFiles(released);
    });
  }

  private releaseDerivedFiles(
    entries: readonly DerivedPage[]
  ): Effect.Effect<void, PDFProcessingError> {
    const derivedDocuments = this.derivedDocuments;
    if (!derivedDocuments || entries.length === 0) return Effect.void;
    return collectFirstError(entries.map((entry) => derivedDocuments.releaseFile(entry.file)));
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
    rotation = 0,
    maxPixels?: number
  ): Effect.Effect<void, PDFError> {
    return this.documents.track(
      file,
      "render-page"
    )(this.renderSourcePage(file, pageNumber, canvas, scale, rotation, maxPixels));
  }

  // Callers track the source operation.
  private renderSourcePage(
    file: File,
    pageNumber: number,
    canvas: HTMLCanvasElement,
    scale: number,
    rotation: number,
    maxPixels: number | undefined
  ): Effect.Effect<void, PDFError> {
    return Effect.gen({ self: this }, function* () {
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
                  const fitted =
                    maxPixels === undefined
                      ? scale
                      : (() => {
                          const base = page.getViewport({ scale: 1, rotation });
                          return clampScaleToPixelBudget(scale, base.width, base.height, maxPixels);
                        })();
                  const nextViewport = page.getViewport({ scale: fitted, rotation });
                  canvas.width = nextViewport.width;
                  canvas.height = nextViewport.height;

                  // Choose this on the first context creation. WebKit can lose
                  // vector widget ink across PDF.js animation-frame yields on
                  // its default canvas backend; later calls cannot change it.
                  const nextContext = canvas.getContext("2d", { willReadFrequently: true });
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
    });
  }

  releaseFile(file: File): Effect.Effect<void, PDFProcessingError> {
    return Effect.uninterruptible(
      Effect.suspend(() => {
        if (this.activeFile === file) this.activeFile = null;
        this.passwordRegistry.delete(file);
        // Releasing the source first settles its edited renders.
        return collectFirstError([
          this.documents.releaseFile(file),
          this.retireDerivedPages((entry) => entry.source === file),
          this.withOwnedOperations((operations) => operations.releaseFile(file)),
        ]);
      })
    );
  }

  reset(): Effect.Effect<void, PDFProcessingError> {
    return Effect.uninterruptible(
      Effect.suspend(() => {
        this.activeFile = null;
        this.passwordRegistry.clear();
        return collectFirstError([
          this.documents.reset,
          this.retireDerivedPages(() => true),
          this.withOwnedOperations((operations) => operations.clearCache()),
        ]);
      })
    );
  }

  dispose(): Effect.Effect<void> {
    return Effect.uninterruptible(
      Effect.suspend(() => {
        this.disposed = true;
        return this.documents.dispose().pipe(
          Effect.andThen(this.retireDerivedPages(() => true).pipe(Effect.ignore)),
          Effect.andThen(Effect.suspend(() => this.derivedDocuments?.dispose() ?? Effect.void)),
          Effect.andThen(this.withOwnedOperations((operations) => operations.dispose(), true)),
          Effect.andThen(
            Effect.sync(() => {
              if (this.ownsWorker) this.worker.destroy();
            })
          )
        );
      })
    );
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

  private loadExportSource(
    file: File,
    pdfjsDocument: pdfjsLib.PDFDocumentProxy,
    password: string | undefined
  ): Effect.Effect<File, PDFProcessingError> {
    return Effect.gen({ self: this }, function* () {
      const { info } = yield* Effect.tryPromise({
        try: () => pdfjsDocument.getMetadata(),
        catch: (cause) => processingError("inspect-encryption", file, cause),
      });
      if (!("EncryptFilterName" in info) || info.EncryptFilterName == null) return file;

      const decrypt = this.options.decrypt;
      if (!decrypt)
        return yield* Effect.fail(
          processingError(
            "decrypt-source",
            file,
            new Error("Protected PDFs cannot be prepared for export.")
          )
        );
      const input = yield* Effect.tryPromise({
        try: () => file.arrayBuffer(),
        catch: (cause) => processingError("read-file", file, cause),
      });
      // Without a password, qpdf tries the empty user password that opens
      // owner-password-only PDFs.
      const output = yield* decrypt(input, password).pipe(
        Effect.mapError((cause) => processingError("decrypt-source", file, cause))
      );
      return new File([output], file.name, {
        type: "application/pdf",
      });
    });
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
          try: () => {
            const worker = this.worker.get(pdfjs);
            return password === undefined
              ? pdfjs.getDocument({ data, worker })
              : pdfjs.getDocument({ data, password, worker });
          },
          catch: (cause) => processingError("load-pdf-js", file, cause),
        });
        loadingTask = task;
        const exportSource = yield* Effect.cachedWithTTL(
          Effect.suspend(() =>
            resolvedRecord
              ? this.loadExportSource(file, resolvedRecord.pdfjsDocument, password)
              : Effect.fail(
                  processingError("decrypt-source", file, new Error("The PDF is not loaded."))
                )
          ),
          (exit) => (Exit.isSuccess(exit) ? Infinity : 0)
        );
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
                    exportSource,
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
