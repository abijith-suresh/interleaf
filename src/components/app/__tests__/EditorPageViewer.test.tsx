import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { Effect } from "effect";
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

const pdfOperationsMocks = vi.hoisted(() => ({
  clearCache: vi.fn(),
}));

vi.mock("@/services/pdf-service", () => ({
  PDFService: class {
    getPageRotation = pdfServiceMocks.getPageRotation;
    getPageSize = pdfServiceMocks.getPageSize;
    renderPage = pdfServiceMocks.renderPage;
    reset = pdfServiceMocks.reset;
  },
}));
vi.mock("@/services/pdf-operations-service", () => ({
  PDFOperationsService: class {
    clearCache = pdfOperationsMocks.clearCache;
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
    vi.clearAllMocks();
    pdfServiceMocks.getPageRotation.mockReturnValue(Effect.succeed(0));
    pdfServiceMocks.getPageSize.mockReturnValue(Effect.succeed({ width: 100, height: 200 }));
    pdfServiceMocks.renderPage.mockImplementation(
      (_file: File, _pageNumber: number, canvas: HTMLCanvasElement) =>
        Effect.sync(() => {
          canvas.width = 100;
          canvas.height = 200;
        })
    );
    pdfServiceMocks.reset.mockReturnValue(Effect.succeed(undefined));
    pdfOperationsMocks.clearCache.mockReturnValue(Effect.succeed(undefined));
    runtime = makePDFRuntime();
  });

  afterEach(async () => {
    await runtime.dispose();
    vi.restoreAllMocks();
  });

  it("reviews every page with stable previous and next controls", async () => {
    const pages = makePages();
    const [activePageId, setActivePageId] = createSignal("page-1");
    const onActivePageChange = vi.fn((pageId: string) => {
      setActivePageId(pageId);
    });

    const { getByTestId, findAllByRole } = render(() => (
      <EditorPageViewer
        pages={pages}
        navigationPageIds={pages.map((page) => page.id)}
        activePageId={activePageId()}
        runtime={runtime}
        onActivePageChange={onActivePageChange}
        onClose={vi.fn()}
      />
    ));

    await waitFor(() => expect(getByTestId("editor-page-viewer")).toBeInTheDocument());
    expect(getByTestId("editor-viewer-title")).toHaveTextContent("Page 1");
    expect(getByTestId("editor-page-viewer-previous")).toBeDisabled();
    expect(getByTestId("editor-page-viewer-next")).toBeEnabled();
    expect(await findAllByRole("button", { name: /Review page/ })).toHaveLength(3);

    fireEvent.click(getByTestId("editor-page-viewer-next"));
    await waitFor(() => expect(onActivePageChange).toHaveBeenCalledWith("page-2"));

    fireEvent.click(getByTestId("editor-page-viewer-previous"));
    await waitFor(() => expect(onActivePageChange).toHaveBeenLastCalledWith("page-1"));
  });

  it("limits navigation to the selected review scope and closes from Escape", async () => {
    const pages = makePages();
    const onClose = vi.fn();

    const { getByTestId, findAllByRole } = render(() => (
      <EditorPageViewer
        pages={pages}
        navigationPageIds={["page-1", "page-3"]}
        activePageId="page-3"
        runtime={runtime}
        onActivePageChange={vi.fn()}
        onClose={onClose}
      />
    ));

    await waitFor(() => expect(getByTestId("editor-viewer-title")).toHaveTextContent("Page 3"));
    expect(getByTestId("editor-page-viewer-next")).toBeDisabled();
    expect(getByTestId("editor-page-viewer-previous")).toBeEnabled();
    expect(await findAllByRole("button", { name: /Review page/ })).toHaveLength(2);

    fireEvent.keyDown(getByTestId("editor-page-viewer"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("rerenders the active page when its organizer rotation changes", async () => {
    const [pages, setPages] = createStore(makePages());

    const { getByTestId } = render(() => (
      <EditorPageViewer
        pages={pages}
        navigationPageIds={pages.map((page) => page.id)}
        activePageId="page-1"
        runtime={runtime}
        onActivePageChange={vi.fn()}
        onClose={vi.fn()}
      />
    ));

    await waitFor(() => expect(getByTestId("editor-page-viewer")).toBeInTheDocument());
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

  it("contains keyboard focus when it becomes a mobile review dialog", async () => {
    const mediaQuery = {
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList;
    vi.spyOn(window, "matchMedia").mockReturnValue(mediaQuery);
    const pages = makePages();

    const { getByTestId } = render(() => (
      <div class="editor-workspace">
        <section class="editor-workspace-main">
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

    const viewer = getByTestId("editor-page-viewer");
    await waitFor(() => expect(viewer).toHaveAttribute("role", "dialog"));
    expect(viewer).toHaveAttribute("aria-modal", "true");
    expect(document.querySelector(".editor-workspace-main")).toHaveAttribute("inert");

    const next = getByTestId("editor-page-viewer-next");
    const close = getByTestId("editor-page-viewer-close-button");
    next.focus();
    fireEvent.keyDown(viewer, { key: "Tab" });
    expect(document.activeElement).toBe(close);
  });
});
