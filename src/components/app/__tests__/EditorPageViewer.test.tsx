import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { Deferred, Effect } from "effect";
import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makePDFRuntime, type PDFRuntime } from "@/services/pdf-runtime";
import type { PageState } from "@/types/interfaces";

const pdfServiceMocks = vi.hoisted(() => ({
  getPageRotation: vi.fn(),
  getPageSize: vi.fn(),
  renderPage: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("@/services/pdf-service", () => ({
  PDFService: class {
    getPageRotation = pdfServiceMocks.getPageRotation;
    getPageSize = pdfServiceMocks.getPageSize;
    renderPage = pdfServiceMocks.renderPage;
    reset = pdfServiceMocks.reset;
    dispose = () => Effect.void;
  },
}));

import EditorPageViewer from "../EditorPageViewer";

const makePages = (): PageState[] => {
  const file = new File(["%PDF-1.4"], "document.pdf", { type: "application/pdf" });
  return [1, 2, 3].map((sourcePageNumber) => ({
    id: `page-${sourcePageNumber}`,
    sourceFile: file,
    sourcePageNumber,
    rotation: 0,
    markedForDeletion: false,
  }));
};

describe("EditorPageViewer", () => {
  let runtime: PDFRuntime;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    pdfServiceMocks.getPageRotation.mockReturnValue(Effect.succeed(0));
    pdfServiceMocks.getPageSize.mockReturnValue(Effect.succeed({ width: 100, height: 200 }));
    pdfServiceMocks.renderPage.mockImplementation(
      (_file: File, _pageNumber: number, canvas: HTMLCanvasElement, scale = 1) =>
        Effect.sync(() => {
          canvas.width = 100 * scale;
          canvas.height = 200 * scale;
        })
    );
    pdfServiceMocks.reset.mockReturnValue(Effect.succeed(undefined));
    runtime = makePDFRuntime();
  });

  afterEach(async () => {
    await runtime.dispose();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("reviews every page with stable previous and next controls", async () => {
    const pages = makePages();
    const [activePageId, setActivePageId] = createSignal("page-1");
    const onActivePageChange = vi.fn((pageId: string) => {
      setActivePageId(pageId);
    });

    render(() => (
      <EditorPageViewer
        pages={pages}
        navigationPageIds={pages.map((page) => page.id)}
        activePageId={activePageId()}
        runtime={runtime}
        onActivePageChange={onActivePageChange}
        onClose={vi.fn()}
      />
    ));

    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: /Page \d/ })).toHaveTextContent("Page 1");
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next page" })).toBeEnabled();
    expect(await screen.findAllByRole("button", { name: /Review page/ })).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Page 2" })).toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: "Review page 2" })).toHaveAttribute(
      "aria-current",
      "page"
    );

    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Page 1" })).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole("button", { name: "Review page 3" }));
    expect(screen.getByRole("heading", { name: "Page 3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("waits for render cancellation, skips superseded pages, and stops on unmount", async () => {
    const pages = makePages();
    const [activePageId, setActivePageId] = createSignal("page-1");
    const releaseCleanup = Deferred.makeUnsafe<void>();
    const cancelFirst = vi.fn(() => Deferred.await(releaseCleanup));
    const cancelLatest = vi.fn(() => Effect.void);
    pdfServiceMocks.renderPage.mockImplementation((_file: File, pageNumber: number) =>
      Effect.never.pipe(Effect.onInterrupt(pageNumber === 1 ? cancelFirst : cancelLatest))
    );
    const view = render(() => (
      <EditorPageViewer
        pages={pages}
        navigationPageIds={pages.map((page) => page.id)}
        activePageId={activePageId()}
        runtime={runtime}
        onActivePageChange={setActivePageId}
        onClose={vi.fn()}
      />
    ));

    try {
      await waitFor(() => expect(pdfServiceMocks.renderPage).toHaveBeenCalledTimes(1));
      fireEvent.click(screen.getByRole("button", { name: "Next page" }));
      fireEvent.click(screen.getByRole("button", { name: "Next page" }));
      await waitFor(() => expect(cancelFirst).toHaveBeenCalledTimes(1));
      expect(pdfServiceMocks.renderPage).toHaveBeenCalledTimes(1);
      await Effect.runPromise(Deferred.succeed(releaseCleanup, undefined));
      await waitFor(() => expect(pdfServiceMocks.renderPage).toHaveBeenCalledTimes(2));
      expect(pdfServiceMocks.renderPage.mock.calls.map((call) => call[1])).toEqual([1, 3]);
      view.unmount();
      await waitFor(() => expect(cancelLatest).toHaveBeenCalledTimes(1));
    } finally {
      await Effect.runPromise(Deferred.succeed(releaseCleanup, undefined));
      view.unmount();
    }
  });

  it("limits navigation to the selected review scope and closes from Escape", async () => {
    const pages = makePages();
    const onClose = vi.fn();

    render(() => (
      <EditorPageViewer
        pages={pages}
        navigationPageIds={["page-1", "page-3"]}
        activePageId="page-3"
        runtime={runtime}
        onActivePageChange={vi.fn()}
        onClose={onClose}
      />
    ));

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /Page \d/ })).toHaveTextContent("Page 3")
    );
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeEnabled();
    expect(await screen.findAllByRole("button", { name: /Review page/ })).toHaveLength(2);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("rerenders the active page when its organizer rotation changes", async () => {
    const [pages, setPages] = createStore(makePages());

    render(() => (
      <EditorPageViewer
        pages={pages}
        navigationPageIds={pages.map((page) => page.id)}
        activePageId="page-1"
        runtime={runtime}
        onActivePageChange={vi.fn()}
        onClose={vi.fn()}
      />
    ));

    const stage = screen.getByRole("region", { name: "Page preview, use arrow keys to pan" });
    await waitFor(() => expect(stage).toHaveAttribute("data-render-state", "ready"));
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await waitFor(() => expect(pdfServiceMocks.renderPage).toHaveBeenCalledTimes(2));
    pdfServiceMocks.renderPage.mockClear();
    setPages(0, "rotation", 90);
    expect(stage).toHaveAttribute("data-zoom", "1");

    await waitFor(() =>
      expect(pdfServiceMocks.renderPage).toHaveBeenCalledWith(
        expect.any(File),
        1,
        expect.any(HTMLCanvasElement),
        expect.any(Number),
        90
      )
    );
  });

  it.each([
    { pixelRatio: 1, pixelWidth: 150, pixelHeight: 300 },
    { pixelRatio: 2, pixelWidth: 300, pixelHeight: 600 },
    { pixelRatio: 4, pixelWidth: 300, pixelHeight: 600 },
  ])(
    "renders at pixel ratio $pixelRatio with a cap and stable display size",
    async ({ pixelRatio, pixelWidth, pixelHeight }) => {
      vi.stubGlobal("devicePixelRatio", pixelRatio);
      const pages = makePages();
      render(() => (
        <EditorPageViewer
          pages={pages}
          navigationPageIds={pages.map((page) => page.id)}
          activePageId="page-1"
          runtime={runtime}
          onActivePageChange={vi.fn()}
          onClose={vi.fn()}
        />
      ));
      const canvas = screen.getByRole<HTMLCanvasElement>("img", { name: "Preview of page 1" });

      await waitFor(() => expect([canvas.width, canvas.height]).toEqual([pixelWidth, pixelHeight]));
      expect(canvas.style.width).toBe("150px");
      expect(canvas.style.height).toBe("300px");
    }
  );

  it.each([
    {
      name: "asymmetric computed padding",
      stage: [500, 400],
      padding: "10px 30px 20px 40px",
      size: [1000, 1000],
      display: [370, 370],
    },
    {
      name: "a wide page in a small viewport",
      stage: [390, 220],
      padding: "12px",
      size: [12000, 600],
      display: [366, 18.3],
    },
    {
      name: "a tall page in a short landscape viewport",
      stage: [667, 180],
      padding: "12px",
      size: [600, 12000],
      display: [7.8, 156],
    },
    {
      name: "a huge page at desktop DPR 2",
      stage: [2864, 2864],
      padding: "32px",
      size: [20000, 20000],
      display: [2800, 2800],
      pixelRatio: 2,
      bitmapSide: 4000,
    },
    {
      name: "a huge page with a coarse pointer at DPR 2",
      stage: [2864, 2864],
      padding: "32px",
      size: [20000, 20000],
      display: [2800, 2800],
      coarse: true,
      pixelRatio: 2,
      bitmapSide: 2000,
    },
    {
      name: "the mobile budget with a fine pointer",
      stage: [2864, 2864],
      padding: "32px",
      size: [20000, 20000],
      display: [2800, 2800],
      viewportWidth: 700,
      pixelRatio: 2,
      bitmapSide: 2000,
    },
    {
      name: "the maximum display scale for a small page",
      stage: [1000, 1000],
      padding: "12px",
      size: [100, 200],
      display: [150, 300],
    },
  ])("fits $name independently of bitmap resolution", async (scenario) => {
    vi.stubGlobal("devicePixelRatio", scenario.pixelRatio ?? 1);
    vi.stubGlobal("innerWidth", scenario.viewportWidth ?? 1200);
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: scenario.coarse ?? false }))
    );
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(scenario.stage[0]);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(scenario.stage[1]);
    const getStyle = window.getComputedStyle;
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      if (element.classList.contains("editor-review-stage")) {
        (element as HTMLElement).style.padding = scenario.padding;
      }
      return getStyle(element);
    });
    pdfServiceMocks.getPageSize.mockReturnValue(
      Effect.succeed({ width: scenario.size[0], height: scenario.size[1] })
    );
    const pages = makePages();
    render(() => (
      <EditorPageViewer
        pages={pages}
        navigationPageIds={pages.map((page) => page.id)}
        activePageId="page-1"
        runtime={runtime}
        onActivePageChange={vi.fn()}
        onClose={vi.fn()}
      />
    ));
    await waitFor(() => expect(pdfServiceMocks.renderPage).toHaveBeenCalledTimes(1));
    const canvas = screen.getByRole<HTMLCanvasElement>("img", { name: "Preview of page 1" });
    expect(Number.parseFloat(canvas.style.width)).toBeCloseTo(scenario.display[0]);
    expect(Number.parseFloat(canvas.style.height)).toBeCloseTo(scenario.display[1]);
    const scale = pdfServiceMocks.renderPage.mock.calls[0][3];
    if (scenario.bitmapSide) {
      expect(scenario.size[0] * scale).toBeCloseTo(scenario.bitmapSide);
      expect(scenario.size[1] * scale).toBeCloseTo(scenario.bitmapSide);
    } else {
      expect(scale).toBeCloseTo(scenario.display[0] / scenario.size[0]);
    }
  });

  it.each([
    { sourceRotation: 90, workspaceRotation: 0, rotation: 90, display: [352, 176] },
    { sourceRotation: 90, workspaceRotation: 90, rotation: 180, display: [88, 176] },
    { sourceRotation: 270, workspaceRotation: 180, rotation: 90, display: [352, 176] },
  ])("fits combined rotation $rotation", async (scenario) => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(667);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(200);
    const getStyle = window.getComputedStyle;
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      (element as HTMLElement).style.padding = "12px";
      return getStyle(element);
    });
    pdfServiceMocks.getPageRotation.mockReturnValue(Effect.succeed(scenario.sourceRotation));
    pdfServiceMocks.getPageSize.mockImplementation((_file, _pageNumber, rotation) =>
      Effect.succeed(
        rotation % 180 === 0 ? { width: 600, height: 1200 } : { width: 1200, height: 600 }
      )
    );
    const pages = makePages();
    pages[0].rotation = scenario.workspaceRotation;
    render(() => (
      <EditorPageViewer
        pages={pages}
        navigationPageIds={pages.map((page) => page.id)}
        activePageId="page-1"
        runtime={runtime}
        onActivePageChange={vi.fn()}
        onClose={vi.fn()}
      />
    ));
    await waitFor(() => expect(pdfServiceMocks.renderPage).toHaveBeenCalledTimes(1));
    const canvas = screen.getByRole<HTMLCanvasElement>("img", { name: "Preview of page 1" });
    expect(Number.parseFloat(canvas.style.width)).toBeCloseTo(scenario.display[0]);
    expect(Number.parseFloat(canvas.style.height)).toBeCloseTo(scenario.display[1]);
    expect(pdfServiceMocks.renderPage.mock.calls[0][4]).toBe(scenario.rotation);
  });

  it("debounces rerenders while the viewer is resizing", async () => {
    const pages = makePages();
    render(() => (
      <EditorPageViewer
        pages={pages}
        navigationPageIds={pages.map((page) => page.id)}
        activePageId="page-1"
        runtime={runtime}
        onActivePageChange={vi.fn()}
        onClose={vi.fn()}
      />
    ));

    await waitFor(() => expect(pdfServiceMocks.renderPage).toHaveBeenCalledTimes(1));
    pdfServiceMocks.renderPage.mockClear();
    vi.stubGlobal("devicePixelRatio", 2);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    try {
      fireEvent(window, new Event("resize"));
      fireEvent(window, new Event("resize"));
      expect(pdfServiceMocks.renderPage).not.toHaveBeenCalled();

      vi.advanceTimersByTime(40);
      fireEvent(window, new Event("resize"));
      vi.advanceTimersByTime(40);
      expect(pdfServiceMocks.renderPage).not.toHaveBeenCalled();
      vi.advanceTimersByTime(40);
      await vi.waitFor(() => expect(pdfServiceMocks.renderPage).toHaveBeenCalledTimes(1));
      const canvas = screen.getByRole<HTMLCanvasElement>("img", { name: "Preview of page 1" });
      expect([canvas.width, canvas.height]).toEqual([300, 600]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for PDF.js cancellation before resizing the canvas to the latest fit", async () => {
    let stageWidth = 800;
    let stageHeight = 600;
    vi.stubGlobal("devicePixelRatio", 1);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => stageWidth);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => stageHeight);
    const releaseCleanup = Deferred.makeUnsafe<void>();
    const cancel = vi.fn(() => Deferred.await(releaseCleanup));
    pdfServiceMocks.renderPage.mockImplementationOnce(
      (_file, _pageNumber, canvas: HTMLCanvasElement) =>
        Effect.sync(() => {
          canvas.width = 150;
          canvas.height = 300;
        }).pipe(Effect.andThen(Effect.never), Effect.onInterrupt(cancel))
    );
    const pages = makePages();
    const view = render(() => (
      <EditorPageViewer
        pages={pages}
        navigationPageIds={pages.map((page) => page.id)}
        activePageId="page-1"
        runtime={runtime}
        onActivePageChange={vi.fn()}
        onClose={vi.fn()}
      />
    ));
    try {
      const canvas = screen.getByRole<HTMLCanvasElement>("img", { name: "Preview of page 1" });
      await waitFor(() => expect(pdfServiceMocks.renderPage).toHaveBeenCalledTimes(1));
      const staging = pdfServiceMocks.renderPage.mock.calls[0][2] as HTMLCanvasElement;
      expect(staging.width).toBe(150);
      const setWidth = vi.spyOn(staging, "width", "set");
      const setHeight = vi.spyOn(staging, "height", "set");
      stageWidth = 100;
      stageHeight = 120;
      fireEvent(window, new Event("resize"));
      await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
      expect(setWidth).not.toHaveBeenCalled();
      expect(setHeight).not.toHaveBeenCalled();
      expect(pdfServiceMocks.renderPage).toHaveBeenCalledTimes(1);
      await Effect.runPromise(Deferred.succeed(releaseCleanup, undefined));
      await waitFor(() => expect([canvas.width, canvas.height]).toEqual([60, 120]));
      expect(canvas.style.width).toBe("60px");
      expect(canvas.style.height).toBe("120px");
    } finally {
      await Effect.runPromise(Deferred.succeed(releaseCleanup, undefined));
      view.unmount();
    }
  });

  it("contains keyboard focus while the review dialog is open", async () => {
    const pages = makePages();
    let background!: HTMLElement;

    render(() => (
      <div class="editor-workspace">
        <section ref={background} class="editor-workspace-main">
          <button type="button">Organizer</button>
        </section>
        <EditorPageViewer
          pages={pages}
          navigationPageIds={pages.map((page) => page.id)}
          activePageId="page-1"
          runtime={runtime}
          onActivePageChange={vi.fn()}
          onClose={vi.fn()}
        />
      </div>
    ));

    const viewer = screen.getByRole("dialog");
    await waitFor(() => expect(viewer).toBeInTheDocument());
    expect(viewer).toHaveAttribute("role", "dialog");
    expect(viewer).toHaveAttribute("aria-modal", "true");
    expect(background).toHaveAttribute("inert");

    const next = screen.getByRole("button", { name: "Next page" });
    const first = screen.getByRole("button", { name: "Fit page" });
    next.focus();
    fireEvent.keyDown(viewer, { key: "Tab" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(viewer, { key: "Tab", shiftKey: true });
    expect(next).toHaveFocus();
  });
  it("reuses the visible frame throughout a pinch, coalesces sharpening, and clears cancelled drags", async () => {
    const pages = makePages();
    render(() => (
      <EditorPageViewer
        pages={pages}
        navigationPageIds={pages.map((p) => p.id)}
        activePageId="page-1"
        runtime={runtime}
        onActivePageChange={vi.fn()}
        onClose={vi.fn()}
      />
    ));
    const canvas = screen.getByRole<HTMLCanvasElement>("img", { name: "Preview of page 1" });
    const stage = screen.getByRole<HTMLElement>("region", {
      name: "Page preview, use arrow keys to pan",
    });
    await waitFor(() => expect(stage).toHaveAttribute("data-render-state", "ready"));
    const bitmap = [canvas.width, canvas.height];
    const staging = pdfServiceMocks.renderPage.mock.calls[0][2] as HTMLCanvasElement;
    expect(staging).not.toBe(canvas);
    expect([staging.width, staging.height]).toEqual([0, 0]);
    const pointer = (type: string, id: number, x: number, y: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(
        event,
        Object.fromEntries(
          Object.entries({
            pointerId: id,
            clientX: x,
            clientY: y,
            button: 0,
            pointerType: "touch",
          }).map(([key, value]) => [key, { value }])
        )
      );
      fireEvent(stage, event);
    };
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    pointer("pointerdown", 1, 100, 100);
    pointer("pointerdown", 2, 200, 100);
    pointer("pointermove", 2, 300, 100);
    expect(stage).toHaveAttribute("data-zoom", "2");
    expect(canvas.style.width).toBe("300px");
    expect([canvas.width, canvas.height]).toEqual(bitmap);
    vi.advanceTimersByTime(1000);
    expect(pdfServiceMocks.renderPage).toHaveBeenCalledTimes(1);
    pointer("pointermove", 2, 500, 100);
    expect(stage).toHaveAttribute("data-zoom", "4");
    expect(stage).toHaveFocus();
    pointer("pointercancel", 2, 500, 100);
    expect(stage).not.toHaveClass("is-panning");
    const scroll = stage.scrollLeft;
    pointer("pointermove", 1, 20, 100);
    expect(stage.scrollLeft).toBe(scroll);
    vi.advanceTimersByTime(80);
    await vi.waitFor(() => expect(pdfServiceMocks.renderPage).toHaveBeenCalledTimes(2));
    expect(pdfServiceMocks.renderPage.mock.calls[1][3]).toBe(6);
    await vi.waitFor(() => expect([staging.width, staging.height]).toEqual([0, 0]));
    fireEvent.click(screen.getByRole("button", { name: "Fit page" }));
    expect(stage).toHaveAttribute("data-zoom", "1");
    expect(stage.scrollLeft).toBe(0);
    expect(stage.scrollTop).toBe(0);
    expect(canvas.style.width).toBe("150px");
  });

  it("keeps each zoomed bitmap within its budget and releases staging only after unmount cancellation settles", async () => {
    vi.stubGlobal("innerWidth", 390);
    vi.stubGlobal("devicePixelRatio", 2);
    pdfServiceMocks.getPageSize.mockReturnValue(Effect.succeed({ width: 20000, height: 20000 }));
    pdfServiceMocks.renderPage.mockImplementation((_file, _number, canvas, scale) =>
      Effect.sync(() => {
        canvas.width = Math.floor(20000 * scale);
        canvas.height = Math.floor(20000 * scale);
      })
    );
    const pages = makePages();
    const view = render(() => (
      <EditorPageViewer
        pages={pages}
        navigationPageIds={pages.map((p) => p.id)}
        activePageId="page-1"
        runtime={runtime}
        onActivePageChange={vi.fn()}
        onClose={vi.fn()}
      />
    ));
    const canvas = screen.getByRole<HTMLCanvasElement>("img", { name: "Preview of page 1" });
    const stage = screen.getByRole("region", { name: "Page preview, use arrow keys to pan" });
    await waitFor(() => expect(stage).toHaveAttribute("data-render-state", "ready"));
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(4_000_000);
    const release = Deferred.makeUnsafe<void>();
    const cancelled = vi.fn(() => Deferred.await(release));
    pdfServiceMocks.renderPage.mockImplementation((_file, _number, target, scale) =>
      Effect.sync(() => {
        target.width = Math.floor(20000 * scale);
        target.height = Math.floor(20000 * scale);
      }).pipe(Effect.andThen(Effect.never), Effect.onInterrupt(cancelled))
    );
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await waitFor(() => expect(pdfServiceMocks.renderPage).toHaveBeenCalledTimes(2));
    const staging = pdfServiceMocks.renderPage.mock.calls[1][2] as HTMLCanvasElement;
    expect(staging.width * staging.height).toBeLessThanOrEqual(4_000_000);
    const width = vi.spyOn(staging, "width", "set");
    const height = vi.spyOn(staging, "height", "set");
    try {
      view.unmount();
      await waitFor(() => expect(cancelled).toHaveBeenCalledTimes(1));
      expect(width).not.toHaveBeenCalled();
      expect(height).not.toHaveBeenCalled();
      expect([canvas.width, canvas.height]).toEqual([0, 0]);
    } finally {
      await Effect.runPromise(Deferred.succeed(release, undefined));
    }
    await waitFor(() => expect([staging.width, staging.height]).toEqual([0, 0]));
  });
  it("does not publish a superseded sharper frame while page cancellation is settling", async () => {
    const pages = makePages();
    const [activePageId, setActivePageId] = createSignal("page-1");
    const view = render(() => (
      <EditorPageViewer
        pages={pages}
        navigationPageIds={pages.map((p) => p.id)}
        activePageId={activePageId()}
        runtime={runtime}
        onActivePageChange={setActivePageId}
        onClose={vi.fn()}
      />
    ));
    const canvas = screen.getByRole<HTMLCanvasElement>("img", { name: "Preview of page 1" });
    const stage = screen.getByRole("region", { name: "Page preview, use arrow keys to pan" });
    await waitFor(() => expect(stage).toHaveAttribute("data-render-state", "ready"));
    const release = Deferred.makeUnsafe<void>();
    const cancelled = vi.fn(() => Deferred.await(release));
    pdfServiceMocks.renderPage.mockImplementationOnce((_file, _number, target) =>
      Effect.sync(() => {
        target.width = 600;
        target.height = 1200;
      }).pipe(Effect.andThen(Effect.never), Effect.onInterrupt(cancelled))
    );
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await waitFor(() => expect(pdfServiceMocks.renderPage).toHaveBeenCalledTimes(2));
    const staging = pdfServiceMocks.renderPage.mock.calls[1][2] as HTMLCanvasElement;
    const width = vi.spyOn(staging, "width", "set");
    const publish = vi.spyOn(canvas, "width", "set");
    try {
      fireEvent.click(screen.getByRole("button", { name: "Next page" }));
      fireEvent.click(screen.getByRole("button", { name: "Next page" }));
      await waitFor(() => expect(cancelled).toHaveBeenCalledTimes(1));
      expect(width).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
      expect(stage).toHaveAttribute("data-zoom", "1");
      expect(pdfServiceMocks.renderPage).toHaveBeenCalledTimes(2);
      await Effect.runPromise(Deferred.succeed(release, undefined));
      await waitFor(() => expect(stage).toHaveAttribute("data-render-state", "ready"));
      expect(pdfServiceMocks.renderPage.mock.calls.map((call) => call[1])).toEqual([1, 1, 3]);
      expect([canvas.width, canvas.height]).toEqual([150, 300]);
      expect(screen.getByRole("heading", { name: "Page 3" })).toBeInTheDocument();
    } finally {
      await Effect.runPromise(Deferred.succeed(release, undefined));
      view.unmount();
    }
  });
  it("ignores unchanged observer bounds without resetting zoom or requesting another bitmap", async () => {
    let notify: ResizeObserverCallback = () => {};
    let width = 500;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () => new DOMRect(0, 0, width, 400)
    );
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          notify = callback;
        }
        observe() {}
        disconnect() {}
      }
    );
    const pages = makePages();
    render(() => (
      <EditorPageViewer
        pages={pages}
        navigationPageIds={pages.map((p) => p.id)}
        activePageId="page-1"
        runtime={runtime}
        onActivePageChange={vi.fn()}
        onClose={vi.fn()}
      />
    ));
    const stage = screen.getByRole("region", { name: "Page preview, use arrow keys to pan" });
    await waitFor(() => expect(stage).toHaveAttribute("data-render-state", "ready"));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    notify([], {} as ResizeObserver);
    vi.advanceTimersByTime(80);
    expect(pdfServiceMocks.renderPage).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    vi.advanceTimersByTime(80);
    await vi.waitFor(() => expect(pdfServiceMocks.renderPage).toHaveBeenCalledTimes(2));
    notify([], {} as ResizeObserver);
    expect(stage).toHaveAttribute("data-zoom", "1.4");
    vi.advanceTimersByTime(80);
    expect(pdfServiceMocks.renderPage).toHaveBeenCalledTimes(2);
    width = 600;
    notify([], {} as ResizeObserver);
    expect(stage).toHaveAttribute("data-zoom", "1");
    vi.advanceTimersByTime(80);
    await vi.waitFor(() => expect(pdfServiceMocks.renderPage).toHaveBeenCalledTimes(3));
  });
  it("keeps staging owned by the renderer during simultaneous unmount and runtime disposal", async () => {
    const release = Deferred.makeUnsafe<void>();
    const cancelled = vi.fn(() => Deferred.await(release));
    const completionObservers = vi.spyOn(runtime, "runPromise");
    pdfServiceMocks.renderPage.mockImplementation((_file, _number, target) =>
      Effect.sync(() => {
        target.width = 600;
        target.height = 1200;
      }).pipe(Effect.andThen(Effect.never), Effect.onInterrupt(cancelled))
    );
    const pages = makePages();
    const view = render(() => (
      <EditorPageViewer
        pages={pages}
        navigationPageIds={pages.map((p) => p.id)}
        activePageId="page-1"
        runtime={runtime}
        onActivePageChange={vi.fn()}
        onClose={vi.fn()}
      />
    ));
    await waitFor(() => expect(pdfServiceMocks.renderPage).toHaveBeenCalledTimes(1));
    const staging = pdfServiceMocks.renderPage.mock.calls[0][2] as HTMLCanvasElement;
    const width = vi.spyOn(staging, "width", "set");
    const height = vi.spyOn(staging, "height", "set");
    view.unmount();
    const disposal = runtime.dispose();
    try {
      await waitFor(() => expect(cancelled).toHaveBeenCalledTimes(1));
      // Disposal can settle managed completion observers before the rendering
      // fiber's gated cancellation finalizer. Drain those observers explicitly.
      await Promise.allSettled(completionObservers.mock.results.map((result) => result.value));
      expect(width).not.toHaveBeenCalled();
      expect(height).not.toHaveBeenCalled();
      expect([staging.width, staging.height]).toEqual([600, 1200]);
    } finally {
      await Effect.runPromise(Deferred.succeed(release, undefined));
      await disposal;
    }
    await waitFor(() => expect([staging.width, staging.height]).toEqual([0, 0]));
  });

  it.each(["Zoom in", "Zoom out"])(
    "hands focused %s to Fit at its limit and preserves Escape",
    async (action) => {
      const pages = makePages();
      const onClose = vi.fn();
      render(() => (
        <EditorPageViewer
          pages={pages}
          navigationPageIds={pages.map((p) => p.id)}
          activePageId="page-1"
          runtime={runtime}
          onActivePageChange={vi.fn()}
          onClose={onClose}
        />
      ));
      const stage = screen.getByRole("region", { name: "Page preview, use arrow keys to pan" });
      await waitFor(() => expect(stage).toHaveAttribute("data-render-state", "ready"));
      const zoomIn = screen.getByRole("button", { name: "Zoom in" });
      if (action === "Zoom out") fireEvent.click(zoomIn);
      const button = screen.getByRole("button", { name: action });
      button.focus();
      for (let i = 0; i < (action === "Zoom in" ? 5 : 1); i++) fireEvent.click(button);
      expect(button).toBeDisabled();
      const fit = screen.getByRole("button", { name: "Fit page" });
      expect(fit).toHaveFocus();
      fireEvent.keyDown(fit, { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
    }
  );

  it("does not steal preview or unrelated action focus when zoom reaches a limit", async () => {
    const pages = makePages();
    render(() => (
      <EditorPageViewer
        pages={pages}
        navigationPageIds={pages.map((p) => p.id)}
        activePageId="page-1"
        runtime={runtime}
        onActivePageChange={vi.fn()}
        onClose={vi.fn()}
      />
    ));
    const stage = screen.getByRole("region", { name: "Page preview, use arrow keys to pan" });
    await waitFor(() => expect(stage).toHaveAttribute("data-render-state", "ready"));
    stage.focus();
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(stage).toHaveFocus();
    const close = screen.getByRole("button", { name: "Close page review" });
    close.focus();
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(close).toHaveFocus();
  });

  it.each(["pointerup", "pointercancel", "lostpointercapture"])(
    "avoids rendering for pure pan on %s while retaining pending zoom, resize and page work",
    async (endEvent) => {
      const pages = makePages();
      const [active, setActive] = createSignal("page-1");
      render(() => (
        <EditorPageViewer
          pages={pages}
          navigationPageIds={pages.map((p) => p.id)}
          activePageId={active()}
          runtime={runtime}
          onActivePageChange={setActive}
          onClose={vi.fn()}
        />
      ));
      const stage = screen.getByRole("region", { name: "Page preview, use arrow keys to pan" });
      await waitFor(() => expect(stage).toHaveAttribute("data-render-state", "ready"));
      const pointer = (type: string, x = 100, y = 100) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperties(
          event,
          Object.fromEntries(
            Object.entries({
              pointerId: 1,
              pointerType: "touch",
              button: 0,
              clientX: x,
              clientY: y,
            }).map(([key, value]) => [key, { value }])
          )
        );
        fireEvent(stage, event);
      };
      const ready = async (count: number) => {
        vi.advanceTimersByTime(80);
        await vi.waitFor(() => {
          expect(pdfServiceMocks.renderPage).toHaveBeenCalledTimes(count);
          expect(stage).toHaveAttribute("data-render-state", "ready");
        });
      };
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
      await ready(2);
      pointer("pointerdown");
      pointer("pointermove", 60, 50);
      pointer(endEvent);
      vi.advanceTimersByTime(1000);
      expect(pdfServiceMocks.renderPage).toHaveBeenCalledTimes(2);

      // A button zoom has not sharpened yet. A pan cancels its timer, but must
      // retain the pending work and render it once on release/cancel/capture loss.
      fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
      pointer("pointerdown");
      pointer("pointermove", 60, 50);
      vi.advanceTimersByTime(1000);
      expect(pdfServiceMocks.renderPage).toHaveBeenCalledTimes(2);
      pointer(endEvent);
      await ready(3);
      expect(pdfServiceMocks.renderPage.mock.calls[2][3]).toBeCloseTo(1.5 * 1.4 * 1.4);

      fireEvent(window, new Event("resize"));
      pointer("pointerdown");
      vi.advanceTimersByTime(1000);
      expect(pdfServiceMocks.renderPage).toHaveBeenCalledTimes(3);
      pointer(endEvent);
      await ready(4);
      expect(stage).toHaveAttribute("data-zoom", "1");
      pointer("pointerdown");
      setActive("page-2");
      await vi.waitFor(() => expect(stage).toHaveAttribute("data-render-state", "ready"));
      expect(pdfServiceMocks.renderPage).toHaveBeenCalledTimes(5);
      expect(pdfServiceMocks.renderPage.mock.calls[4][1]).toBe(2);
      expect(stage).not.toHaveClass("is-panning");
      pointer(endEvent);
      vi.advanceTimersByTime(1000);
      expect(pdfServiceMocks.renderPage).toHaveBeenCalledTimes(5);
    }
  );
});
