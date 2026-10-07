import { Effect, Fiber } from "effect";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { PDFProcessing, type PDFRuntime } from "../../services/pdf-runtime";
import type { PageState } from "../../types/interfaces";
import EditorContentPanel from "./EditorContentPanel";
import EditorPageCanvas from "./EditorPageCanvas";

const VIEWER_MAX_PIXELS = 16_000_000;
const VIEWER_MOBILE_MAX_PIXELS = 4_000_000;
const VIEWER_MAX_SCALE = 1.5;
const VIEWER_MAX_DEVICE_PIXEL_RATIO = 2;
const VIEWER_GUTTER = 16;
const FILMSTRIP_WINDOW_SIZE = 12;
const FILMSTRIP_OVERSCAN = 3;
const FILMSTRIP_ITEM_EXTENT = 64;
const VIEWER_RESIZE_DEBOUNCE_MS = 80;

interface Props {
  pages: PageState[];
  navigationPageIds: string[];
  activePageId: string | null;
  runtime: PDFRuntime;
  onActivePageChange: (pageId: string) => void;
  onClose: () => void;
  onContentChange?: (file: File, pageNumber?: number) => void;
}

export default function EditorPageViewer(props: Props) {
  const [renderState, setRenderState] = createSignal<"loading" | "ready" | "error">("loading");
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal(false);
  const [selection, setSelection] = createSignal(false);
  const [zoom, setZoom] = createSignal(1);
  const [displayRotation, setDisplayRotation] = createSignal(0);
  const [frameSize, setFrameSize] = createSignal({ width: 0, height: 0 });
  const [viewport, setViewport] = createSignal<{ height: number; top: number }>();
  let frame!: HTMLDivElement;
  let pinchDistance = 0,
    pinchZoom = 1;
  let pinchAnchor = { x: 0.5, y: 0.5 };
  const [editBusy, setEditBusy] = createSignal(false);
  const [filmstripWindowStart, setFilmstripWindowStart] = createSignal(0);

  let pane!: HTMLElement;
  let closeButton!: HTMLButtonElement;
  let stage!: HTMLDivElement;
  let filmstrip!: HTMLElement;
  let canvas!: HTMLCanvasElement;
  let mounted = false;
  let disposed = false;
  let renderQueued = false;
  let renderLoopRunning = false;
  let renderFiber: Fiber.Fiber<unknown, unknown> | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let resizeTimer: number | null = null;
  let reviewBackgrounds: HTMLElement[] = [];

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

    return {
      pages: pages.slice(start, end),
      before: start * FILMSTRIP_ITEM_EXTENT,
      after: (pages.length - end) * FILMSTRIP_ITEM_EXTENT,
    };
  });

  function updateFilmstripWindow(): void {
    if (!filmstrip) return;

    const requestedStart =
      Math.floor(filmstrip.scrollLeft / FILMSTRIP_ITEM_EXTENT) - FILMSTRIP_OVERSCAN;
    const maxStart = Math.max(0, navigationPages().length - FILMSTRIP_WINDOW_SIZE);
    setFilmstripWindowStart(Math.min(Math.max(0, requestedStart), maxStart));
  }

  function filmstripSpacerStyle(size: number): string {
    if (size === 0) return "display: none";
    return `width: ${size}px; height: 1px`;
  }

  function interruptRender(): void {
    const fiber = renderFiber;
    if (!fiber) return;
    void Effect.runPromise(Fiber.interrupt(fiber)).catch(() => undefined);
  }

  function canUpdateRenderState(): boolean {
    return !disposed && canvas.isConnected;
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
    const compact = window.innerWidth <= 700 || window.matchMedia?.("(pointer: coarse)")?.matches;
    const pixelBudget = compact ? VIEWER_MOBILE_MAX_PIXELS : VIEWER_MAX_PIXELS;
    // Leave room for PDFium's integer pixel rounding at the native allocation limit.
    const pixelSafeRenderScale = Math.min(
      Math.sqrt(pixelBudget / (pageWidth * pageHeight)) * 0.999,
      32767 / Math.max(pageWidth, pageHeight)
    );
    const fitScale =
      stage.clientWidth === 0 || stage.clientHeight === 0
        ? VIEWER_MAX_SCALE
        : compact
          ? Math.max(stage.clientWidth - VIEWER_GUTTER * 2, 1) / pageWidth
          : Math.min(
              Math.max(stage.clientWidth - VIEWER_GUTTER * 2, 1) / pageWidth,
              Math.max(stage.clientHeight - VIEWER_GUTTER * 2 - (editing() ? 100 : 0), 1) /
                pageHeight
            );
    const cssScale = Math.min(VIEWER_MAX_SCALE, fitScale) * zoom();

    return {
      cssScale,
      renderScale: Math.min(cssScale * devicePixelRatio, pixelSafeRenderScale),
    };
  }

  async function renderLoop(): Promise<void> {
    if (renderLoopRunning) return;
    renderLoopRunning = true;

    try {
      while (renderQueued && !disposed) {
        renderQueued = false;
        const page = currentPage();

        if (!page) {
          setRenderState("loading");
          continue;
        }

        setRenderState("loading");

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
                setDisplayRotation(rotation);
                const pageSize = yield* service.getPageSize(
                  page.sourceFile,
                  page.sourcePageNumber,
                  rotation
                );
                const { cssScale, renderScale } = getViewerScale(pageSize.width, pageSize.height);
                setFrameSize({
                  width: (pageSize.width * cssScale) / zoom(),
                  height: (pageSize.height * cssScale) / zoom(),
                });
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
          if (canUpdateRenderState()) setRenderState("error");
          continue;
        }

        renderFiber = fiber;
        try {
          await props.runtime.runPromise(Fiber.join(fiber));
          if (canUpdateRenderState()) setRenderState("ready");
        } catch {
          // Navigation and resizing interrupt the current render on purpose. The queued
          // request will render the latest page or fit when this fiber settles.
          if (canUpdateRenderState() && !renderQueued) setRenderState("error");
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

  function requestResizeRender(): void {
    if (disposed || !mounted) return;
    if (resizeTimer !== null) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      resizeTimer = null;
      requestRender();
    }, VIEWER_RESIZE_DEBOUNCE_MS);
  }

  function selectPage(pageId: string): void {
    if (editBusy() || draft()) return;
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
      if (editBusy() || draft()) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      props.onClose();
      return;
    }

    if (event.key === "Tab") {
      const focusable = Array.from(
        pane.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex='-1'])"
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

    if (
      event.target instanceof HTMLElement &&
      event.target.closest("input, textarea, select, [contenteditable]")
    )
      return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      moveBy(event.key === "ArrowLeft" ? -1 : 1);
    }
  }

  createEffect(() => {
    const page = currentPage();
    const rotation = page?.rotation;
    void page?.contentRevision;
    if (page && page.id !== props.activePageId) {
      props.onActivePageChange(page.id);
    }
    void rotation;
    editing();
    if (mounted) requestRender();
  });

  createEffect(() => {
    zoom();
    if (mounted) requestResizeRender();
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
      filmstrip.scrollLeft = nextStart * FILMSTRIP_ITEM_EXTENT;
    });
  });

  function startPinch(event: TouchEvent): void {
    if (event.touches.length !== 2) return;
    event.preventDefault();
    const [first, second] = Array.from(event.touches);
    pinchDistance = Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
    pinchZoom = zoom();
    const rect = frame.getBoundingClientRect();
    pinchAnchor = {
      x: ((first.clientX + second.clientX) / 2 - rect.left) / rect.width,
      y: ((first.clientY + second.clientY) / 2 - rect.top) / rect.height,
    };
  }
  function movePinch(event: TouchEvent): void {
    if (event.touches.length !== 2 || !pinchDistance) return;
    event.preventDefault();
    const [first, second] = Array.from(event.touches);
    const distance = Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
    setZoom(Math.max(1, Math.min(4, (pinchZoom * distance) / pinchDistance)));
    const rect = stage.getBoundingClientRect();
    stage.scrollLeft =
      frame.offsetLeft +
      frame.clientWidth * pinchAnchor.x -
      ((first.clientX + second.clientX) / 2 - rect.left);
    stage.scrollTop =
      frame.offsetTop +
      frame.clientHeight * pinchAnchor.y -
      ((first.clientY + second.clientY) / 2 - rect.top);
  }
  function endPinch(): void {
    pinchDistance = 0;
  }

  onMount(() => {
    mounted = true;
    // Overlay controls are portaled into the page. Native listeners follow the physical
    // DOM path, whereas Solid delegated events follow the portal's ownership tree.
    stage.addEventListener("touchstart", startPinch, { passive: false });
    stage.addEventListener("touchmove", movePinch, { passive: false });
    stage.addEventListener("touchend", endPinch);
    stage.addEventListener("touchcancel", endPinch);
    reviewBackgrounds = Array.from(
      (pane.closest(".editor-app") ?? pane.parentElement)?.querySelectorAll<HTMLElement>(
        ".editor-header, .editor-workspace-main"
      ) ?? []
    );
    for (const background of reviewBackgrounds) background.setAttribute("inert", "");
    window.addEventListener("resize", requestResizeRender);
    const updateViewport = () => {
      const v = window.visualViewport;
      if (v) setViewport({ height: v.height, top: v.offsetTop });
    };
    updateViewport();
    window.visualViewport?.addEventListener("resize", updateViewport);
    window.visualViewport?.addEventListener("scroll", updateViewport);
    onCleanup(() => {
      window.visualViewport?.removeEventListener("resize", updateViewport);
      window.visualViewport?.removeEventListener("scroll", updateViewport);
    });
    queueMicrotask(() => closeButton?.focus());
    requestRender();

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(requestResizeRender);
      resizeObserver.observe(stage);
    }
  });

  onCleanup(() => {
    disposed = true;
    stage.removeEventListener("touchstart", startPinch);
    stage.removeEventListener("touchmove", movePinch);
    stage.removeEventListener("touchend", endPinch);
    stage.removeEventListener("touchcancel", endPinch);
    renderQueued = false;
    if (resizeTimer !== null) {
      window.clearTimeout(resizeTimer);
      resizeTimer = null;
    }
    resizeObserver?.disconnect();
    resizeObserver = null;
    window.removeEventListener("resize", requestResizeRender);
    for (const background of reviewBackgrounds) background.removeAttribute("inert");
    reviewBackgrounds = [];
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
      classList={{ "is-editing": editing() }}
      style={
        viewport()
          ? { height: `${viewport()?.height}px`, top: `${viewport()?.top}px`, bottom: "auto" }
          : undefined
      }
      role="dialog"
      aria-modal="true"
      aria-labelledby="editor-review-title"
      onKeyDown={handleKeyDown}
    >
      <header class="editor-review-header">
        <div class="editor-review-heading">
          <h2 id="editor-review-title" data-testid="editor-viewer-title">
            Page {currentWorkspaceIndex() + 1}
          </h2>
          <span class="editor-review-position" aria-live="polite">
            {currentNavigationIndex() + 1} of {navigationPages().length}
          </span>
        </div>
        <Show when={props.onContentChange}>
          <button
            type="button"
            class="editor-review-edit"
            aria-pressed={editing()}
            disabled={editBusy() || draft()}
            onClick={() => setEditing(!editing())}
          >
            {editing() ? "Done" : "Edit page"}
          </button>
        </Show>
        <button
          ref={closeButton}
          type="button"
          data-testid="editor-page-viewer-close-button"
          class="editor-review-close"
          aria-label="Close page review"
          disabled={editBusy() || draft()}
          onClick={props.onClose}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="m5 5 10 10M15 5 5 15" />
          </svg>
        </button>
      </header>

      <div
        class="editor-review-body"
        classList={{ "has-tools": editing(), "has-selection": selection() }}
      >
        <fieldset class="editor-review-zoom" aria-label="Page zoom">
          <button
            type="button"
            aria-label="Zoom out"
            disabled={zoom() <= 1}
            onClick={() => setZoom(Math.max(1, zoom() / 1.4))}
          >
            −
          </button>
          <button
            type="button"
            aria-label="Fit page"
            onClick={() => {
              setZoom(1);
              stage.scrollTo?.({ top: 0, left: 0 });
            }}
          >
            Fit
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            disabled={zoom() >= 4}
            onClick={() => setZoom(Math.min(4, zoom() * 1.4))}
          >
            +
          </button>
        </fieldset>
        <div
          ref={stage}
          class="editor-review-stage"
          data-render-state={renderState()}
          aria-busy={renderState() === "loading"}
        >
          <div
            ref={frame}
            class="editor-review-page"
            style={{
              width: `${frameSize().width * zoom()}px`,
              height: `${frameSize().height * zoom()}px`,
            }}
          >
            <canvas
              ref={canvas}
              class="editor-review-canvas"
              role="img"
              aria-label={`Preview of page ${currentWorkspaceIndex() + 1}`}
            >
              Page preview.
            </canvas>
          </div>
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
                Retry
              </button>
            </div>
          </Show>
        </div>

        <Show when={editing() && currentPage() && props.onContentChange}>
          <EditorContentPanel
            page={currentPage() as PageState}
            runtime={props.runtime}
            onChange={(file, pageNumber) => props.onContentChange?.(file, pageNumber)}
            onBusy={setEditBusy}
            onDraft={setDraft}
            onSelection={setSelection}
            overlayRoot={frame}
            rotation={displayRotation()}
          />
        </Show>
      </div>
      <footer class="editor-review-bottom">
        <button
          type="button"
          data-testid="editor-page-viewer-previous"
          class="editor-review-nav"
          aria-label="Previous page"
          disabled={editBusy() || draft() || currentNavigationIndex() <= 0}
          onClick={() => moveBy(-1)}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="m12.5 4-6 6 6 6" />
          </svg>
        </button>
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
        <button
          type="button"
          data-testid="editor-page-viewer-next"
          class="editor-review-nav"
          aria-label="Next page"
          disabled={
            editBusy() || draft() || currentNavigationIndex() >= navigationPages().length - 1
          }
          onClick={() => moveBy(1)}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="m7.5 4 6 6-6 6" />
          </svg>
        </button>
      </footer>
    </aside>
  );
}
