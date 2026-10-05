import { Deferred, Effect, Exit, Semaphore } from "effect";
import type { Semaphore as SemaphoreShape } from "effect/Semaphore";
import type * as pdfjsLib from "pdfjs-dist";
import type { PDFProcessingError } from "../types/interfaces";
import { collectFirstError, processingError } from "./pdf-errors";

interface PendingPageRequest {
  readonly completion: Deferred.Deferred<void, PDFProcessingError>;
  readonly file: File;
  readonly operation: string;
  readonly pagePromise: Promise<pdfjsLib.PDFPageProxy>;
  cleanupStarted: boolean;
}

interface PageResource {
  readonly page: pdfjsLib.PDFPageProxy;
  readonly request: PendingPageRequest;
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

export class PageResources {
  private pendingPageRequests = new Map<File, Set<PendingPageRequest>>();
  private readonly pageLocks = new WeakMap<File, Map<number, SemaphoreShape>>();

  private lockFor(file: File, pageNumber: number): SemaphoreShape {
    let byPage = this.pageLocks.get(file);
    if (!byPage) {
      byPage = new Map();
      this.pageLocks.set(file, byPage);
    }

    let lock = byPage.get(pageNumber);
    if (!lock) {
      lock = Semaphore.makeUnsafe(1);
      byPage.set(pageNumber, lock);
    }

    return lock;
  }

  getPage(
    pdfjsDocument: pdfjsLib.PDFDocumentProxy,
    file: File,
    pageNumber: number,
    operation: string
  ): Effect.Effect<PageResource, PDFProcessingError> {
    return Effect.suspend(() => {
      let pagePromise: Promise<pdfjsLib.PDFPageProxy>;

      try {
        pagePromise = pdfjsDocument.getPage(pageNumber);
      } catch (cause) {
        return Effect.fail(processingError(operation, file, cause));
      }

      const request: PendingPageRequest = {
        completion: Deferred.makeUnsafe<void, PDFProcessingError>(),
        file,
        operation,
        pagePromise,
        cleanupStarted: false,
      };
      const requests = this.pendingPageRequests.get(file) ?? new Set();
      requests.add(request);
      this.pendingPageRequests.set(file, requests);

      return Effect.tryPromise({
        try: () => pagePromise,
        catch: (cause) => processingError(operation, file, cause),
      }).pipe(
        Effect.map((page) => ({ page, request })),
        Effect.onExit((exit) => {
          if (Exit.isSuccess(exit)) return Effect.void;
          return this.cleanupPendingPage(request);
        })
      );
    });
  }

  withPageCleanup<A, E>(
    file: File,
    pageNumber: number,
    acquire: Effect.Effect<PageResource, PDFProcessingError>,
    use: (page: pdfjsLib.PDFPageProxy) => Effect.Effect<A, E>
  ): Effect.Effect<A, E | PDFProcessingError> {
    return this.lockFor(file, pageNumber).withPermit(
      Effect.acquireUseRelease(
        acquire,
        ({ page }) => use(page),
        ({ request }) => this.cleanupPendingPage(request)
      )
    );
  }

  drain(file?: File): Effect.Effect<void, PDFProcessingError> {
    return Effect.suspend(() => {
      const requests = file
        ? this.takePendingPageRequests(file)
        : Array.from(this.pendingPageRequests.values()).flatMap((fileRequests) =>
            Array.from(fileRequests)
          );
      if (!file) this.pendingPageRequests.clear();
      if (requests.length === 0) return Effect.void;

      const completion = collectFirstError(
        requests.map((request) => Deferred.await(request.completion))
      );
      return collectFirstError([completion, this.drain(file)]);
    });
  }

  private cleanupPendingPage(request: PendingPageRequest): Effect.Effect<void, PDFProcessingError> {
    return Effect.uninterruptible(
      Effect.suspend(() => {
        if (request.cleanupStarted) return Deferred.await(request.completion);
        request.cleanupStarted = true;

        return Effect.tryPromise({
          try: () => request.pagePromise,
          catch: () => undefined,
        }).pipe(
          Effect.matchEffect({
            onFailure: () => Effect.void,
            onSuccess: (page) => cleanupPage(page, request.file, request.operation),
          }),
          Effect.onExit((exit) =>
            Effect.sync(() => this.removePendingPageRequest(request)).pipe(
              Effect.andThen(Deferred.done(request.completion, exit)),
              Effect.asVoid
            )
          )
        );
      })
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
}
