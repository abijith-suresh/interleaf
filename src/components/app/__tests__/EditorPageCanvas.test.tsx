import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THUMBNAIL_SCALE } from "@/constants";
import { makePDFRuntime, type PDFRuntime } from "@/services/pdf-runtime";
import type { PageState } from "@/types/interfaces";

const pdfServiceMocks = vi.hoisted(() => ({
  getPageRotation: vi.fn(),
  renderPage: vi.fn(),
  reset: vi.fn(),
}));

const pdfOperationsMocks = vi.hoisted(() => ({
  clearCache: vi.fn(),
}));

vi.mock("@/services/pdf-service", () => ({
  PDFService: class {
    getPageRotation = pdfServiceMocks.getPageRotation;
    renderPage = pdfServiceMocks.renderPage;
    reset = pdfServiceMocks.reset;
  },
}));
vi.mock("@/services/pdf-operations-service", () => ({
  PDFOperationsService: class {
    clearCache = pdfOperationsMocks.clearCache;
  },
}));

import EditorPageCanvas from "../EditorPageCanvas";

class TestIntersectionObserver {
  static instances: TestIntersectionObserver[] = [];

  private readonly callback: IntersectionObserverCallback;
  private target!: Element;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    TestIntersectionObserver.instances.push(this);
  }

  observe = vi.fn((target: Element) => {
    this.target = target;
  });

  disconnect = vi.fn();

  trigger(isIntersecting = true) {
    this.callback(
      [{ isIntersecting, target: this.target } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    );
  }
}

const makePage = (): PageState => ({
  id: "page-1",
  sourceFile: new File(["%PDF-1.4"], "document.pdf", { type: "application/pdf" }),
  sourcePageNumber: 1,
  rotation: 90,
  markedForDeletion: false,
});

describe("EditorPageCanvas", () => {
  let runtime: PDFRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    pdfServiceMocks.getPageRotation.mockReturnValue(Effect.succeed(0));
    pdfServiceMocks.renderPage.mockReturnValue(Effect.succeed(undefined));
    pdfServiceMocks.reset.mockReturnValue(Effect.succeed(undefined));
    pdfOperationsMocks.clearCache.mockReturnValue(Effect.succeed(undefined));
    runtime = makePDFRuntime();
    TestIntersectionObserver.instances = [];
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
  });

  afterEach(async () => {
    await runtime.dispose();
    vi.unstubAllGlobals();
  });

  it("keeps rendering lazy and offers an accessible retry after a failure", async () => {
    pdfServiceMocks.getPageRotation.mockReturnValue(Effect.succeed(90));
    pdfServiceMocks.renderPage
      .mockReturnValueOnce(Effect.fail(new Error("thumbnail failed")))
      .mockImplementationOnce((_file, _pageNumber, canvas: HTMLCanvasElement) =>
        Effect.sync(() => {
          canvas.width = 612;
          canvas.height = 792;
        })
      );

    const scrollRoot = document.createElement("div");
    const { getByTestId, queryByTestId } = render(() => (
      <EditorPageCanvas page={makePage()} rotation={90} scrollRoot={scrollRoot} runtime={runtime} />
    ));

    expect(pdfServiceMocks.renderPage).not.toHaveBeenCalled();
    expect(TestIntersectionObserver.instances).toHaveLength(1);

    TestIntersectionObserver.instances[0].trigger();

    const canvasFrame = getByTestId("editor-page-canvas");
    await waitFor(() => expect(canvasFrame).toHaveAttribute("data-render-state", "error"));

    expect(getByTestId("editor-page-canvas-error")).toHaveTextContent("Preview unavailable.");
    expect(getByTestId("editor-page-canvas-error")).toHaveAttribute("role", "status");
    expect(getByTestId("editor-page-canvas-error")).toHaveAttribute("aria-live", "polite");
    expect(getByTestId("editor-page-canvas-retry")).toHaveAccessibleName("Retry page preview");
    expect(canvasFrame).toHaveStyle({ "--frame-ratio": "0.75", "--page-rotation": "90deg" });

    fireEvent.click(getByTestId("editor-page-canvas-retry"));

    await waitFor(() => expect(TestIntersectionObserver.instances).toHaveLength(2));
    expect(canvasFrame).toHaveAttribute("data-render-state", "loading");

    TestIntersectionObserver.instances[1].trigger();

    await waitFor(() => expect(canvasFrame).toHaveAttribute("data-render-state", "ready"));
    expect(queryByTestId("editor-page-canvas-error")).not.toBeInTheDocument();
    expect(pdfServiceMocks.renderPage).toHaveBeenCalledTimes(2);
    expect(pdfServiceMocks.renderPage).toHaveBeenNthCalledWith(
      1,
      expect.any(File),
      1,
      expect.any(HTMLCanvasElement),
      THUMBNAIL_SCALE,
      90
    );
    expect(pdfServiceMocks.renderPage).toHaveBeenNthCalledWith(
      2,
      expect.any(File),
      1,
      expect.any(HTMLCanvasElement),
      THUMBNAIL_SCALE,
      90
    );
    expect(pdfServiceMocks.getPageRotation).toHaveBeenCalledTimes(2);
  });
});
