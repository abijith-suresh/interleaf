import { Effect, Fiber } from "effect";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { PDFProcessing, type PDFRuntime } from "../../services/pdf-runtime";
import type { PageState } from "../../types/interfaces";
import EditorPageCanvas from "./EditorPageCanvas";

const VIEWER_MAX_PIXELS = 16_000_000;
const VIEWER_MAX_SCALE = 1.5;
const VIEWER_MAX_DEVICE_PIXEL_RATIO = 2;
const VIEWER_GUTTER = 32;
const FILMSTRIP_WINDOW_SIZE = 12;
const FILMSTRIP_OVERSCAN = 3;
const FILMSTRIP_DESKTOP_ITEM_EXTENT = 96;
const FILMSTRIP_MOBILE_ITEM_EXTENT = 84;

interface Props {
  pages: PageState[];
  navigationPageIds: string[];
  activePageId: string | null;
  runtime: PDFRuntime;
  onActivePageChange: (pageId: string) => void;
  onClose: () => void;
}

export default function EditorPageViewer(props: Props) {
  const [renderState, setRenderState] = createSignal<"loading" | "ready" | "error">("loading");
  const [isMobile, setIsMobile] = createSignal(false);
  const [filmstripWindowStart, setFilmstripWindowStart] = createSignal(0);

  let pane!: HTMLElement;
  let closeButton!: HTMLButtonElement;
  let stage!: HTMLDivElement;
  let filmstrip!: HTMLElement;
  let canvas!: HTMLCanvasElement;
  let mounted = false;
  let disposed = false;
  let renderAttempt = 0;
  let renderQueued = false;
  let renderLoopRunning = false;
  let renderFiber: Fiber.Fiber<unknown, unknown> | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let mobileMediaQuery: MediaQueryList | null = null;
  let updateMobileMode: (() => void) | null = null;
  let reviewBackground: HTMLElement | null = null;

  const navigationPages = createMemo(() =>
    props.navigationPageIds
      .map((id) => props.pages.find((page) => page.id === id))
      .filter((page): page is PageState => page !== undefined)
  );
  const currentPage = createMemo(() => {
    const pages = navigationPages();
    return pages.find((page) => page.id === props.activePageId) ?? pages[0] ?? null;
  });
  const currentNavigationIndex = createMemo(() => {
    const page = currentPage();
    return page ? navigationPages().findIndex((candidate) => candidate.id === page.id) : -1;
  });
  const currentWorkspaceIndex = createMemo(() => {
    const page = currentPage();
    return page ? props.pages.findIndex((candidate) => candidate.id === page.id) : -1;
  });
  const filmstripWindow = createMemo(() => {
    const pages = navigationPages();
    const start = Math.min(
      filmstripWindowStart(),
      Math.max(0, pages.length - FILMSTRIP_WINDOW_SIZE)
    );
    const end = Math.min(start + FILMSTRIP_WINDOW_SIZE, pages.length);
    const extent = isMobile() ? FILMSTRIP_MOBILE_ITEM_EXTENT : FILMSTRIP_DESKTOP_ITEM_EXTENT;

    return {
      pages: pages.slice(start, end),
      before: start * extent,
      after: (pages.length - end) * extent,
    };
  });

  function getFilmstripItemExtent(): number {
    return isMobile() ? FILMSTRIP_MOBILE_ITEM_EXTENT : FILMSTRIP_DESKTOP_ITEM_EXTENT;
  }

  function updateFilmstripWindow(): void {
    if (!filmstrip) return;

    const offset = isMobile() ? filmstrip.scrollLeft : filmstrip.scrollTop;
    const requestedStart = Math.floor(offset / getFilmstripItemExtent()) - FILMSTRIP_OVERSCAN;
    const maxStart = Math.max(0, navigationPages().length - FILMSTRIP_WINDOW_SIZE);
    setFilmstripWindowStart(Math.min(Math.max(0, requestedStart), maxStart));
  }

  function filmstripSpacerStyle(size: number): string {
    if (size === 0) return "display: none";
    return isMobile() ? `width: ${size}px; height: 1px` : `height: ${size}px; width: 1px`;
  }

  function interruptRender(): void {
    const fiber = renderFiber;
    if (!fiber) return;
    void Effect.runPromise(Fiber.interrupt(fiber)).catch(() => undefined);
  }

  function canUpdateRenderState(attempt: number): boolean {
    return !disposed && attempt === renderAttempt && canvas.isConnected;
  }

  function getViewerScale(
    pageWidth: number,
    pageHeight: number
  ): {
    cssScale: number;
    renderScale: number;
  } {
    const devicePixelRatio = Math.min(
      Math.max(window.devicePixelRatio || 1, 1),
      VIEWER_MAX_DEVICE_PIXEL_RATIO
    );
    const pixelSafeRenderScale = Math.sqrt(VIEWER_MAX_PIXELS / (pageWidth * pageHeight));
    const fitScale =
      stage.clientWidth === 0 || stage.clientHeight === 0
        ? VIEWER_MAX_SCALE
        : Math.min(
            Math.max(stage.clientWidth - VIEWER_GUTTER * 2, 1) / pageWidth,
            Math.max(stage.clientHeight - VIEWER_GUTTER * 2, 1) / pageHeight
          );
    const cssScale = Math.min(VIEWER_MAX_SCALE, fitScale, pixelSafeRenderScale / devicePixelRatio);

    return {
      cssScale,
      renderScale: cssScale * devicePixelRatio,
    };
  }

  async function renderLoop(): Promise<void> {
    if (renderLoopRunning) return;
    renderLoopRunning = true;

    try {
      while (renderQueued && !disposed) {
        renderQueued = false;
        const page = currentPage();
        const attempt = ++renderAttempt;

        if (!page) {
          setRenderState("loading");
          continue;
        }

        setRenderState("loading");
        canvas.width = 0;
        canvas.height = 0;
        interruptRender();

        let fiber: Fiber.Fiber<unknown, unknown>;
        try {
          fiber = props.runtime.runFork(
            PDFProcessing.use((service) =>
              Effect.gen(function* () {
                const sourceRotation = yield* service.getPageRotation(
                  page.sourceFile,
                  page.sourcePageNumber
                );
                const rotation = (sourceRotation + page.rotation) % 360;
                const pageSize = yield* service.getPageSize(
                  page.sourceFile,
                  page.sourcePageNumber,
                  rotation
                );
                const { cssScale, renderScale } = getViewerScale(pageSize.width, pageSize.height);
                canvas.style.width = `${pageSize.width * cssScale}px`;
                canvas.style.height = `${pageSize.height * cssScale}px`;
                yield* service.renderPage(
                  page.sourceFile,
                  page.sourcePageNumber,
                  canvas,
                  renderScale,
                  rotation
                );
              })
            )
          );
        } catch {
          if (canUpdateRenderState(attempt)) setRenderState("error");
          continue;
        }

        renderFiber = fiber;
        try {
          await props.runtime.runPromise(Fiber.join(fiber));
          if (canUpdateRenderState(attempt)) setRenderState("ready");
        } catch {
          // Navigation and resizing interrupt the current render on purpose. The queued
          // request will render the latest page or fit when this fiber settles.
          if (canUpdateRenderState(attempt) && !renderQueued) setRenderState("error");
        } finally {
          if (renderFiber === fiber) renderFiber = null;
        }
      }
    } finally {
      renderLoopRunning = false;
      if (renderQueued && !disposed) void renderLoop();
    }
  }

  function requestRender(): void {
    if (disposed || !mounted) return;
    renderQueued = true;
    interruptRender();
    if (!renderLoopRunning) void renderLoop();
  }

  function selectPage(pageId: string): void {
    if (navigationPages().some((page) => page.id === pageId)) {
      props.onActivePageChange(pageId);
    }
  }

  function moveBy(offset: number): void {
    const nextIndex = currentNavigationIndex() + offset;
    const nextPage = navigationPages()[nextIndex];
    if (nextPage) selectPage(nextPage.id);
  }

  function retryRender(): void {
    if (renderState() !== "error") return;
    requestRender();
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      props.onClose();
      return;
    }

    if (event.key === "Tab" && isMobile()) {
      const focusable = Array.from(
        pane.querySelectorAll<HTMLElement>(
          "button:not(:disabled), [href], [tabindex]:not([tabindex='-1'])"
        )
      );
      const first = focusable[0];
      const last = focusable.at(-1);

      if (!first || !last) {
        event.preventDefault();
        return;
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      moveBy(event.key === "ArrowLeft" ? -1 : 1);
    }
  }

  createEffect(() => {
    const page = currentPage();
    const rotation = page?.rotation;
    if (page && page.id !== props.activePageId) {
      props.onActivePageChange(page.id);
    }
    void rotation;
    navigationPages();
    if (mounted) requestRender();
  });

  createEffect(() => {
    const index = currentNavigationIndex();
    const start = filmstripWindowStart();
    const total = navigationPages().length;
    const maxStart = Math.max(0, total - FILMSTRIP_WINDOW_SIZE);

    if (start > maxStart) {
      setFilmstripWindowStart(maxStart);
      return;
    }

    if (
      !mounted ||
      !filmstrip ||
      index < 0 ||
      (index >= start && index < start + FILMSTRIP_WINDOW_SIZE)
    ) {
      return;
    }

    const nextStart = Math.min(Math.max(0, index - FILMSTRIP_OVERSCAN), maxStart);
    setFilmstripWindowStart(nextStart);
    queueMicrotask(() => {
      if (disposed) return;
      const offset = nextStart * getFilmstripItemExtent();
      if (isMobile()) {
        filmstrip.scrollLeft = offset;
      } else {
        filmstrip.scrollTop = offset;
      }
    });
  });

  createEffect(() => {
    if (!mounted || !reviewBackground) return;
    if (isMobile()) {
      reviewBackground.setAttribute("inert", "");
    } else {
      reviewBackground.removeAttribute("inert");
    }
  });

  onMount(() => {
    mounted = true;
    reviewBackground =
      pane.closest(".editor-workspace")?.querySelector<HTMLElement>(".editor-workspace-main") ??
      null;
    mobileMediaQuery = window.matchMedia("(max-width: 767px)");
    const handleMobileModeChange = () => setIsMobile(mobileMediaQuery?.matches ?? false);
    updateMobileMode = handleMobileModeChange;
    handleMobileModeChange();
    if (mobileMediaQuery.matches) reviewBackground?.setAttribute("inert", "");
    mobileMediaQuery.addEventListener("change", handleMobileModeChange);
    queueMicrotask(() => closeButton?.focus());
    requestRender();

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(requestRender);
      resizeObserver.observe(stage);
    }
  });

  onCleanup(() => {
    disposed = true;
    renderQueued = false;
    renderAttempt += 1;
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (mobileMediaQuery && updateMobileMode) {
      mobileMediaQuery.removeEventListener("change", updateMobileMode);
    }
    updateMobileMode = null;
    reviewBackground?.removeAttribute("inert");
    reviewBackground = null;
    const fiber = renderFiber;
    renderFiber = null;
    if (fiber) {
      void Effect.runPromise(Fiber.interrupt(fiber)).catch(() => undefined);
    }
    canvas.width = 0;
    canvas.height = 0;
  });

  return (
    <aside
      ref={pane}
      id="editor-page-review"
      data-testid="editor-page-viewer"
      class="editor-review-pane"
      role="dialog"
      aria-modal={isMobile() ? "true" : "false"}
      aria-labelledby="editor-review-title"
      onKeyDown={handleKeyDown}
    >
      <header class="editor-review-header">
        <div class="editor-review-heading">
          <h2 id="editor-review-title" data-testid="editor-viewer-title">
            Page {currentWorkspaceIndex() + 1}
          </h2>
          <span>
            {currentNavigationIndex() + 1} of {navigationPages().length}
          </span>
        </div>
        <button
          ref={closeButton}
          type="button"
          data-testid="editor-page-viewer-close-button"
          class="editor-review-close"
          aria-label="Close page review"
          onClick={props.onClose}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="m5 5 10 10M15 5 5 15" />
          </svg>
        </button>
      </header>

      <div class="editor-review-body">
        <nav
          ref={filmstrip}
          class="editor-review-filmstrip"
          aria-label="Pages in review"
          onScroll={updateFilmstripWindow}
        >
          <span
            class="editor-review-filmstrip-spacer"
            style={filmstripSpacerStyle(filmstripWindow().before)}
            aria-hidden="true"
          />
          <For each={filmstripWindow().pages}>
            {(page) => {
              const workspaceIndex = () =>
                props.pages.findIndex((candidate) => candidate.id === page.id);
              const navigationIndex = () =>
                navigationPages().findIndex((candidate) => candidate.id === page.id);

              return (
                <button
                  type="button"
                  class="editor-review-filmstrip-item"
                  classList={{ "is-active": currentPage()?.id === page.id }}
                  aria-current={currentPage()?.id === page.id ? "page" : undefined}
                  aria-label={`Review page ${workspaceIndex() + 1}`}
                  tabIndex={currentPage()?.id === page.id ? 0 : -1}
                  title={`Page ${workspaceIndex() + 1}`}
                  onClick={() => selectPage(page.id)}
                >
                  <EditorPageCanvas
                    page={page}
                    runtime={props.runtime}
                    rotation={page.rotation}
                    scrollRoot={filmstrip}
                    showRetry={false}
                  />
                  <span>{navigationIndex() + 1}</span>
                </button>
              );
            }}
          </For>
          <span
            class="editor-review-filmstrip-spacer"
            style={filmstripSpacerStyle(filmstripWindow().after)}
            aria-hidden="true"
          />
        </nav>

        <div
          ref={stage}
          class="editor-review-stage"
          data-render-state={renderState()}
          aria-busy={renderState() === "loading"}
        >
          <canvas
            ref={canvas}
            class="editor-review-canvas"
            role="img"
            aria-label={`Preview of page ${currentWorkspaceIndex() + 1}`}
          >
            Page preview.
          </canvas>
          <Show when={renderState() === "loading"}>
            <p class="editor-review-state" role="status" aria-live="polite">
              Loading page…
            </p>
          </Show>
          <Show when={renderState() === "error"}>
            <div class="editor-review-state editor-review-error" role="alert">
              <span>Preview unavailable.</span>
              <button
                type="button"
                data-testid="editor-page-viewer-retry"
                class="editor-review-retry"
                onClick={retryRender}
              >
                Try again
              </button>
            </div>
          </Show>
        </div>
      </div>

      <footer class="editor-review-controls">
        <button
          type="button"
          data-testid="editor-page-viewer-previous"
          class="editor-review-nav"
          aria-label="Previous page"
          disabled={currentNavigationIndex() <= 0}
          onClick={() => moveBy(-1)}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="m12.5 4-6 6 6 6" />
          </svg>
          <span>Previous</span>
        </button>
        <span class="editor-review-position" aria-live="polite">
          Page {currentWorkspaceIndex() + 1}
        </span>
        <button
          type="button"
          data-testid="editor-page-viewer-next"
          class="editor-review-nav"
          aria-label="Next page"
          disabled={currentNavigationIndex() >= navigationPages().length - 1}
          onClick={() => moveBy(1)}
        >
          <span>Next</span>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="m7.5 4 6 6-6 6" />
          </svg>
        </button>
      </footer>
    </aside>
  );
}
