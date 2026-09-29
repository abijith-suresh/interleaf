import { Effect, Semaphore } from "effect";
import type * as pdfjsLib from "pdfjs-dist";
import type { PDFProcessingError } from "../types/interfaces";
import { processingError } from "./pdf-errors";

const MAX_CONCURRENT_PAGE_RENDERS = 2;

export class PageRenderer {
  private readonly renderSemaphore = Semaphore.makeUnsafe(MAX_CONCURRENT_PAGE_RENDERS);

  withPermit<A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E> {
    return this.renderSemaphore.withPermit(effect);
  }

  render(
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
