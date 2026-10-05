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
      expect(canvas.style.width).toBe("150px");
      expect(canvas.style.height).toBe("300px");
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
    const close = screen.getByRole("button", { name: "Close page review" });
    next.focus();
    fireEvent.keyDown(viewer, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(viewer, { key: "Tab", shiftKey: true });
    expect(next).toHaveFocus();
  });
});
