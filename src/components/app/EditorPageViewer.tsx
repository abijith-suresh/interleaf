import { Effect, Fiber } from "effect";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  untrack,
} from "solid-js";
import { copyOrganizationPages } from "../../controllers/editor-history";
import { PDFProcessing, type PDFRuntime } from "../../services/pdf-runtime";
import type { AddedText, PageState } from "../../types/interfaces";
import EditorPageCanvas from "./EditorPageCanvas";
import EditorTextEditor, { type TextGesture } from "./EditorTextEditor";
import EditorButton from "./ui/EditorButton";

const VIEWER_MAX_PIXELS = 16_000_000;
const VIEWER_MOBILE_MAX_PIXELS = 4_000_000;
const VIEWER_MAX_SCALE = 1.5;
const VIEWER_MAX_DEVICE_PIXEL_RATIO = 2;
const FILMSTRIP_WINDOW_SIZE = 12;
const FILMSTRIP_OVERSCAN = 3;
const FILMSTRIP_ITEM_EXTENT = 64;
const VIEWER_RESIZE_DEBOUNCE_MS = 80;

interface Props {
  pages: PageState[];
  navigationPageIds: string[];
  activePageId: string | null;
  runtime: PDFRuntime;
  disabled?: boolean;
  onTextChange?: (pageId: string, texts: readonly AddedText[], label: string) => void;
  onActivePageChange: (pageId: string) => void;
}

export default function EditorPageViewer(props: Props) {
  const [renderState, setRenderState] = createSignal<"loading" | "ready" | "error">("loading");
  const [zoom, setZoom] = createSignal(1);
  const [panning, setPanning] = createSignal(false);
  const [hasFrame, setHasFrame] = createSignal(false);
  const [filmstripWindowStart, setFilmstripWindowStart] = createSignal(0);

  const [toolsMounted, setToolsMounted] = createSignal(false);
  const [editingTextId, setEditingTextId] = createSignal<string | null>(null);
  let textGesture: TextGesture | null = null;
  let pageTap: ((event: PointerEvent) => void) | null = null;
  let tapStart: { x: number; y: number; pointer: number } | null = null;
  let previousPageKey = "";
  let textHeader!: HTMLDivElement;
  let textToolbar!: HTMLDivElement;
  let fitButton!: HTMLButtonElement;
  let zoomInButton!: HTMLButtonElement;
  let zoomOutButton!: HTMLButtonElement;
  let stage!: HTMLElement;
  let filmstrip!: HTMLElement;
  let canvas!: HTMLCanvasElement;
  let frame!: HTMLDivElement;
  // PDF.js owns this canvas until its render and cancellation finalizers settle.
  // The visible canvas retains the last complete frame. Each has the same pixel cap.
  const staging = document.createElement("canvas");
  staging.width = staging.height = 0;
  let pageDimensions: { width: number; height: number } | null = null;
  const pointers = new Map<number, { x: number; y: number }>();
  let gesture: { distance: number; zoom: number; x: number; y: number } | null = null;
  let mounted = false;
  let disposed = false;
  let renderQueued = false;
  let renderLoopRunning = false;
  let renderFiber: Fiber.Fiber<unknown, unknown> | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let resizeTimer: number | null = null;
  let renderNeeded = false;

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
    pixelBudget: number;
  } {
    const devicePixelRatio = Math.min(
      Math.max(window.devicePixelRatio || 1, 1),
      VIEWER_MAX_DEVICE_PIXEL_RATIO
    );
    const compact = window.innerWidth <= 700 || window.matchMedia?.("(pointer: coarse)").matches;
    const pixelBudget = compact ? VIEWER_MOBILE_MAX_PIXELS : VIEWER_MAX_PIXELS;
    const pixelSafeRenderScale = Math.sqrt(pixelBudget / (pageWidth * pageHeight));
    const stageStyle = getComputedStyle(stage);
    const horizontalPadding =
      (Number.parseFloat(stageStyle.paddingLeft) || 0) +
      (Number.parseFloat(stageStyle.paddingRight) || 0);
    const verticalPadding =
      (Number.parseFloat(stageStyle.paddingTop) || 0) +
      (Number.parseFloat(stageStyle.paddingBottom) || 0);
    const fitScale =
      stage.clientWidth === 0 || stage.clientHeight === 0
        ? VIEWER_MAX_SCALE
        : Math.min(
            Math.max(stage.clientWidth - horizontalPadding, 1) / pageWidth,
            Math.max(stage.clientHeight - verticalPadding, 1) / pageHeight
          );
    const cssScale = Math.min(VIEWER_MAX_SCALE, fitScale) * untrack(zoom);

    return {
      cssScale,
      renderScale: Math.min(cssScale * devicePixelRatio, pixelSafeRenderScale),
      pixelBudget,
    };
  }

  function layoutPage(): void {
    if (!pageDimensions) return;
    const { width, height } = pageDimensions;
    const { cssScale } = getViewerScale(width, height);
    frame.style.width = canvas.style.width = `${width * cssScale}px`;
    frame.style.height = canvas.style.height = `${height * cssScale}px`;
  }

  function setViewZoom(value: number): void {
    const next = Math.max(1, Math.min(4, value));
    const focused = document.activeElement;
    // Move focus before disabling an action, otherwise browsers can send it to body.
    if ((next >= 4 && focused === zoomInButton) || (next <= 1 && focused === zoomOutButton)) {
      fitButton.focus({ preventScroll: true });
    }
    if (next !== untrack(zoom)) renderNeeded = true;
    setZoom(next);
  }

  function changeZoom(value: number, clientX?: number, clientY?: number): void {
    if (!pageDimensions) return;
    const stageRect = stage.getBoundingClientRect();
    const rect = frame.getBoundingClientRect();
    const x = clientX ?? stageRect.left + stage.clientWidth / 2;
    const y = clientY ?? stageRect.top + stage.clientHeight / 2;
    const anchorX = rect.width ? (x - rect.left) / rect.width : 0.5;
    const anchorY = rect.height ? (y - rect.top) / rect.height : 0.5;
    setViewZoom(value);
    layoutPage();
    const nextRect = frame.getBoundingClientRect();
    stage.scrollLeft += nextRect.left + nextRect.width * anchorX - x;
    stage.scrollTop += nextRect.top + nextRect.height * anchorY - y;
    if (untrack(zoom) === 1) stage.scrollLeft = stage.scrollTop = 0;
    if (!pointers.size && renderNeeded) requestResizeRender();
  }

  function resetView(): void {
    endGesture();
    setViewZoom(1);
    stage.scrollLeft = stage.scrollTop = 0;
    layoutPage();
  }

  function rebaseGesture(): void {
    const points = [...pointers.values()];
    const first = points[0];
    const second = points[1] ?? first;
    gesture = first
      ? {
          distance: Math.hypot(first.x - second.x, first.y - second.y),
          zoom: untrack(zoom),
          x: (first.x + second.x) / 2,
          y: (first.y + second.y) / 2,
        }
      : null;
    setPanning(pointers.size > 0);
  }

  function endGesture(): void {
    tapStart = null;
    textGesture?.cancel();
    const ids = [...pointers.keys()];
    pointers.clear();
    gesture = null;
    setPanning(false);
    for (const id of ids) {
      if (stage.hasPointerCapture?.(id)) stage.releasePointerCapture(id);
    }
  }

  function pointerDown(event: PointerEvent): void {
    if (
      event.button !== 0 ||
      !pageDimensions ||
      !untrack(hasFrame) ||
      (event.target instanceof Element &&
        event.target.closest("button, a") &&
        !event.target.closest(".editor-text-layer")) ||
      (event.pointerType !== "touch" && untrack(zoom) === 1 && !pageTap)
    )
      return;
    event.preventDefault();
    stage.focus({ preventScroll: true });
    if (pointers.size > 0) textGesture?.cancel();
    tapStart =
      pointers.size === 0 ? { x: event.clientX, y: event.clientY, pointer: event.pointerId } : null;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    stage.setPointerCapture?.(event.pointerId);
    if (resizeTimer !== null) window.clearTimeout(resizeTimer);
    resizeTimer = null;
    rebaseGesture();
  }

  function pointerMove(event: PointerEvent): void {
    if (!pointers.has(event.pointerId) || !gesture) return;
    if (tapStart && Math.hypot(event.clientX - tapStart.x, event.clientY - tapStart.y) > 5)
      tapStart = null;
    event.preventDefault();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1 && textGesture?.move(event)) {
      rebaseGesture();
      return;
    }
    const points = [...pointers.values()];
    const first = points[0];
    const second = points[1] ?? first;
    const x = (first.x + second.x) / 2;
    const y = (first.y + second.y) / 2;
    if (points.length >= 2 && gesture.distance > 0) {
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      changeZoom((gesture.zoom * distance) / gesture.distance, gesture.x, gesture.y);
    }
    stage.scrollLeft -= x - gesture.x;
    stage.scrollTop -= y - gesture.y;
    rebaseGesture();
  }

  function pointerEnd(event: PointerEvent): void {
    if (!pointers.delete(event.pointerId)) return;
    const tap = tapStart?.pointer === event.pointerId;
    tapStart = null;
    const dragged = textGesture?.end(event);
    if (tap && !dragged) pageTap?.(event);
    if (stage.hasPointerCapture?.(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    rebaseGesture();
    if (!pointers.size && renderNeeded) requestResizeRender();
  }

  function cancelGesture(): void {
    endGesture();
    if (renderNeeded) requestResizeRender();
  }

  async function renderLoop(): Promise<void> {
    if (renderLoopRunning) return;
    renderLoopRunning = true;

    try {
      while (renderQueued && !disposed) {
        renderQueued = false;
        const current = currentPage();
        const page = current ? copyOrganizationPages([current])[0] : null;
        const omittedTextId = editingTextId();

        if (!page) {
          setRenderState("loading");
          continue;
        }

        setRenderState("loading");
        staging.width = 0;
        staging.height = 0;

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
                pageDimensions = pageSize;
                layoutPage();
                const { renderScale, pixelBudget } = getViewerScale(
                  pageSize.width,
                  pageSize.height
                );
                if (page.addedText?.length) {
                  yield* service.renderPageState(
                    {
                      ...page,
                      addedText: page.addedText.filter((text) => text.id !== omittedTextId),
                    },
                    staging,
                    renderScale,
                    rotation,
                    pixelBudget
                  );
                } else
                  yield* service.renderPage(
                    page.sourceFile,
                    page.sourcePageNumber,
                    staging,
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
          // This completion observer must outlive managed-runtime disposal too.
          // Only the rendering fiber's settled exit permits staging reuse/release.
          await Effect.runPromise(Fiber.join(fiber));
          if (canUpdateRenderState() && !renderQueued) {
            canvas.width = canvas.height = 0;
            canvas.width = staging.width;
            canvas.height = staging.height;
            const context = canvas.getContext("2d");
            if (!context) throw new Error("Could not get preview canvas context");
            context.drawImage(staging, 0, 0);
            setHasFrame(true);
            setRenderState("ready");
          }
        } catch {
          // Navigation and resizing interrupt the current render on purpose. The queued
          // request will render the latest page or fit when this fiber settles.
          if (canUpdateRenderState() && !renderQueued) setRenderState("error");
        } finally {
          staging.width = staging.height = 0;
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
    renderNeeded = false;
    if (resizeTimer !== null) window.clearTimeout(resizeTimer);
    resizeTimer = null;
    renderQueued = true;
    interruptRender();
    if (!renderLoopRunning) void renderLoop();
  }

  function requestResizeRender(): void {
    if (disposed || !mounted) return;
    renderNeeded = true;
    if (resizeTimer !== null) window.clearTimeout(resizeTimer);
    if (pointers.size) return;
    resizeTimer = window.setTimeout(() => {
      resizeTimer = null;
      requestRender();
    }, VIEWER_RESIZE_DEBOUNCE_MS);
  }

  function handleResize(): void {
    resetView();
    requestResizeRender();
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
    if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select"))
      return;
    // Keep browser zoom and modified navigation shortcuts native.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (
      event.target === stage &&
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)
    ) {
      event.preventDefault();
      if (event.key === "Home") stage.scrollLeft = stage.scrollTop = 0;
      else if (event.key === "End") {
        stage.scrollLeft = stage.scrollWidth;
        stage.scrollTop = stage.scrollHeight;
      } else {
        stage.scrollLeft += event.key === "ArrowLeft" ? -60 : event.key === "ArrowRight" ? 60 : 0;
        stage.scrollTop += event.key === "ArrowUp" ? -60 : event.key === "ArrowDown" ? 60 : 0;
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
    const savedText = JSON.stringify(page?.addedText ?? []);
    const editing = editingTextId();
    void savedText;
    void editing;
    if (page && page.id !== props.activePageId) {
      props.onActivePageChange(page.id);
    }
    void rotation;
    navigationPages();
    if (mounted) {
      const key = `${page?.id}:${rotation}`;
      if (key !== previousPageKey) {
        resetView();
        pageDimensions = null;
        setHasFrame(false);
        previousPageKey = key;
      }
      if (document.activeElement === zoomInButton || document.activeElement === zoomOutButton) {
        fitButton.focus({ preventScroll: true });
      }
      requestRender();
    }
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

  onMount(() => {
    mounted = true;
    setToolsMounted(true);
    window.addEventListener("resize", handleResize);
    requestRender();

    if (typeof ResizeObserver !== "undefined") {
      let observedBounds = stage.getBoundingClientRect();
      resizeObserver = new ResizeObserver(() => {
        const bounds = stage.getBoundingClientRect();
        // Initial delivery and scrollbar changes need no new bitmap. Window resize
        // remains unconditional to account for DPR and same-size padding changes.
        if (bounds.width === observedBounds.width && bounds.height === observedBounds.height)
          return;
        observedBounds = bounds;
        handleResize();
      });
      resizeObserver.observe(stage);
    }
  });

  onCleanup(() => {
    disposed = true;
    renderQueued = false;
    endGesture();
    if (resizeTimer !== null) {
      window.clearTimeout(resizeTimer);
      resizeTimer = null;
    }
    resizeObserver?.disconnect();
    resizeObserver = null;
    window.removeEventListener("resize", handleResize);
    const fiber = renderFiber;
    if (fiber) {
      void Effect.runPromise(Fiber.interrupt(fiber)).catch(() => undefined);
    } else {
      staging.width = staging.height = 0;
    }
    canvas.width = 0;
    canvas.height = 0;
  });

  return (
    <section
      id="editor-document"
      data-testid="editor-page-viewer"
      class="editor-review-pane"
      aria-label="Document preview"
      onKeyDown={handleKeyDown}
    >
      <header class="editor-review-header">
        <div class="editor-review-heading">
          <h2 id="editor-review-title" data-testid="editor-viewer-title">
            Page {currentWorkspaceIndex() + 1}
          </h2>
          <span class="editor-review-position" aria-live="polite">
            {currentNavigationIndex() + 1} of {navigationPages().length}
            <Show when={currentPage()?.markedForDeletion}> · Marked for deletion</Show>
          </span>
        </div>
        <div ref={textHeader} class="editor-text-header-tools" />
        <fieldset class="editor-review-zoom" aria-label="Page zoom">
          <EditorButton
            ref={zoomOutButton}
            aria-label="Zoom out"
            title="Zoom out"
            icon="minus"
            disabled={!hasFrame() || zoom() <= 1}
            onClick={() => changeZoom(zoom() / 1.4)}
          />
          <EditorButton
            ref={fitButton}
            aria-label="Fit page"
            title="Fit page"
            onClick={() => {
              resetView();
              requestResizeRender();
            }}
          >
            Fit
          </EditorButton>
          <EditorButton
            ref={zoomInButton}
            aria-label="Zoom in"
            title="Zoom in"
            icon="plus"
            disabled={!hasFrame() || zoom() >= 4}
            onClick={() => changeZoom(zoom() * 1.4)}
          />
        </fieldset>
      </header>

      <section
        ref={stage}
        class="editor-review-stage"
        classList={{ "is-panning": panning(), "is-zoomed": zoom() > 1 }}
        data-zoom={zoom()}
        aria-label="Page preview, use arrow keys to pan"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: The scroll region supports keyboard panning.
        tabIndex={0}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerEnd}
        onPointerCancel={cancelGesture}
        onLostPointerCapture={(event) => {
          if (pointers.has(event.pointerId)) {
            cancelGesture();
          }
        }}
        data-render-state={renderState()}
        aria-busy={renderState() === "loading"}
      >
        <div ref={frame} class="editor-review-page" style={{ opacity: hasFrame() ? 1 : 0 }}>
          <canvas
            ref={canvas}
            width={0}
            height={0}
            class="editor-review-canvas"
            role="img"
            aria-label={`Preview of page ${currentWorkspaceIndex() + 1}`}
          >
            Page preview.
          </canvas>
          <Show when={toolsMounted() && props.onTextChange}>
            {(onChange) => (
              <Show when={currentPage()}>
                {(page) => (
                  <EditorTextEditor
                    page={page()}
                    runtime={props.runtime}
                    toolbar={textToolbar}
                    header={textHeader}
                    ready={hasFrame() && !props.disabled}
                    disabled={props.disabled}
                    onChange={onChange()}
                    onEditing={setEditingTextId}
                    registerGesture={(handler) => {
                      textGesture = handler;
                    }}
                    registerTap={(handler) => {
                      pageTap = handler;
                    }}
                  />
                )}
              </Show>
            )}
          </Show>
        </div>
        <Show when={renderState() === "loading" && !hasFrame()}>
          <p class="editor-review-state" role="status" aria-live="polite">
            Loading page…
          </p>
        </Show>
        <Show when={renderState() === "error"}>
          <div class="editor-review-state editor-review-error" role="alert">
            <span>Preview unavailable.</span>
            <EditorButton
              data-testid="editor-page-viewer-retry"
              class="editor-review-retry"
              onClick={retryRender}
            >
              Retry
            </EditorButton>
          </div>
        </Show>
      </section>

      <div ref={textToolbar} class="editor-document-tools" />
      <footer class="editor-review-bottom">
        <EditorButton
          data-testid="editor-page-viewer-previous"
          class="editor-review-nav"
          aria-label="Previous page"
          disabled={currentNavigationIndex() <= 0}
          onClick={() => moveBy(-1)}
          icon="previous"
        />
        <nav
          ref={filmstrip}
          class="editor-review-filmstrip"
          aria-label="Document pages"
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

              return (
                <button
                  type="button"
                  class="editor-review-filmstrip-item"
                  classList={{ "is-active": currentPage()?.id === page.id }}
                  aria-current={currentPage()?.id === page.id ? "page" : undefined}
                  aria-label={`View page ${workspaceIndex() + 1}`}
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
                  <span>{workspaceIndex() + 1}</span>
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
        <EditorButton
          data-testid="editor-page-viewer-next"
          class="editor-review-nav"
          aria-label="Next page"
          disabled={currentNavigationIndex() >= navigationPages().length - 1}
          onClick={() => moveBy(1)}
          icon="next"
        />
      </footer>
    </section>
  );
}
