import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THUMBNAIL_SCALE } from "@/constants";
import type { PageState } from "@/types/interfaces";

const pdfServiceMocks = vi.hoisted(() => ({
  renderPage: vi.fn(),
}));

vi.mock("@/services/pdf-service", () => ({ pdfService: pdfServiceMocks }));

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
  beforeEach(() => {
    vi.clearAllMocks();
    TestIntersectionObserver.instances = [];
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps rendering lazy and offers an accessible retry after a failure", async () => {
    pdfServiceMocks.renderPage
      .mockRejectedValueOnce(new Error("thumbnail failed"))
      .mockImplementationOnce(async (_file, _pageNumber, canvas: HTMLCanvasElement) => {
        canvas.width = 612;
        canvas.height = 792;
      });

    const scrollRoot = document.createElement("div");
    const { getByTestId, queryByTestId } = render(() => (
      <EditorPageCanvas page={makePage()} rotation={90} scrollRoot={scrollRoot} />
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
      0
    );
    expect(pdfServiceMocks.renderPage).toHaveBeenNthCalledWith(
      2,
      expect.any(File),
      1,
      expect.any(HTMLCanvasElement),
      THUMBNAIL_SCALE,
      0
    );
  });
});
