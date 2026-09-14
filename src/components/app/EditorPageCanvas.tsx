import { createSignal, onCleanup, onMount } from "solid-js";
import { THUMBNAIL_INTERSECTION_MARGIN, THUMBNAIL_SCALE } from "../../constants";
import { pdfService } from "../../services/pdf-service";
import type { PageState } from "../../types/interfaces";

const PAGE_FRAME_RATIO = 3 / 4;

interface Props {
  page: PageState;
  rotation: number;
  scrollRoot: HTMLDivElement;
}

export default function EditorPageCanvas(props: Props) {
  const [renderState, setRenderState] = createSignal<"loading" | "ready" | "error">("loading");
  const [baseAspectRatio, setBaseAspectRatio] = createSignal(3 / 4);

  // Solid.js refs are assigned via JSX ref attribute
  let container!: HTMLSpanElement;
  let canvas!: HTMLCanvasElement;
  let observer: IntersectionObserver | null = null;
  let renderAttempt = 0;
  let renderInFlight = false;
  let disposed = false;

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

  const canUpdateRenderState = (attempt: number) =>
    !disposed && attempt === renderAttempt && container.isConnected;

  const renderThumbnail = async () => {
    if (disposed || renderInFlight) return;

    renderInFlight = true;
    const attempt = ++renderAttempt;
    canvas.width = 0;
    canvas.height = 0;
    setRenderState("loading");

    try {
      // Render the source page once. UI rotation happens on the existing canvas;
      // the export service applies the selected rotation to the output PDF.
      await pdfService.renderPage(
        props.page.sourceFile,
        props.page.sourcePageNumber,
        canvas,
        THUMBNAIL_SCALE,
        0
      );

      if (!canUpdateRenderState(attempt)) return;
      if (canvas.width > 0 && canvas.height > 0) {
        setBaseAspectRatio(canvas.width / canvas.height);
      }
      setRenderState("ready");
    } catch (_err) {
      if (canUpdateRenderState(attempt)) {
        setRenderState("error");
      }
    } finally {
      if (attempt === renderAttempt) {
        renderInFlight = false;
      }
    }
  };

  const observeForRender = () => {
    if (disposed) return;

    observer?.disconnect();
    let nextObserver!: IntersectionObserver;
    nextObserver = new IntersectionObserver(
      (entries) => {
        if (
          observer !== nextObserver ||
          !entries.some((entry) => entry.isIntersecting) ||
          renderInFlight
        ) {
          return;
        }
        nextObserver.disconnect();
        observer = null;
        void renderThumbnail();
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
    observeForRender();
  };

  onMount(() => {
    observeForRender();

    onCleanup(() => {
      disposed = true;
      renderAttempt += 1;
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
        <canvas ref={canvas} class="page-canvas" />
      </span>
      {renderState() === "error" && (
        <span
          data-testid="editor-page-canvas-error"
          role="status"
          aria-atomic="true"
          aria-live="polite"
          style="position: absolute; inset: 0; z-index: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.65rem; padding: 1rem; background: rgb(247 245 240 / 94%); color: var(--editor-body); font-size: 0.75rem; line-height: 1.4; text-align: center;"
        >
          <span>Preview unavailable.</span>
          <button
            type="button"
            data-testid="editor-page-canvas-retry"
            aria-label="Retry page preview"
            onClick={retryRender}
            onKeyDown={(event) => event.stopPropagation()}
            style="display: inline-flex; min-height: 2rem; align-items: center; justify-content: center; padding: 0.4rem 0.75rem; border: 1px solid var(--editor-line-strong); border-radius: 999px; background: var(--editor-paper); color: var(--editor-ink); cursor: pointer; font: inherit; font-size: 0.6875rem; font-weight: 600; line-height: 1; touch-action: manipulation;"
          >
            Retry
          </button>
        </span>
      )}
    </span>
  );
}
