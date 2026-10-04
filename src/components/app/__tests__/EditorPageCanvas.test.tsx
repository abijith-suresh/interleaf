import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
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

vi.mock("@/services/pdf-service", () => ({
  PDFService: class {
    getPageRotation = pdfServiceMocks.getPageRotation;
    renderPage = pdfServiceMocks.renderPage;
    reset = pdfServiceMocks.reset;
    dispose = () => Effect.void;
  },
}));

import EditorPageCanvas from "../EditorPageCanvas";

class TestIntersectionObserver {
  static instances: TestIntersectionObserver[] = [];

  static intersect(isIntersecting = true) {
    for (const observer of TestIntersectionObserver.instances) observer.trigger(isIntersecting);
  }

  private readonly callback: IntersectionObserverCallback;
  private target: Element | undefined;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    TestIntersectionObserver.instances.push(this);
  }

  observe = vi.fn((target: Element) => {
    this.target = target;
  });

  disconnect() {
    this.target = undefined;
  }

  trigger(isIntersecting = true) {
    if (!this.target) return;
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
    vi.resetAllMocks();
    pdfServiceMocks.getPageRotation.mockReturnValue(Effect.succeed(0));
    pdfServiceMocks.renderPage.mockReturnValue(Effect.succeed(undefined));
    pdfServiceMocks.reset.mockReturnValue(Effect.succeed(undefined));
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
    const { getByTestId } = render(() => (
      <EditorPageCanvas page={makePage()} rotation={90} scrollRoot={scrollRoot} runtime={runtime} />
    ));

    expect(pdfServiceMocks.renderPage).not.toHaveBeenCalled();
    TestIntersectionObserver.intersect(false);
    expect(pdfServiceMocks.renderPage).not.toHaveBeenCalled();
    TestIntersectionObserver.intersect();

    const canvasFrame = getByTestId("editor-page-canvas");
    await waitFor(() => expect(canvasFrame).toHaveAttribute("data-render-state", "error"));

    expect(screen.getByRole("status")).toHaveTextContent("Preview unavailable.");
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(canvasFrame).toHaveStyle({ "--frame-ratio": "0.75", "--page-rotation": "90deg" });

    fireEvent.click(screen.getByRole("button", { name: "Retry page preview" }));

    expect(canvasFrame).toHaveAttribute("data-render-state", "loading");
    TestIntersectionObserver.intersect();

    await waitFor(() => expect(canvasFrame).toHaveAttribute("data-render-state", "ready"));
    expect(screen.queryByText("Preview unavailable.")).not.toBeInTheDocument();
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

  it("shows a retry state when the runtime closes before a lazy render starts", async () => {
    const scrollRoot = document.createElement("div");
    const { getByTestId } = render(() => (
      <EditorPageCanvas page={makePage()} rotation={90} scrollRoot={scrollRoot} runtime={runtime} />
    ));

    await runtime.dispose();
    TestIntersectionObserver.intersect();

    const canvasFrame = getByTestId("editor-page-canvas");
    await waitFor(() => expect(canvasFrame).toHaveAttribute("data-render-state", "error"));
    expect(screen.getByRole("status")).toHaveTextContent("Preview unavailable.");
    expect(pdfServiceMocks.renderPage).not.toHaveBeenCalled();
  });
});
