import { Effect, Fiber } from "effect";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { PDFProcessing, type PDFRuntime } from "../../services/pdf-runtime";
import type { PageState } from "../../types/interfaces";
import EditorContentPanel from "./EditorContentPanel";
import EditorPageCanvas from "./EditorPageCanvas";
import EditorToolRail, { type EditorWorkspaceTool } from "./EditorToolRail";
import { boxStyle, type PageBox } from "./pdf-page-geometry";

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
  onActivePageChange: (pageId: string) => void;
  onClose: () => void;
  tool?: Exclude<EditorWorkspaceTool, "pages">;
  onChooseTool?: (tool: EditorWorkspaceTool) => void;
  onAddFiles?: () => void;
  onDownload?: () => void;
  downloadBusy?: boolean;
  downloadAvailable?: boolean;
  exportPageCount?: number;
  onContentChange?: (file: File, pageNumber?: number) => void;
}

export default function EditorPageViewer(props: Props) {
  const [renderState, setRenderState] = createSignal<"loading" | "ready" | "error">("loading");
  const editing = () => !!props.onContentChange;
  const [workspaceTool, setWorkspaceTool] = createSignal<Exclude<EditorWorkspaceTool, "pages">>(
    props.tool ?? "read"
  );
  createEffect(() => {
    if (props.tool) setWorkspaceTool(props.tool);
  });
  const [showPages, setShowPages] = createSignal(false);
  const [composerHeight, setComposerHeight] = createSignal(160);
  const [pageFit, setPageFit] = createSignal<"width" | "page">(
    props.onContentChange ? "width" : "page"
  );
  const [draft, setDraft] = createSignal(false);
  const [selection, setSelection] = createSignal(false);
  const [zoom, setZoom] = createSignal(1);
  const [displayRotation, setDisplayRotation] = createSignal(0);
  let pageDimensions: { width: number; height: number } | undefined;
  let previousView: { zoom: number; left: number; top: number } | undefined;
  const [frameSize, setFrameSize] = createSignal({ width: 0, height: 0 });
  const [viewport, setViewport] = createSignal<{ height: number; top: number }>();
  let frame!: HTMLElement;
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
        : pageFit() === "width"
          ? Math.max(stage.clientWidth - horizontalPadding, 1) / pageWidth
          : Math.min(
              Math.max(stage.clientWidth - horizontalPadding, 1) / pageWidth,
              Math.max(stage.clientHeight - verticalPadding, 1) / pageHeight
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
                pageDimensions = pageSize;
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
    if (pageDimensions) {
      const { cssScale } = getViewerScale(pageDimensions.width, pageDimensions.height);
      setFrameSize({
        width: (pageDimensions.width * cssScale) / zoom(),
        height: (pageDimensions.height * cssScale) / zoom(),
      });
    }
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
      ).filter((element) => {
        if (element.closest("[inert], [hidden]")) return false;
        for (
          let ancestor: HTMLElement | null = element;
          ancestor && ancestor !== pane;
          ancestor = ancestor.parentElement
        ) {
          const style = getComputedStyle(ancestor);
          if (style.display === "none" || style.visibility === "hidden") return false;
          if (
            ancestor instanceof HTMLDetailsElement &&
            !ancestor.open &&
            !ancestor.querySelector("summary")?.contains(element)
          )
            return false;
        }
        return true;
      });
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
    pageFit();
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

  function focusBounds(bounds: PageBox, width: number, height: number) {
    if (stage && !previousView)
      previousView = { zoom: zoom(), left: stage.scrollLeft, top: stage.scrollTop };
    if (window.innerWidth > 700 || !frame) return;
    const style = boxStyle(bounds, width, height, displayRotation());
    const w = (Number.parseFloat(style.width) / 100) * frame.clientWidth,
      h = (Number.parseFloat(style.height) / 100) * frame.clientHeight;
    if (w <= 0 || h <= 0) return;
    const factor = Math.min(
      (stage.clientWidth - 40) / w,
      (stage.clientHeight - 40) / h,
      24 / Math.min(w, h)
    );
    if (factor > 1.05) setZoom(Math.min(4, zoom() * factor));
  }

  function selectContent(next: boolean) {
    if (disposed) return;
    if (next && !previousView)
      previousView = { zoom: zoom(), left: stage.scrollLeft, top: stage.scrollTop };
    setSelection(next);
    if (!next && previousView) {
      const view = previousView;
      previousView = undefined;
      setZoom(view.zoom);
      requestAnimationFrame(() => {
        if (!disposed && !selection()) {
          stage.scrollTo?.({ top: view.top, left: view.left, behavior: "instant" });
          frame.focus({ preventScroll: true });
        }
      });
    }
  }

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
        ".editor-header, .editor-workspace-main, .editor-tool-rail"
      ) ?? []
    );
    reviewBackgrounds = reviewBackgrounds.filter((background) => !pane.contains(background));
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
    queueMicrotask(() => pane?.focus());
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
      classList={{
        "is-editing": editing(),
        "has-composer": selection(),
        "has-filmstrip": showPages(),
      }}
      style={
        viewport()
          ? { height: `${viewport()?.height}px`, top: `${viewport()?.top}px`, bottom: "auto" }
          : undefined
      }
      role="dialog"
      tabIndex={-1}
      aria-modal="true"
      aria-labelledby="editor-review-title"
      onKeyDown={handleKeyDown}
    >
      <Show when={props.onContentChange}>
        <EditorToolRail
          activeTool={workspaceTool()}
          busy={draft() || editBusy() || props.downloadBusy}
          onChooseTool={(tool) => {
            if (tool === "pages") props.onClose();
            else {
              setWorkspaceTool(tool);
              props.onChooseTool?.(tool);
            }
          }}
        />
      </Show>
      <header class="editor-review-header">
        <button
          ref={closeButton}
          type="button"
          data-testid="editor-page-viewer-close-button"
          class="editor-review-close"
          aria-label="Back to pages"
          disabled={editBusy() || draft() || props.downloadBusy}
          onClick={props.onClose}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="m12 4-6 6 6 6" />
          </svg>
          <span>Pages</span>
        </button>
        <div class="editor-review-heading">
          <span class="editor-review-source" title={currentPage()?.sourceFile.name}>
            {currentPage()?.sourceFile.name}
          </span>
          <h2
            id="editor-review-title"
            data-testid="editor-viewer-title"
            aria-label={`Page ${currentWorkspaceIndex() + 1}`}
          >
            Page {currentWorkspaceIndex() + 1}
            <span class="editor-review-position">
              {" "}
              · {currentNavigationIndex() + 1} of {navigationPages().length}
            </span>
          </h2>
        </div>
        <Show when={props.onAddFiles}>
          <button
            type="button"
            class="editor-review-add-files"
            aria-label="Add PDFs or images"
            title="Add files"
            disabled={editBusy() || draft() || props.downloadBusy}
            onClick={props.onAddFiles}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M10 4v12M4 10h12" />
            </svg>
          </button>
        </Show>
        <Show when={props.onDownload}>
          <button
            type="button"
            class="editor-review-download"
            disabled={
              editBusy() || draft() || props.downloadBusy || props.downloadAvailable === false
            }
            onClick={props.onDownload}
          >
            <span>{props.downloadBusy ? "Preparing…" : "Download PDF"}</span>
            <Show when={props.exportPageCount !== undefined}>
              <small>
                All {props.exportPageCount} {props.exportPageCount === 1 ? "page" : "pages"}
              </small>
            </Show>
          </button>
        </Show>
      </header>

      <Show when={currentPage()?.markedForDeletion}>
        <p class="editor-review-deleted-notice" role="status">
          This page is marked for deletion and excluded from downloads.
        </p>
      </Show>

      <div
        class="editor-review-body"
        classList={{ "has-selection": selection(), "has-tool": workspaceTool() !== "read" }}
        style={{ "--composer-height": `${composerHeight()}px` }}
      >
        <div
          ref={stage}
          class="editor-review-stage"
          data-render-state={renderState()}
          aria-busy={renderState() === "loading"}
        >
          <section
            ref={frame}
            class="editor-review-page"
            aria-label={`Page ${currentWorkspaceIndex() + 1}`}
            tabIndex={-1}
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
          </section>
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
            mode={workspaceTool()}
            locked={props.downloadBusy}
            onChooseTool={(tool) => {
              setWorkspaceTool(tool);
              props.onChooseTool?.(tool);
            }}
            onComposerHeight={setComposerHeight}
            onFocusBounds={focusBounds}
            onChange={(file, pageNumber) => props.onContentChange?.(file, pageNumber)}
            onBusy={setEditBusy}
            onDraft={setDraft}
            onSelection={selectContent}
            overlayRoot={frame}
            rotation={displayRotation()}
          />
        </Show>
      </div>
      <footer class="editor-review-bottom">
        <button
          type="button"
          class="editor-review-pages-toggle"
          aria-label="Show page thumbnails"
          aria-expanded={showPages()}
          onClick={() => setShowPages(!showPages())}
          disabled={draft() || editBusy()}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M3 3h5v6H3zM12 3h5v6h-5zM3 12h5v5H3zM12 12h5v5h-5z" />
          </svg>
        </button>
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
        <label class="editor-review-page-jump">
          <span class="sr-only">Go to page</span>
          <select
            aria-label="Go to page"
            value={currentPage()?.id ?? ""}
            disabled={draft() || editBusy() || props.downloadBusy}
            onChange={(event) => selectPage(event.currentTarget.value)}
          >
            <For each={navigationPages()}>
              {(page) => (
                <option value={page.id}>
                  {props.pages.findIndex((candidate) => candidate.id === page.id) + 1}
                </option>
              )}
            </For>
          </select>
        </label>
        <nav
          ref={filmstrip}
          class="editor-review-filmstrip"
          aria-label="Page thumbnails"
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
                  aria-label={`Go to page ${workspaceIndex() + 1}`}
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
              setPageFit(pageFit() === "page" ? "width" : "page");
              setZoom(1);
              stage.scrollTo?.({ top: 0, left: 0 });
            }}
          >
            {pageFit() === "page" ? "Width" : "Fit"}
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
      </footer>
    </aside>
  );
}
