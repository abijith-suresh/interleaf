import { createEffect, createSignal, on, onCleanup, onMount } from "solid-js";
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
  const [rendered, setRendered] = createSignal(false);

  // Solid.js refs are assigned via JSX ref attribute
  // eslint-disable-next-line no-unassigned-vars
  let container!: HTMLDivElement;
  // eslint-disable-next-line no-unassigned-vars
  let canvas!: HTMLCanvasElement;

  // Container switches to landscape aspect-ratio (4:3) for 90° / 270° rotations.
  // Uses a CSS class (not inline style) so the browser treats it as a definite height
  // — allowing max-height: 100% on the child canvas to resolve correctly.
  const isTransposed = () => props.rotation % 180 !== 0;

  onMount(() => {
    const observer = new IntersectionObserver(
      async (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.disconnect();

          try {
            // Render at the current rotation so pages that are already rotated when
            // they first enter the viewport get the correct orientation immediately.
            // pdf.js rotation is CCW; UI rotation is CW — convert direction.
            const pdfjsRotation = (360 - props.rotation) % 360;
            await pdfService.renderPage(
              props.page.sourceFile,
              props.page.sourcePageNumber,
              canvas,
              THUMBNAIL_SCALE,
              pdfjsRotation
            );
            if (!container.isConnected) return;
            setRenderState("ready");
            setRendered(true);
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

  // Re-render with fade-dissolve animation when rotation changes after first render.
  // defer: true prevents this from firing on initial mount.
  createEffect(
    on(
      () => props.rotation,
      async (rotation) => {
        if (!rendered()) return;
        try {
          // Fade out fast (80ms ease-in via CSS), then render while invisible,
          // then remove the class to fade back in (120ms ease-out via CSS).
          canvas.classList.add("is-rendering");
          await new Promise<void>((resolve) => setTimeout(resolve, 80));
          if (!container.isConnected) return;
          const pdfjsRotation = (360 - rotation) % 360;
          await pdfService.renderPage(
            props.page.sourceFile,
            props.page.sourcePageNumber,
            canvas,
            THUMBNAIL_SCALE,
            pdfjsRotation
          );
        } catch (_err) {
        } finally {
          canvas.classList.remove("is-rendering");
        }
      },
      { defer: true }
    )
  );

  return (
    <div
      ref={container}
      data-testid="editor-page-canvas"
      data-render-state={renderState()}
      classList={{
        "canvas-container": true,
        "thumbnail-placeholder": renderState() === "loading",
        "is-transposed": isTransposed(),
      }}
    >
      <canvas ref={canvas} class="page-canvas" />
    </div>
  );
}
