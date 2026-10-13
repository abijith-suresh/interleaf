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
  getPageContent: vi.fn(),
  editPage: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("@/services/pdf-service", () => ({
  PDFService: class {
    preload = () => Effect.void;
    getPageRotation = pdfServiceMocks.getPageRotation;
    getPageSize = pdfServiceMocks.getPageSize;
    renderPage = pdfServiceMocks.renderPage;
    getPageContent = pdfServiceMocks.getPageContent;
    editPage = pdfServiceMocks.editPage;
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

  it("keeps page management in Pages while Document exposes reading controls", async () => {
    render(() => (
      <EditorPageViewer
        pages={makePages()}
        navigationPageIds={["page-1", "page-2", "page-3"]}
        activePageId="page-1"
        runtime={runtime}
        onActivePageChange={vi.fn()}
        onClose={vi.fn()}
        tool="read"
        onContentChange={vi.fn()}
      />
    ));
    expect(screen.getByRole("button", { name: "Document" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(
      screen.queryByRole("button", { name: /Rotate page|Duplicate|Delete|Mark.*deletion/ })
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Tap the page to place text.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  });

  it("fits the entire page inside the stage after accounting for its actual padding", async () => {
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
    const stage = document.querySelector<HTMLElement>(".editor-review-stage")!;
    stage.style.padding = "44px 24px 24px";
    Object.defineProperties(stage, {
      clientWidth: { value: 180, configurable: true },
      clientHeight: { value: 200, configurable: true },
    });
    fireEvent(window, new Event("resize"));
    const frame = document.querySelector<HTMLElement>(".editor-review-page")!;
    await waitFor(() => expect(frame.style.height).toBe("132px"));
    expect(Number.parseFloat(frame.style.height) + 44 + 24).toBeLessThanOrEqual(stage.clientHeight);
    expect(Number.parseFloat(frame.style.width) + 24 + 24).toBeLessThanOrEqual(stage.clientWidth);
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
    expect(await screen.findAllByRole("button", { name: /Go to page/ })).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Page 2" })).toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: "Go to page 2" })).toHaveAttribute(
      "aria-current",
      "page"
    );

    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Page 1" })).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole("button", { name: "Go to page 3" }));
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
    expect(await screen.findAllByRole("button", { name: /Go to page/ })).toHaveLength(2);

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

    await waitFor(() => expect(pdfServiceMocks.renderPage).toHaveBeenCalledTimes(1));
    pdfServiceMocks.renderPage.mockClear();
    setPages(0, "rotation", 90);

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
      expect(canvas.parentElement?.style.width).toBe("150px");
      expect(canvas.parentElement?.style.height).toBe("300px");
    }
  );

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

  it.each(["Cancel edit", "Replace text"])(
    "restores the page view after closing a focused text composer with %s",
    async (action) => {
      vi.stubGlobal("innerWidth", 390);
      vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
        this: HTMLElement
      ) {
        return this.classList.contains("editor-review-stage")
          ? 300
          : Number.parseFloat(this.style.width) || 0;
      });
      vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
        this: HTMLElement
      ) {
        return this.classList.contains("editor-review-stage")
          ? 500
          : Number.parseFloat(this.style.height) || 0;
      });
      pdfServiceMocks.getPageContent.mockReturnValue(
        Effect.succeed({
          width: 100,
          height: 200,
          fields: [],
          text: [
            {
              index: 0,
              text: "Original",
              fontSize: 12,
              editable: true,
              bounds: { x: 10, y: 20, width: 20, height: 6 },
            },
          ],
        })
      );
      pdfServiceMocks.editPage.mockReturnValue(Effect.void);
      const onClose = vi.fn();
      render(() => (
        <EditorPageViewer
          pages={makePages()}
          navigationPageIds={["page-1"]}
          activePageId="page-1"
          runtime={runtime}
          onActivePageChange={vi.fn()}
          onClose={onClose}
          tool="replace"
          onContentChange={vi.fn()}
        />
      ));
      const target = await screen.findByRole("button", { name: "Edit Original" });
      const frame = document.querySelector(".editor-review-page") as HTMLElement;
      const stage = document.querySelector(".editor-review-stage") as HTMLElement;
      await waitFor(() => expect(Number.parseFloat(frame.style.width)).toBeGreaterThan(0));
      const previousWidth = frame.style.width;
      stage.scrollLeft = 20;
      stage.scrollTop = 40;
      stage.scrollTo = vi.fn((options?: ScrollToOptions | number) => {
        if (typeof options === "object") {
          stage.scrollLeft = options.left ?? 0;
          stage.scrollTop = options.top ?? 0;
        }
      });
      fireEvent.click(target);
      const input = screen.getByLabelText("Text");
      await waitFor(() => expect(input).toHaveFocus());
      expect(Number.parseFloat(frame.style.width)).toBeGreaterThan(
        Number.parseFloat(previousWidth)
      );
      fireEvent.input(input, { target: { value: "Changed" } });
      stage.scrollLeft = 70;
      stage.scrollTop = 120;
      fireEvent.click(screen.getByRole("button", { name: action }));
      await waitFor(() => expect(screen.queryByLabelText("Text")).not.toBeInTheDocument());
      await waitFor(() => expect(frame.style.width).toBe(previousWidth));
      await waitFor(() => expect([stage.scrollLeft, stage.scrollTop]).toEqual([20, 40]));
      expect(screen.getByRole("button", { name: "Edit Original" })).toBeEnabled();
      expect(pdfServiceMocks.editPage).toHaveBeenCalledTimes(action === "Replace text" ? 1 : 0);
      await waitFor(() => expect(frame).toHaveFocus());
      fireEvent.keyDown(frame, { key: "Escape" });
      expect(onClose).toHaveBeenCalledOnce();
    }
  );

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

    const next = screen.getByRole("button", { name: "Zoom in" });
    const close = screen.getByRole("button", { name: "Back to pages" });
    next.focus();
    fireEvent.keyDown(viewer, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(viewer, { key: "Tab", shiftKey: true });
    expect(next).toHaveFocus();
  });
  it("keeps large mobile zoom previews within the pixel memory budget", async () => {
    vi.stubGlobal("innerWidth", 390);
    vi.stubGlobal("devicePixelRatio", 2);
    pdfServiceMocks.getPageSize.mockReturnValue(Effect.succeed({ width: 2000, height: 3000 }));
    pdfServiceMocks.renderPage.mockImplementation(
      (_file: File, _page: number, canvas: HTMLCanvasElement, scale: number) =>
        Effect.sync(() => {
          canvas.width = Math.ceil(2000 * scale);
          canvas.height = Math.ceil(3000 * scale);
        })
    );
    render(() => (
      <EditorPageViewer
        pages={makePages()}
        navigationPageIds={["page-1"]}
        activePageId="page-1"
        runtime={runtime}
        onActivePageChange={vi.fn()}
        onClose={vi.fn()}
      />
    ));
    await waitFor(() => expect(pdfServiceMocks.renderPage).toHaveBeenCalled());
    const canvas = screen.getByRole("img") as HTMLCanvasElement;
    const previousWidth = canvas.parentElement?.style.width;
    for (let step = 0; step < 5; step++)
      fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Zoom in" })).toBeDisabled());
    await waitFor(() => expect(pdfServiceMocks.renderPage).toHaveBeenCalledTimes(2));
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(4_000_000);
    expect(canvas.parentElement?.style.width).not.toBe(previousWidth);
  });
});
