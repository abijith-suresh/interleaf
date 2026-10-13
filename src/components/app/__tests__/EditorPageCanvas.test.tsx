import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { Effect } from "effect";
import { createSignal } from "solid-js";
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
    preload = () => Effect.void;
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

  disconnect = vi.fn(() => {
    this.target = undefined;
  });

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
    vi.useRealTimers();
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

  it("defers changed offscreen previews until reentry and coalesces revisions", async () => {
    pdfServiceMocks.renderPage.mockImplementation((_file, _pageNumber, canvas: HTMLCanvasElement) =>
      Effect.sync(() => {
        canvas.width = 120;
        canvas.height = 160;
      })
    );
    const [page, setPage] = createSignal(makePage());
    const { getByTestId } = render(() => (
      <EditorPageCanvas
        page={page()}
        rotation={90}
        scrollRoot={document.createElement("div")}
        runtime={runtime}
      />
    ));
    const frame = getByTestId("editor-page-canvas");
    TestIntersectionObserver.intersect();
    await waitFor(() => expect(frame).toHaveAttribute("data-render-state", "ready"));
    expect(pdfServiceMocks.renderPage).toHaveBeenCalledTimes(1);

    TestIntersectionObserver.intersect(false);
    setPage({ ...page(), contentRevision: 1 });
    setPage({ ...page(), contentRevision: 2 });
    await Promise.resolve();
    expect(pdfServiceMocks.renderPage).toHaveBeenCalledTimes(1);

    TestIntersectionObserver.intersect();
    await waitFor(() => expect(pdfServiceMocks.renderPage).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(frame).toHaveAttribute("data-render-state", "ready"));
    // Refreshes keep the ready state, so allow the completed fiber to settle before scrolling.
    await new Promise((resolve) => setTimeout(resolve, 0));
    TestIntersectionObserver.intersect(false);
    TestIntersectionObserver.intersect();
    await Promise.resolve();
    expect(pdfServiceMocks.renderPage).toHaveBeenCalledTimes(2);
  });

  it("keeps the ready frame while a new revision renders", async () => {
    let finish!: () => void;
    const pendingRender = new Promise<void>((resolve) => {
      finish = resolve;
    });
    pdfServiceMocks.renderPage
      .mockImplementationOnce((_file, _pageNumber, canvas: HTMLCanvasElement) =>
        Effect.sync(() => {
          canvas.width = 120;
          canvas.height = 160;
        })
      )
      .mockReturnValueOnce(Effect.promise(() => pendingRender));
    const [page, setPage] = createSignal(makePage());
    const { getByTestId } = render(() => (
      <EditorPageCanvas
        page={page()}
        rotation={90}
        scrollRoot={document.createElement("div")}
        runtime={runtime}
      />
    ));
    const frame = getByTestId("editor-page-canvas");
    TestIntersectionObserver.intersect();
    await waitFor(() => expect(frame).toHaveAttribute("data-render-state", "ready"));
    const canvas = frame.querySelector("canvas");
    setPage({ ...page(), contentRevision: 1 });
    await waitFor(() => expect(pdfServiceMocks.renderPage).toHaveBeenCalledTimes(2));
    expect(canvas?.width).toBe(120);
    expect(canvas?.height).toBe(160);
    expect(frame).toHaveAttribute("data-render-state", "ready");
    finish();
  });

  it("cancels a preview leaving the viewport without showing an error, then retries on reentry", async () => {
    const interrupted = vi.fn();
    let finish!: () => void;
    const pendingRender = new Promise<void>((resolve) => {
      finish = resolve;
    });
    pdfServiceMocks.renderPage.mockImplementation((_file, _pageNumber, canvas: HTMLCanvasElement) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => pendingRender);
        canvas.width = 120;
        canvas.height = 160;
      }).pipe(Effect.onInterrupt(() => Effect.sync(interrupted)))
    );
    const [page, setPage] = createSignal(makePage());
    const { getByTestId } = render(() => (
      <EditorPageCanvas
        page={page()}
        rotation={90}
        scrollRoot={document.createElement("div")}
        runtime={runtime}
      />
    ));
    TestIntersectionObserver.intersect();
    await waitFor(() => expect(pdfServiceMocks.renderPage).toHaveBeenCalledTimes(1));
    TestIntersectionObserver.intersect(false);
    setPage({ ...page(), contentRevision: 1 });
    await waitFor(() => expect(interrupted).toHaveBeenCalledOnce());
    finish();
    await Promise.resolve();
    expect(getByTestId("editor-page-canvas")).toHaveAttribute("data-render-state", "loading");
    expect(screen.queryByText("Preview unavailable.")).not.toBeInTheDocument();
    expect(pdfServiceMocks.renderPage).toHaveBeenCalledTimes(1);
    TestIntersectionObserver.intersect();
    await waitFor(() => expect(pdfServiceMocks.renderPage).toHaveBeenCalledTimes(2));
  });

  it("releases offscreen bitmap memory after a grace period and repaints on return", async () => {
    pdfServiceMocks.renderPage.mockImplementation((_file, _pageNumber, canvas: HTMLCanvasElement) =>
      Effect.sync(() => {
        canvas.width = 120;
        canvas.height = 160;
      })
    );
    const { getByTestId } = render(() => (
      <EditorPageCanvas
        page={makePage()}
        rotation={90}
        scrollRoot={document.createElement("div")}
        runtime={runtime}
      />
    ));
    const frame = getByTestId("editor-page-canvas");
    const canvas = frame.querySelector("canvas");
    TestIntersectionObserver.intersect();
    await waitFor(() => expect(frame).toHaveAttribute("data-render-state", "ready"));

    vi.useFakeTimers();
    TestIntersectionObserver.intersect(false);
    await vi.advanceTimersByTimeAsync(999);
    expect(canvas?.width).toBe(120);
    TestIntersectionObserver.intersect();
    await vi.advanceTimersByTimeAsync(1000);
    expect(canvas?.width).toBe(120);
    expect(pdfServiceMocks.renderPage).toHaveBeenCalledOnce();

    TestIntersectionObserver.intersect(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(canvas?.width).toBe(0);
    expect(canvas?.height).toBe(0);
    expect(frame).toHaveAttribute("data-render-state", "loading");
    vi.useRealTimers();
    TestIntersectionObserver.intersect();
    await waitFor(() => expect(pdfServiceMocks.renderPage).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(frame).toHaveAttribute("data-render-state", "ready"));
    expect(canvas?.width).toBe(120);
    expect(canvas?.height).toBe(160);
  });

  it("interrupts pending work, disconnects observation, and releases pixels on unmount", async () => {
    const interrupted = vi.fn();
    pdfServiceMocks.renderPage.mockImplementation((_file, _pageNumber, canvas: HTMLCanvasElement) =>
      Effect.gen(function* () {
        canvas.width = 120;
        canvas.height = 160;
        yield* Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(interrupted)));
      })
    );
    const { getByTestId, unmount } = render(() => (
      <EditorPageCanvas
        page={makePage()}
        rotation={90}
        scrollRoot={document.createElement("div")}
        runtime={runtime}
      />
    ));
    const canvas = getByTestId("editor-page-canvas").querySelector("canvas");
    TestIntersectionObserver.intersect();
    await waitFor(() => expect(canvas?.width).toBe(120));
    unmount();
    await waitFor(() => expect(interrupted).toHaveBeenCalledOnce());
    expect(canvas?.width).toBe(0);
    expect(canvas?.height).toBe(0);
    expect(TestIntersectionObserver.instances[0]?.disconnect).toHaveBeenCalledOnce();
    TestIntersectionObserver.intersect();
    expect(pdfServiceMocks.renderPage).toHaveBeenCalledOnce();
  });
});
