import { createSignal, onCleanup, onMount } from "solid-js";
import { THUMBNAIL_INTERSECTION_MARGIN, THUMBNAIL_SCALE } from "../../constants";
import { pdfService } from "../../services/pdf-service";
import type { PageState } from "../../types/interfaces";

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

  const frameStyle = () => {
    const ratio = baseAspectRatio();
    const quarterTurn = props.rotation % 180 !== 0;
    const frameRatio = quarterTurn ? 1 / ratio : ratio;

    return `--frame-ratio: ${frameRatio}; --stage-width: ${quarterTurn ? ratio * 100 : 100}%; --stage-height: ${quarterTurn ? 100 / ratio : 100}%; --page-rotation: ${props.rotation}deg`;
  };

  onMount(() => {
    const observer = new IntersectionObserver(
      async (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.disconnect();

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
            if (!container.isConnected) return;
            if (canvas.width > 0 && canvas.height > 0) {
              setBaseAspectRatio(canvas.width / canvas.height);
            }
            setRenderState("ready");
          } catch (_err) {
            setRenderState("error");
          }
        }
      },
      {
        root: props.scrollRoot,
        rootMargin: THUMBNAIL_INTERSECTION_MARGIN,
        threshold: 0,
      }
    );

    observer.observe(container);

    onCleanup(() => {
      canvas.width = 0;
      observer.disconnect();
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
    </span>
  );
}
