import { Deferred, Effect, Exit } from "effect";
import type * as pdfjsLib from "pdfjs-dist";
import type { PDFProcessingError } from "../types/interfaces";
import { collectFirstError, continueAfterError, processingError } from "./pdf-errors";

interface PendingPageRequest {
  readonly completion: Deferred.Deferred<void>;
  readonly file: File;
  readonly operation: string;
  readonly pagePromise: Promise<pdfjsLib.PDFPageProxy>;
  page: pdfjsLib.PDFPageProxy | undefined;
  cleanupError: PDFProcessingError | undefined;
  pageSettled: boolean;
  cleanupStarted: boolean;
  cleaned: boolean;
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
        completion: Deferred.makeUnsafe<void>(),
        file,
        operation,
        pagePromise,
        page: undefined,
        cleanupError: undefined,
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

  withPageCleanup<A, E>(
    acquire: Effect.Effect<PageResource, PDFProcessingError>,
    use: (page: pdfjsLib.PDFPageProxy) => Effect.Effect<A, E>
  ): Effect.Effect<A, E | PDFProcessingError> {
    return Effect.acquireUseRelease(
      acquire,
      ({ page }) => use(page),
      ({ request }) => this.cleanupPendingPage(request)
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

      const accumulator: { current?: PDFProcessingError } = {};
      return continueAfterError(accumulator, this.awaitPendingPageRequests(requests)).pipe(
        Effect.andThen(this.drain(file)),
        Effect.andThen(
          Effect.suspend(() =>
            accumulator.current ? Effect.fail(accumulator.current) : Effect.void
          )
        )
      );
    });
  }

  private cleanupPendingPage(request: PendingPageRequest): Effect.Effect<void, PDFProcessingError> {
    return Effect.suspend(() => {
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
    return collectFirstError(
      requests.map((request) =>
        Deferred.await(request.completion).pipe(
          Effect.andThen(
            Effect.suspend(() =>
              request.cleanupError ? Effect.fail(request.cleanupError) : Effect.void
            )
          )
        )
      )
    );
  }
}
