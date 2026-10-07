import { Effect, Fiber } from "effect";
import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { THUMBNAIL_INTERSECTION_MARGIN, THUMBNAIL_SCALE } from "../../constants";
import { PDFProcessing, type PDFRuntime } from "../../services/pdf-runtime";
import type { PageState } from "../../types/interfaces";

const PAGE_FRAME_RATIO = 3 / 4;
const OFFSCREEN_RELEASE_DELAY = 1000;

interface Props {
  page: PageState;
  rotation: number;
  scrollRoot: HTMLElement;
  runtime: PDFRuntime;
  showRetry?: boolean;
}

export default function EditorPageCanvas(props: Props) {
  const [renderState, setRenderState] = createSignal<"loading" | "ready" | "error">("loading");
  const [baseAspectRatio, setBaseAspectRatio] = createSignal(3 / 4);

  let container!: HTMLSpanElement;
  let canvas!: HTMLCanvasElement;
  let observer: IntersectionObserver | null = null;
  let renderFiber: Fiber.Fiber<unknown, unknown> | null = null;
  let disposed = false;
  let intersecting = false;
  let dirty = true;
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;

  const frameStyle = () => {
    const ratio = baseAspectRatio();
    const quarterTurn = props.rotation % 180 !== 0;
    // Keep the grid stable while preserving the source page's proportions inside the frame.
    let stageWidth = 100;
    let stageHeight = 100;

    if (!quarterTurn) {
      if (ratio >= PAGE_FRAME_RATIO) {
        stageHeight = (PAGE_FRAME_RATIO / ratio) * 100;
      } else {
        stageWidth = (ratio / PAGE_FRAME_RATIO) * 100;
      }
    } else if (1 / ratio >= PAGE_FRAME_RATIO) {
      stageWidth = ratio * 100;
      stageHeight = PAGE_FRAME_RATIO * 100;
    } else {
      stageWidth = (1 / PAGE_FRAME_RATIO) * 100;
      stageHeight = (1 / ratio) * 100;
    }

    return `--frame-ratio: ${PAGE_FRAME_RATIO}; --stage-width: ${stageWidth}%; --stage-height: ${stageHeight}%; --page-rotation: ${props.rotation}deg`;
  };

  const canUpdateRenderState = () => !disposed && container.isConnected;

  const cancelPendingRender = () => {
    const fiber = renderFiber;
    if (!fiber) return;
    renderFiber = null;
    dirty = true;
    void Effect.runPromise(Fiber.interrupt(fiber)).catch(() => undefined);
  };

  const clearReleaseTimer = () => {
    if (releaseTimer === undefined) return;
    clearTimeout(releaseTimer);
    releaseTimer = undefined;
  };

  const renderThumbnail = () => {
    if (disposed || !intersecting || !dirty || renderFiber !== null) return;

    dirty = false;
    // Leave the last frame visible while a revision renders. Clearing it here causes flashes.
    if (canvas.width === 0 || canvas.height === 0) setRenderState("loading");

    let fiber: Fiber.Fiber<unknown, unknown>;
    try {
      fiber = props.runtime.runFork(
        PDFProcessing.use((service) =>
          Effect.gen(function* () {
            const sourceRotation = yield* service.getPageRotation(
              props.page.sourceFile,
              props.page.sourcePageNumber
            );
            yield* service.renderPage(
              props.page.sourceFile,
              props.page.sourcePageNumber,
              canvas,
              THUMBNAIL_SCALE,
              sourceRotation
            );
          })
        )
      );
    } catch {
      if (canUpdateRenderState()) {
        setRenderState("error");
      }
      return;
    }
    renderFiber = fiber;

    void props.runtime
      .runPromise(Fiber.join(fiber))
      .then(
        () => {
          if (!canUpdateRenderState() || renderFiber !== fiber) return;
          if (canvas.width > 0 && canvas.height > 0) {
            setBaseAspectRatio(canvas.width / canvas.height);
          }
          setRenderState("ready");
        },
        () => {
          if (canUpdateRenderState() && renderFiber === fiber) {
            setRenderState("error");
          }
        }
      )
      .finally(() => {
        if (renderFiber === fiber) {
          renderFiber = null;
          renderThumbnail();
        }
      });
  };

  const observeForRender = () => {
    if (disposed) return;

    observer?.disconnect();
    let nextObserver!: IntersectionObserver;
    nextObserver = new IntersectionObserver(
      (entries) => {
        if (observer !== nextObserver) return;
        const entry = entries.find((entry) => entry.target === container);
        if (!entry) return;
        intersecting = entry.isIntersecting;
        if (intersecting) {
          clearReleaseTimer();
        } else {
          cancelPendingRender();
          if (releaseTimer === undefined && (canvas.width > 0 || canvas.height > 0)) {
            releaseTimer = setTimeout(() => {
              releaseTimer = undefined;
              if (!canUpdateRenderState() || intersecting) return;
              // The service keeps a bounded cache, so page canvases need not retain every
              // bitmap ever visited. A short grace period avoids churn on quick scrolls.
              canvas.width = 0;
              canvas.height = 0;
              dirty = true;
              if (renderState() !== "error") setRenderState("loading");
            }, OFFSCREEN_RELEASE_DELAY);
          }
        }
        renderThumbnail();
      },
      {
        root: props.scrollRoot,
        rootMargin: THUMBNAIL_INTERSECTION_MARGIN,
        threshold: 0,
      }
    );

    observer = nextObserver;
    nextObserver.observe(container);
  };

  const retryRender = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    if (renderState() !== "error" || disposed) return;
    setRenderState("loading");
    dirty = true;
    renderThumbnail();
  };

  createEffect(() => {
    void props.page.contentRevision;
    dirty = true;
    renderThumbnail();
  });

  onMount(() => {
    observeForRender();

    onCleanup(() => {
      disposed = true;
      clearReleaseTimer();
      cancelPendingRender();
      canvas.width = 0;
      canvas.height = 0;
      observer?.disconnect();
      observer = null;
    });
  });

  return (
    <span
      ref={container}
      data-testid="editor-page-canvas"
      data-render-state={renderState()}
      style={frameStyle()}
      classList={{
        "canvas-container": true,
        "thumbnail-placeholder": renderState() === "loading",
      }}
    >
      <span class="canvas-stage">
        <canvas ref={canvas} width={0} height={0} class="page-canvas" />
      </span>
      {renderState() === "error" && (
        <span
          data-testid="editor-page-canvas-error"
          class="editor-page-canvas-error"
          role="status"
          aria-atomic="true"
          aria-live="polite"
        >
          <span>Preview unavailable.</span>
          {props.showRetry !== false && (
            <button
              type="button"
              data-testid="editor-page-canvas-retry"
              class="editor-page-canvas-retry"
              aria-label="Retry page preview"
              onClick={retryRender}
            >
              Retry
            </button>
          )}
        </span>
      )}
    </span>
  );
}
