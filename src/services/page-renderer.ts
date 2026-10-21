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
    return Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const renderTask = yield* Effect.try({
          try: () => page.render({ canvasContext: context, viewport, canvas }),
          catch: (cause) => processingError("render-page", file, cause),
        });

        const awaitRender = Effect.tryPromise({
          try: () => renderTask.promise,
          catch: (cause) => processingError("render-page", file, cause),
        });

        return yield* restore(awaitRender).pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              try {
                renderTask.cancel();
              } catch {
                // Render cancellation is best effort when PDF.js has already completed.
              }
            }).pipe(Effect.andThen(awaitRender.pipe(Effect.ignore)))
          )
        );
      })
    );
  }
}
