import { Effect, Fiber } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFPasswordRequiredError } from "../../types/interfaces";

const decodeData = (value: ArrayBuffer | ArrayBufferView | undefined) => {
  if (!value) {
    return "";
  }

  if (ArrayBuffer.isView(value)) {
    return new TextDecoder().decode(value);
  }

  return new TextDecoder().decode(new Uint8Array(value));
};

const loadingTaskDestroyMock = vi.fn().mockResolvedValue(undefined);
const renderCancelMock = vi.fn();
const pageCleanupMock = vi.fn();

const pdfjsGetDocumentMock = vi
  .fn()
  .mockImplementation((options?: { data?: Uint8Array; password?: string }) => {
    const label = decodeData(options?.data);

    if (label.includes("needs-password")) {
      if (options?.password !== "623") {
        return {
          promise: Promise.reject(
            Object.assign(new Error("Password required"), { name: "PasswordException" })
          ),
        };
      }
    }

    const baseSize = label.includes("wide")
      ? { width: 300, height: 150 }
      : { width: 100, height: 200 };
    const pageRotation = label.includes("rotated") ? 90 : 0;

    return {
      promise: Promise.resolve({
        numPages: label.includes("two-pages") ? 2 : 5,
        getPage: vi.fn().mockResolvedValue({
          rotate: pageRotation,
          getViewport: vi.fn().mockImplementation(({ scale = 1, rotation = 0 } = {}) => {
            const width = baseSize.width * scale;
            const height = baseSize.height * scale;

            if (rotation === 90 || rotation === 270) {
              return { width: height, height: width };
            }

            return { width, height };
          }),
          cleanup: pageCleanupMock,
          render: vi.fn().mockReturnValue({
            promise: Promise.resolve(),
            cancel: renderCancelMock,
          }),
        }),
        cleanup: vi.fn().mockResolvedValue(undefined),
      }),
      destroy: loadingTaskDestroyMock,
    };
  });

vi.mock("pdfjs-dist", () => ({
  getDocument: pdfjsGetDocumentMock,
  GlobalWorkerOptions: { workerSrc: "" },
}));

describe("PDFService", () => {
  let PDFService: typeof import("../pdf-service").PDFService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await import("../pdf-service");
    PDFService = module.PDFService;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads an unencrypted PDF and tracks it as active", async () => {
    const service = new PDFService();
    const file = new File(["plain"], "test.pdf", { type: "application/pdf" });

    await Effect.runPromise(service.loadPDF(file));

    expect(service.getPageCount()).toBe(5);
  });

  it("uses PDF.js page metadata before an export is requested", async () => {
    const service = new PDFService();
    const file = new File(["two-pages"], "test.pdf", { type: "application/pdf" });

    await Effect.runPromise(service.loadPDF(file));

    expect(service.getPageCount()).toBe(2);
  });

  it("returns page dimensions for the requested rotation", async () => {
    const service = new PDFService();
    const file = new File(["wide"], "wide.pdf", { type: "application/pdf" });

    await Effect.runPromise(service.loadPDF(file));

    await expect(Effect.runPromise(service.getPageSize(file, 1, 90))).resolves.toEqual({
      width: 150,
      height: 300,
    });
    expect(pageCleanupMock).toHaveBeenCalledTimes(1);
  });

  it("reuses a cached document when the same file is loaded again", async () => {
    const service = new PDFService();
    const file = new File(["plain"], "test.pdf", { type: "application/pdf" });

    await Effect.runPromise(service.loadPDF(file));
    await Effect.runPromise(service.loadPDF(file));

    expect(pdfjsGetDocumentMock).toHaveBeenCalledTimes(1);
  });

  it("releases one cached document without resetting the session", async () => {
    const service = new PDFService();
    const file = new File(["plain"], "test.pdf", { type: "application/pdf" });

    await Effect.runPromise(service.loadPDF(file));
    await Effect.runPromise(service.releaseFile(file));
    await Effect.runPromise(service.loadPDF(file));

    expect(pdfjsGetDocumentMock).toHaveBeenCalledTimes(2);
    expect(service.getPageCount()).toBe(5);
  });

  it("does not strand a PDF.js load if release wins before fiber assignment", async () => {
    const file = new File(["plain"], "release-race.pdf", { type: "application/pdf" });
    let cleanupCompleted = false;
    let releasePromise!: Promise<void>;
    let service!: InstanceType<typeof PDFService>;
    service = new PDFService((effect) =>
      Effect.flatMap(
        Effect.forkDetach(
          Effect.ensuring(
            effect.pipe(Effect.andThen(Effect.never)),
            Effect.sync(() => {
              cleanupCompleted = true;
            })
          ),
          { startImmediately: true }
        ),
        (fiber) => {
          releasePromise = Effect.runPromise(service.releaseFile(file));
          return Effect.succeed(fiber);
        }
      )
    );

    await expect(Effect.runPromise(service.loadPDF(file))).rejects.toMatchObject({
      operation: "release-file",
      file,
    });
    await releasePromise;
    expect(cleanupCompleted).toBe(true);
  });

  it("does not strand a PDF.js load if reset wins before fiber assignment", async () => {
    const file = new File(["plain"], "reset-race.pdf", { type: "application/pdf" });
    let cleanupCompleted = false;
    let resetPromise!: Promise<void>;
    let service!: InstanceType<typeof PDFService>;
    service = new PDFService((effect) =>
      Effect.flatMap(
        Effect.forkDetach(
          Effect.ensuring(
            effect.pipe(Effect.andThen(Effect.never)),
            Effect.sync(() => {
              cleanupCompleted = true;
            })
          ),
          { startImmediately: true }
        ),
        (fiber) => {
          resetPromise = Effect.runPromise(service.reset());
          return Effect.succeed(fiber);
        }
      )
    );

    await expect(Effect.runPromise(service.loadPDF(file))).rejects.toMatchObject({
      operation: "release-file",
      file,
    });
    await resetPromise;
    expect(cleanupCompleted).toBe(true);
  });

  it("deduplicates concurrent loads for the same file", async () => {
    const service = new PDFService();
    const file = new File(["plain"], "test.pdf", { type: "application/pdf" });

    await Promise.all([
      Effect.runPromise(service.loadPDF(file)),
      Effect.runPromise(service.loadPDF(file)),
    ]);

    expect(pdfjsGetDocumentMock).toHaveBeenCalledTimes(1);
  });

  it("cleans a duplicate successful load when another load owns the cache", async () => {
    let resolveFirst!: (document: unknown) => void;
    let resolveSecond!: (document: unknown) => void;
    const firstDocumentCleanup = vi.fn().mockResolvedValue(undefined);
    const secondDocumentCleanup = vi.fn().mockResolvedValue(undefined);
    const firstDestroy = vi.fn().mockResolvedValue(undefined);
    const secondDestroy = vi.fn().mockResolvedValue(undefined);
    const firstLoadingPromise = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const secondLoadingPromise = new Promise((resolve) => {
      resolveSecond = resolve;
    });
    pdfjsGetDocumentMock
      .mockImplementationOnce(() => ({
        promise: firstLoadingPromise,
        destroy: firstDestroy,
      }))
      .mockImplementationOnce(() => ({
        promise: secondLoadingPromise,
        destroy: secondDestroy,
      }));

    const service = new PDFService();
    const file = new File(["plain"], "duplicate-success.pdf", { type: "application/pdf" });
    const firstLoad = Effect.runFork(service.loadPDF(file));
    await vi.waitFor(() => expect(pdfjsGetDocumentMock).toHaveBeenCalledTimes(1));
    const secondLoad = Effect.runFork(service.loadPDFWithPassword(file, "password"));
    await vi.waitFor(() => expect(pdfjsGetDocumentMock).toHaveBeenCalledTimes(2));

    resolveFirst({ numPages: 5, cleanup: firstDocumentCleanup });
    resolveSecond({ numPages: 5, cleanup: secondDocumentCleanup });
    await Promise.all([
      Effect.runPromise(Fiber.join(firstLoad)),
      Effect.runPromise(Fiber.join(secondLoad)),
    ]);

    expect(firstDocumentCleanup).not.toHaveBeenCalled();
    expect(secondDocumentCleanup).toHaveBeenCalledTimes(1);
    expect(firstDestroy).not.toHaveBeenCalled();
    expect(secondDestroy).toHaveBeenCalledTimes(1);

    await Effect.runPromise(service.releaseFile(file));
    expect(firstDocumentCleanup).toHaveBeenCalledTimes(1);
    expect(firstDestroy).toHaveBeenCalledTimes(1);
  });

  it("keeps a shared load alive when one consumer is interrupted", async () => {
    let resolveLoading!: (document: unknown) => void;
    const loadingPromise = new Promise((resolve) => {
      resolveLoading = resolve;
    });
    pdfjsGetDocumentMock.mockImplementationOnce(() => ({
      promise: loadingPromise,
      destroy: loadingTaskDestroyMock,
    }));

    const service = new PDFService();
    const file = new File(["plain"], "shared-pending.pdf", { type: "application/pdf" });
    const firstConsumer = Effect.runFork(service.loadPDF(file));
    const secondConsumer = Effect.runFork(service.loadPDF(file));

    await vi.waitFor(() => expect(pdfjsGetDocumentMock).toHaveBeenCalled());
    await Effect.runPromise(Fiber.interrupt(firstConsumer));
    resolveLoading({ numPages: 5 });
    await Effect.runPromise(Fiber.join(secondConsumer));

    expect(loadingTaskDestroyMock).not.toHaveBeenCalled();
  });

  it("keeps a detached PDF.js load alive until the session resets", async () => {
    let rejectLoading!: (cause: unknown) => void;
    const loadingPromise = new Promise((_, reject) => {
      rejectLoading = reject;
    });
    const destroy = vi.fn(() => {
      rejectLoading(new Error("loading aborted"));
      return Promise.resolve();
    });
    pdfjsGetDocumentMock.mockImplementationOnce(() => ({
      promise: loadingPromise,
      destroy,
    }));

    const service = new PDFService();
    const file = new File(["plain"], "pending.pdf", { type: "application/pdf" });
    const fiber = Effect.runFork(service.loadPDF(file));

    await vi.waitFor(() => expect(pdfjsGetDocumentMock).toHaveBeenCalled());
    await Effect.runPromise(Fiber.interrupt(fiber));

    expect(destroy).not.toHaveBeenCalled();
    await Effect.runPromise(service.reset());
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("does not cache a PDF load that finishes after a targeted release", async () => {
    let resolveLoading!: (document: unknown) => void;
    const loadingPromise = new Promise((resolve) => {
      resolveLoading = resolve;
    });
    const lateDocumentCleanup = vi.fn().mockResolvedValue(undefined);
    pdfjsGetDocumentMock.mockImplementationOnce(() => ({
      promise: loadingPromise,
      destroy: loadingTaskDestroyMock,
    }));

    const service = new PDFService();
    const file = new File(["plain"], "released-pending.pdf", { type: "application/pdf" });
    const fiber = Effect.runFork(service.loadPDF(file));

    await vi.waitFor(() => expect(pdfjsGetDocumentMock).toHaveBeenCalled());
    const releasePromise = Effect.runPromise(service.releaseFile(file));
    resolveLoading({
      numPages: 5,
      cleanup: lateDocumentCleanup,
    });
    await releasePromise;
    await Effect.runPromise(Fiber.await(fiber));
    await vi.waitFor(() => expect(lateDocumentCleanup).toHaveBeenCalledTimes(1));

    await Effect.runPromise(service.loadPDF(file));
    expect(pdfjsGetDocumentMock).toHaveBeenCalledTimes(2);
  });

  it("awaits cleanup when a PDF load is invalidated after PDF.js resolves", async () => {
    let resolveLoading!: (document: unknown) => void;
    let resolveCleanup!: () => void;
    const loadingPromise = new Promise((resolve) => {
      resolveLoading = resolve;
    });
    const cleanupPromise = new Promise<void>((resolve) => {
      resolveCleanup = resolve;
    });
    const cleanup = vi.fn(() => cleanupPromise);
    const document = {
      numPages: 5,
      cleanup,
    };
    pdfjsGetDocumentMock.mockImplementationOnce(() => ({
      promise: loadingPromise,
      destroy: loadingTaskDestroyMock,
    }));

    const service = new PDFService();
    const file = new File(["plain"], "stale-cleanup.pdf", { type: "application/pdf" });
    const fileVersions = (service as unknown as { fileVersions: WeakMap<File, number> })
      .fileVersions;
    const fiber = Effect.runFork(service.loadPDF(file));
    let loadSettled = false;
    const loadPromise = Effect.runPromise(Fiber.join(fiber)).then(() => {
      loadSettled = true;
    });

    await vi.waitFor(() => expect(pdfjsGetDocumentMock).toHaveBeenCalled());
    fileVersions.set(file, 1);
    resolveLoading(document);
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1));
    expect(loadSettled).toBe(false);

    resolveCleanup();
    await loadPromise;
    expect(loadSettled).toBe(true);
  });

  it("finishes cached document cleanup if targeted release is interrupted", async () => {
    let resolveCleanup!: () => void;
    const cleanupPromise = new Promise<void>((resolve) => {
      resolveCleanup = resolve;
    });
    const cleanup = vi.fn(() => cleanupPromise);
    const document = {
      numPages: 5,
      cleanup,
    };
    pdfjsGetDocumentMock.mockImplementationOnce(() => ({
      promise: Promise.resolve(document),
      destroy: loadingTaskDestroyMock,
    }));

    const service = new PDFService();
    const file = new File(["plain"], "cleanup-pending.pdf", { type: "application/pdf" });
    await Effect.runPromise(service.loadPDF(file));

    const releaseFiber = Effect.runFork(service.releaseFile(file));
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1));

    let releaseSettled = false;
    const interruptedRelease = Effect.runPromise(Fiber.interrupt(releaseFiber)).then(() => {
      releaseSettled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(releaseSettled).toBe(false);
    resolveCleanup();
    await interruptedRelease;

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("interrupts an in-flight PDF.js load when the session resets", async () => {
    let rejectLoading!: (cause: unknown) => void;
    const loadingPromise = new Promise((_, reject) => {
      rejectLoading = reject;
    });
    const destroy = vi.fn(() => {
      rejectLoading(new Error("loading aborted"));
      return Promise.resolve();
    });
    pdfjsGetDocumentMock.mockImplementationOnce(() => ({
      promise: loadingPromise,
      destroy,
    }));

    const service = new PDFService();
    const file = new File(["plain"], "reset-pending.pdf", { type: "application/pdf" });
    const fiber = Effect.runFork(service.loadPDF(file));

    await vi.waitFor(() => expect(pdfjsGetDocumentMock).toHaveBeenCalled());
    await Effect.runPromise(service.reset());
    await Effect.runPromise(Fiber.await(fiber));

    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("surfaces a loading-task destruction failure during reset", async () => {
    let rejectLoading!: (cause: unknown) => void;
    const loadingPromise = new Promise((_, reject) => {
      rejectLoading = reject;
    });
    const destroy = vi.fn(() => {
      rejectLoading(new Error("loading aborted"));
      return Promise.reject(new Error("worker destroy failed"));
    });
    pdfjsGetDocumentMock.mockImplementationOnce(() => ({
      promise: loadingPromise,
      destroy,
    }));

    const service = new PDFService();
    const file = new File(["plain"], "reset-worker-failure.pdf", {
      type: "application/pdf",
    });
    const loadFiber = Effect.runFork(service.loadPDF(file));

    await vi.waitFor(() => expect(pdfjsGetDocumentMock).toHaveBeenCalled());
    await expect(Effect.runPromise(service.reset())).rejects.toMatchObject({
      operation: "destroy-pdf-js",
      file,
    });
    await Effect.runPromise(Fiber.await(loadFiber));
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("continues canceling other loads after one cleanup fails", async () => {
    let rejectFirst!: (cause: unknown) => void;
    let rejectSecond!: (cause: unknown) => void;
    const firstLoadingPromise = new Promise((_, reject) => {
      rejectFirst = reject;
    });
    const secondLoadingPromise = new Promise((_, reject) => {
      rejectSecond = reject;
    });
    const firstDestroy = vi.fn(() => {
      rejectFirst(new Error("loading aborted"));
      return Promise.reject(new Error("first worker failed"));
    });
    const secondDestroy = vi.fn(() => {
      rejectSecond(new Error("loading aborted"));
      return Promise.reject(new Error("second worker failed"));
    });
    pdfjsGetDocumentMock
      .mockImplementationOnce(() => ({ promise: firstLoadingPromise, destroy: firstDestroy }))
      .mockImplementationOnce(() => ({ promise: secondLoadingPromise, destroy: secondDestroy }));

    const service = new PDFService();
    const file = new File(["plain"], "multiple-pending-loads.pdf", {
      type: "application/pdf",
    });
    const firstLoad = Effect.runFork(service.loadPDF(file));
    const secondLoad = Effect.runFork(service.loadPDFWithPassword(file, "password"));

    await vi.waitFor(() => expect(pdfjsGetDocumentMock).toHaveBeenCalledTimes(2));
    await expect(Effect.runPromise(service.reset())).rejects.toMatchObject({
      operation: "destroy-pdf-js",
      file,
    });
    await Effect.runPromise(Fiber.await(firstLoad));
    await Effect.runPromise(Fiber.await(secondLoad));

    expect(firstDestroy).toHaveBeenCalledTimes(1);
    expect(secondDestroy).toHaveBeenCalledTimes(1);
  });

  it("allows a retry after a document load fails", async () => {
    pdfjsGetDocumentMock.mockImplementationOnce(() => ({
      promise: Promise.reject(new Error("temporary PDF.js failure")),
    }));

    const service = new PDFService();
    const file = new File(["plain"], "test.pdf", { type: "application/pdf" });

    await expect(Effect.runPromise(service.loadPDF(file))).rejects.toThrow(
      "temporary PDF.js failure"
    );
    await Effect.runPromise(service.loadPDF(file));

    expect(service.getPageCount()).toBe(5);
    expect(pdfjsGetDocumentMock).toHaveBeenCalledTimes(2);
  });

  it("destroys a PDF.js loading task when the load fails", async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    pdfjsGetDocumentMock.mockImplementationOnce(() => ({
      promise: Promise.reject(new Error("invalid PDF")),
      destroy,
    }));

    const service = new PDFService();
    const file = new File(["plain"], "invalid.pdf", { type: "application/pdf" });

    await expect(Effect.runPromise(service.loadPDF(file))).rejects.toThrow("invalid PDF");
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("surfaces a failed loading-task cleanup when the load fails", async () => {
    const destroy = vi.fn().mockRejectedValue(new Error("worker destroy failed"));
    pdfjsGetDocumentMock.mockImplementationOnce(() => ({
      promise: Promise.reject(new Error("invalid PDF")),
      destroy,
    }));

    const service = new PDFService();
    const file = new File(["plain"], "invalid-worker.pdf", { type: "application/pdf" });

    await expect(Effect.runPromise(service.loadPDF(file))).rejects.toMatchObject({
      operation: "destroy-pdf-js",
      file,
    });
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("loads an owner-password encrypted PDF without prompting for a password", async () => {
    const service = new PDFService();
    const file = new File(["owner-encrypted"], "owner-protected.pdf", {
      type: "application/pdf",
    });

    await Effect.runPromise(service.loadPDF(file));

    expect(service.getPageCount()).toBe(5);
  });

  it("requires a password for a user-password encrypted PDF", async () => {
    const service = new PDFService();
    const file = new File(["needs-password encrypted"], "protected.pdf", {
      type: "application/pdf",
    });

    await expect(Effect.runPromise(service.loadPDF(file))).rejects.toEqual(
      expect.objectContaining({
        name: "PDFPasswordRequiredError",
        reason: "needs-password",
        file,
      })
    );
  });

  it("loads an encrypted PDF with the correct password", async () => {
    const service = new PDFService();
    const file = new File(["needs-password encrypted"], "protected.pdf", {
      type: "application/pdf",
    });

    await Effect.runPromise(service.loadPDFWithPassword(file, "623"));

    expect(service.getPageCount()).toBe(5);
  });

  it("throws PDFPasswordRequiredError with a wrong password", async () => {
    const service = new PDFService();
    const file = new File(["needs-password encrypted"], "protected.pdf", {
      type: "application/pdf",
    });

    await expect(Effect.runPromise(service.loadPDFWithPassword(file, "wrong"))).rejects.toEqual(
      expect.objectContaining({
        name: "PDFPasswordRequiredError",
        reason: "wrong-password",
        file,
      })
    );
  });

  it("renders pages for the requested source file even after another file becomes active", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as unknown as CanvasRenderingContext2D
    );

    const service = new PDFService();
    const portraitFile = new File(["plain"], "portrait.pdf", { type: "application/pdf" });
    const wideFile = new File(["wide two-pages"], "wide.pdf", { type: "application/pdf" });

    await Effect.runPromise(service.loadPDF(portraitFile));
    await Effect.runPromise(service.loadPDF(wideFile));

    const portraitCanvas = document.createElement("canvas");
    const wideCanvas = document.createElement("canvas");

    await Promise.all([
      Effect.runPromise(service.renderPage(portraitFile, 1, portraitCanvas, 1, 0)),
      Effect.runPromise(service.renderPage(wideFile, 1, wideCanvas, 1, 0)),
    ]);

    expect(portraitCanvas.height).toBeGreaterThan(portraitCanvas.width);
    expect(wideCanvas.width).toBeGreaterThan(wideCanvas.height);
  });

  it("renders a rotated page using the requested file", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as unknown as CanvasRenderingContext2D
    );

    const service = new PDFService();
    const file = new File(["plain"], "test.pdf", { type: "application/pdf" });
    await Effect.runPromise(service.loadPDF(file));

    const canvas = document.createElement("canvas");
    await Effect.runPromise(service.renderPage(file, 1, canvas, 1, 90));

    expect(canvas.width).toBeGreaterThan(canvas.height);
    expect(pageCleanupMock).toHaveBeenCalledTimes(1);
  });

  it("bounds concurrent PDF.js page renders", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as unknown as CanvasRenderingContext2D
    );

    let activeRenders = 0;
    let maxActiveRenders = 0;
    let startedRenders = 0;
    const finishRenders: Array<() => void> = [];
    const render = vi.fn(() => {
      startedRenders += 1;
      activeRenders += 1;
      maxActiveRenders = Math.max(maxActiveRenders, activeRenders);

      let resolveRender!: () => void;
      const promise = new Promise<void>((resolve) => {
        resolveRender = resolve;
      });
      finishRenders.push(() => {
        activeRenders -= 1;
        resolveRender();
      });
      return { promise, cancel: renderCancelMock };
    });
    const page = {
      getViewport: vi.fn().mockReturnValue({ width: 100, height: 200 }),
      cleanup: pageCleanupMock,
      render,
    };
    pdfjsGetDocumentMock.mockImplementationOnce(() => ({
      promise: Promise.resolve({
        getPage: vi.fn().mockResolvedValue(page),
        cleanup: vi.fn().mockResolvedValue(undefined),
      }),
      destroy: loadingTaskDestroyMock,
    }));

    const service = new PDFService();
    const file = new File(["plain"], "bounded-render.pdf", { type: "application/pdf" });
    await Effect.runPromise(service.loadPDF(file));

    const fibers = [1, 2, 3].map(() =>
      Effect.runFork(service.renderPage(file, 1, document.createElement("canvas")))
    );

    await vi.waitFor(() => expect(startedRenders).toBe(2));
    expect(maxActiveRenders).toBe(2);
    expect(finishRenders).toHaveLength(2);

    finishRenders.shift()?.();
    await vi.waitFor(() => expect(startedRenders).toBe(3));
    finishRenders.shift()?.();
    finishRenders.shift()?.();

    await Promise.all(fibers.map((fiber) => Effect.runPromise(Fiber.join(fiber))));
    expect(maxActiveRenders).toBe(2);
    expect(pageCleanupMock).toHaveBeenCalledTimes(3);
  });

  it("reads the source page rotation for composed exports", async () => {
    const service = new PDFService();
    const file = new File(["rotated"], "rotated.pdf", { type: "application/pdf" });
    await Effect.runPromise(service.loadPDF(file));

    await expect(Effect.runPromise(service.getPageRotation(file, 1))).resolves.toBe(90);
    expect(pageCleanupMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a failed PDF.js page cleanup", async () => {
    const pageCleanup = vi.fn().mockReturnValue(false);
    const file = new File(["plain"], "failed-page-cleanup.pdf", { type: "application/pdf" });
    pdfjsGetDocumentMock.mockImplementationOnce(() => ({
      promise: Promise.resolve({
        getPage: vi.fn().mockResolvedValue({ rotate: 0, cleanup: pageCleanup }),
        cleanup: vi.fn().mockResolvedValue(undefined),
      }),
      destroy: loadingTaskDestroyMock,
    }));

    const service = new PDFService();
    await Effect.runPromise(service.loadPDF(file));

    await expect(Effect.runPromise(service.getPageRotation(file, 1))).rejects.toMatchObject({
      operation: "get-page-rotation",
      file,
    });
  });

  it("surfaces a failed PDF.js document cleanup", async () => {
    const documentCleanup = vi.fn().mockRejectedValue(new Error("document cleanup failed"));
    const file = new File(["plain"], "failed-document-cleanup.pdf", { type: "application/pdf" });
    pdfjsGetDocumentMock.mockImplementationOnce(() => ({
      promise: Promise.resolve({
        cleanup: documentCleanup,
      }),
      destroy: loadingTaskDestroyMock,
    }));

    const service = new PDFService();
    await Effect.runPromise(service.loadPDF(file));

    await expect(Effect.runPromise(service.releaseFile(file))).rejects.toMatchObject({
      operation: "cleanup-pdf-js",
      file,
    });
  });

  it("surfaces a failed PDF.js loading-task destruction", async () => {
    const loadingTaskDestroy = vi.fn().mockRejectedValue(new Error("worker destroy failed"));
    const file = new File(["plain"], "failed-worker-destroy.pdf", { type: "application/pdf" });
    pdfjsGetDocumentMock.mockImplementationOnce(() => ({
      promise: Promise.resolve({
        cleanup: vi.fn().mockResolvedValue(undefined),
      }),
      destroy: loadingTaskDestroy,
    }));

    const service = new PDFService();
    await Effect.runPromise(service.loadPDF(file));

    await expect(Effect.runPromise(service.releaseFile(file))).rejects.toMatchObject({
      operation: "destroy-pdf-js",
      file,
    });
  });

  it("surfaces page cleanup failures during release and still closes the document", async () => {
    let renderStarted = false;
    let resolveRender!: () => void;
    const renderPromise = new Promise<void>((resolve) => {
      resolveRender = resolve;
    });
    const pageCleanup = vi.fn().mockReturnValue(false);
    const documentCleanup = vi.fn().mockResolvedValue(undefined);
    const loadingTaskDestroy = vi.fn().mockResolvedValue(undefined);
    pdfjsGetDocumentMock.mockImplementationOnce(() => ({
      promise: Promise.resolve({
        getPage: vi.fn().mockResolvedValue({
          getViewport: vi.fn().mockReturnValue({ width: 100, height: 200 }),
          cleanup: pageCleanup,
          render: vi.fn().mockImplementation(() => {
            renderStarted = true;
            return {
              promise: renderPromise,
              cancel: vi.fn(() => resolveRender()),
            };
          }),
        }),
        cleanup: documentCleanup,
      }),
      destroy: loadingTaskDestroy,
    }));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as unknown as CanvasRenderingContext2D
    );

    const service = new PDFService();
    const file = new File(["plain"], "release-page-cleanup.pdf", { type: "application/pdf" });
    await Effect.runPromise(service.loadPDF(file));

    const renderFiber = Effect.runFork(
      service.renderPage(file, 1, document.createElement("canvas"))
    );
    await vi.waitFor(() => expect(renderStarted).toBe(true));

    await expect(Effect.runPromise(service.releaseFile(file))).rejects.toMatchObject({
      operation: "render-page",
      file,
    });
    expect(documentCleanup).toHaveBeenCalledTimes(1);
    expect(loadingTaskDestroy).toHaveBeenCalledTimes(1);
    await Effect.runPromise(Fiber.await(renderFiber));
  });

  it("propagates cleanup failures to concurrent release callers", async () => {
    let rejectCleanup!: (cause: unknown) => void;
    const cleanupPromise = new Promise<void>((_, reject) => {
      rejectCleanup = reject;
    });
    const documentCleanup = vi.fn(() => cleanupPromise);
    const file = new File(["plain"], "release-barrier-error.pdf", { type: "application/pdf" });
    pdfjsGetDocumentMock.mockImplementationOnce(() => ({
      promise: Promise.resolve({ cleanup: documentCleanup }),
      destroy: loadingTaskDestroyMock,
    }));

    const service = new PDFService();
    await Effect.runPromise(service.loadPDF(file));

    const firstRelease = Effect.runFork(service.releaseFile(file));
    await vi.waitFor(() => expect(documentCleanup).toHaveBeenCalledTimes(1));
    const secondRelease = Effect.runFork(service.releaseFile(file));
    rejectCleanup(new Error("document cleanup failed"));

    await expect(Effect.runPromise(Fiber.join(firstRelease))).rejects.toMatchObject({
      operation: "cleanup-pdf-js",
      file,
    });
    await expect(Effect.runPromise(Fiber.join(secondRelease))).rejects.toMatchObject({
      operation: "cleanup-pdf-js",
      file,
    });
  });

  it("cancels an in-flight PDF.js render when the fiber is interrupted", async () => {
    let renderStarted = false;
    let resolveRender!: () => void;
    const renderPromise = new Promise<void>((resolve) => {
      resolveRender = resolve;
    });
    const renderCancel = vi.fn(() => resolveRender());
    pdfjsGetDocumentMock.mockImplementationOnce(() => ({
      promise: Promise.resolve({
        getPage: vi.fn().mockResolvedValue({
          getViewport: vi.fn().mockReturnValue({ width: 100, height: 200 }),
          cleanup: pageCleanupMock,
          render: vi.fn().mockImplementation(() => {
            renderStarted = true;
            return { promise: renderPromise, cancel: renderCancel };
          }),
        }),
        cleanup: vi.fn().mockResolvedValue(undefined),
      }),
      destroy: loadingTaskDestroyMock,
    }));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as unknown as CanvasRenderingContext2D
    );

    const service = new PDFService();
    const file = new File(["plain"], "pending-render.pdf", { type: "application/pdf" });
    const fiber = Effect.runFork(service.renderPage(file, 1, document.createElement("canvas")));

    await vi.waitFor(() => expect(renderStarted).toBe(true));
    await Effect.runPromise(Fiber.interrupt(fiber));

    expect(renderCancel).toHaveBeenCalledTimes(1);
    expect(pageCleanupMock).toHaveBeenCalledTimes(1);
  });

  it("preserves page cleanup failures when a render is directly interrupted", async () => {
    let renderStarted = false;
    let resolveRender!: () => void;
    const renderPromise = new Promise<void>((resolve) => {
      resolveRender = resolve;
    });
    const pageCleanup = vi.fn().mockReturnValue(false);
    pdfjsGetDocumentMock.mockImplementationOnce(() => ({
      promise: Promise.resolve({
        getPage: vi.fn().mockResolvedValue({
          getViewport: vi.fn().mockReturnValue({ width: 100, height: 200 }),
          cleanup: pageCleanup,
          render: vi.fn().mockImplementation(() => {
            renderStarted = true;
            return { promise: renderPromise, cancel: vi.fn(() => resolveRender()) };
          }),
        }),
        cleanup: vi.fn().mockResolvedValue(undefined),
      }),
      destroy: loadingTaskDestroyMock,
    }));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as unknown as CanvasRenderingContext2D
    );

    const service = new PDFService();
    const file = new File(["plain"], "direct-interrupt-cleanup.pdf", {
      type: "application/pdf",
    });
    await Effect.runPromise(service.loadPDF(file));

    const renderFiber = Effect.runFork(
      service.renderPage(file, 1, document.createElement("canvas"))
    );
    await vi.waitFor(() => expect(renderStarted).toBe(true));
    await Effect.runPromise(Fiber.interrupt(renderFiber));

    await expect(Effect.runPromise(Fiber.join(renderFiber))).rejects.toMatchObject({
      operation: "render-page",
      file,
    });
  });

  it("interrupts an active render before targeted document cleanup", async () => {
    const events: string[] = [];
    let renderStarted = false;
    let resolveRender!: () => void;
    const renderPromise = new Promise<void>((resolve) => {
      resolveRender = resolve;
    });
    const renderCancel = vi.fn(() => {
      events.push("render-cancel");
    });
    const pageCleanup = vi.fn(() => {
      events.push("page-cleanup");
    });
    const documentCleanup = vi.fn(() => {
      events.push("document-cleanup");
    });

    pdfjsGetDocumentMock.mockImplementationOnce(() => ({
      promise: Promise.resolve({
        getPage: vi.fn().mockResolvedValue({
          getViewport: vi.fn().mockReturnValue({ width: 100, height: 200 }),
          cleanup: pageCleanup,
          render: vi.fn().mockImplementation(() => {
            renderStarted = true;
            events.push("render-start");
            return { promise: renderPromise, cancel: renderCancel };
          }),
        }),
        cleanup: documentCleanup,
      }),
      destroy: loadingTaskDestroyMock,
    }));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as unknown as CanvasRenderingContext2D
    );

    const service = new PDFService();
    const file = new File(["plain"], "active-render-release.pdf", { type: "application/pdf" });
    await Effect.runPromise(service.loadPDF(file));

    const renderFiber = Effect.runFork(
      service.renderPage(file, 1, document.createElement("canvas"))
    );
    await vi.waitFor(() => expect(renderStarted).toBe(true));

    const releaseFiber = Effect.runFork(service.releaseFile(file));
    await vi.waitFor(() => expect(renderCancel).toHaveBeenCalledTimes(1));
    expect(documentCleanup).not.toHaveBeenCalled();
    resolveRender();
    await Effect.runPromise(Fiber.join(releaseFiber));

    expect(renderCancel).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["render-start", "render-cancel", "page-cleanup", "document-cleanup"]);
    await Effect.runPromise(Fiber.await(renderFiber));
  });

  it("interrupts an in-flight page metadata operation before targeted document cleanup", async () => {
    const events: string[] = [];
    let resolvePage!: (page: unknown) => void;
    const pagePromise = new Promise((resolve) => {
      resolvePage = resolve;
    });
    const pageCleanup = vi.fn(() => {
      events.push("page-cleanup");
    });
    const documentCleanup = vi.fn(() => {
      events.push("document-cleanup");
    });
    const page = {
      rotate: 0,
      cleanup: pageCleanup,
    };
    const pdfDocument = {
      getPage: vi.fn(() => pagePromise),
      cleanup: documentCleanup,
    };
    pdfjsGetDocumentMock.mockImplementationOnce(() => ({
      promise: Promise.resolve(pdfDocument),
      destroy: loadingTaskDestroyMock,
    }));

    const service = new PDFService();
    const file = new File(["plain"], "active-metadata-release.pdf", {
      type: "application/pdf",
    });
    await Effect.runPromise(service.loadPDF(file));

    const metadataFiber = Effect.runFork(service.getPageRotation(file, 1));
    await vi.waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledTimes(1));

    const releaseFiber = Effect.runFork(service.releaseFile(file));
    await new Promise((resolve) => setTimeout(resolve, 0));
    resolvePage(page);
    await Effect.runPromise(Fiber.join(releaseFiber));
    await Effect.runPromise(Fiber.await(metadataFiber));

    expect(events).toEqual(["page-cleanup", "document-cleanup"]);
  });

  it("rejects a document operation created before release if it starts after release begins", async () => {
    let resolveCleanup!: () => void;
    const cleanupPromise = new Promise<void>((resolve) => {
      resolveCleanup = resolve;
    });
    const documentCleanup = vi.fn(() => cleanupPromise);
    const firstDocument = {
      numPages: 5,
      cleanup: documentCleanup,
    };
    pdfjsGetDocumentMock.mockImplementationOnce(() => ({
      promise: Promise.resolve(firstDocument),
      destroy: loadingTaskDestroyMock,
    }));

    const service = new PDFService();
    const file = new File(["plain"], "stale-release-operation.pdf", {
      type: "application/pdf",
    });
    await Effect.runPromise(service.loadPDF(file));

    const renderEffect = service.renderPage(file, 1, document.createElement("canvas"));
    const releaseFiber = Effect.runFork(service.releaseFile(file));
    await vi.waitFor(() => expect(documentCleanup).toHaveBeenCalledTimes(1));

    const renderFiber = Effect.runFork(renderEffect);
    resolveCleanup();
    await Effect.runPromise(Fiber.join(releaseFiber));

    await expect(Effect.runPromise(Fiber.join(renderFiber))).rejects.toMatchObject({
      operation: "render-page",
      file,
    });
    expect(pdfjsGetDocumentMock).toHaveBeenCalledTimes(1);
  });

  it("gates a new load behind targeted document cleanup", async () => {
    let resolveCleanup!: () => void;
    const cleanupPromise = new Promise<void>((resolve) => {
      resolveCleanup = resolve;
    });
    const firstDocument = {
      numPages: 5,
      cleanup: vi.fn(() => cleanupPromise),
    };
    pdfjsGetDocumentMock.mockImplementationOnce(() => ({
      promise: Promise.resolve(firstDocument),
      destroy: loadingTaskDestroyMock,
    }));

    const service = new PDFService();
    const file = new File(["plain"], "load-release-barrier.pdf", {
      type: "application/pdf",
    });
    await Effect.runPromise(service.loadPDF(file));

    const releaseFiber = Effect.runFork(service.releaseFile(file));
    await vi.waitFor(() => expect(firstDocument.cleanup).toHaveBeenCalledTimes(1));

    const loadFiber = Effect.runFork(service.loadPDF(file));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pdfjsGetDocumentMock).toHaveBeenCalledTimes(1);

    resolveCleanup();
    await Effect.runPromise(Fiber.join(releaseFiber));
    await Effect.runPromise(Fiber.join(loadFiber));

    expect(pdfjsGetDocumentMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a load created before release if it starts after release begins", async () => {
    let resolveCleanup!: () => void;
    const cleanupPromise = new Promise<void>((resolve) => {
      resolveCleanup = resolve;
    });
    const firstDocument = {
      numPages: 5,
      cleanup: vi.fn(() => cleanupPromise),
    };
    pdfjsGetDocumentMock.mockImplementationOnce(() => ({
      promise: Promise.resolve(firstDocument),
      destroy: loadingTaskDestroyMock,
    }));

    const service = new PDFService();
    const file = new File(["plain"], "stale-load-release.pdf", {
      type: "application/pdf",
    });
    await Effect.runPromise(service.loadPDF(file));

    const loadEffect = service.loadPDF(file);
    const releaseFiber = Effect.runFork(service.releaseFile(file));
    await vi.waitFor(() => expect(firstDocument.cleanup).toHaveBeenCalledTimes(1));

    const loadFiber = Effect.runFork(loadEffect);
    resolveCleanup();
    await Effect.runPromise(Fiber.join(releaseFiber));

    await expect(Effect.runPromise(Fiber.join(loadFiber))).rejects.toMatchObject({
      operation: "load-pdf",
      file,
    });
    expect(pdfjsGetDocumentMock).toHaveBeenCalledTimes(1);
  });

  it("waits for an in-flight release before starting a new render", async () => {
    let resolveCleanup!: () => void;
    const cleanupPromise = new Promise<void>((resolve) => {
      resolveCleanup = resolve;
    });
    const documentCleanup = vi.fn(() => cleanupPromise);
    const firstDocument = {
      numPages: 5,
      cleanup: documentCleanup,
    };
    pdfjsGetDocumentMock.mockImplementationOnce(() => ({
      promise: Promise.resolve(firstDocument),
      destroy: loadingTaskDestroyMock,
    }));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as unknown as CanvasRenderingContext2D
    );

    const service = new PDFService();
    const file = new File(["plain"], "release-barrier.pdf", { type: "application/pdf" });
    await Effect.runPromise(service.loadPDF(file));

    const releaseFiber = Effect.runFork(service.releaseFile(file));
    await vi.waitFor(() => expect(documentCleanup).toHaveBeenCalledTimes(1));

    let renderSettled = false;
    const renderFiber = Effect.runFork(
      service.renderPage(file, 1, globalThis.document.createElement("canvas"))
    );
    renderFiber.addObserver(() => {
      renderSettled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(renderSettled).toBe(false);
    expect(pdfjsGetDocumentMock).toHaveBeenCalledTimes(1);

    resolveCleanup();
    await Effect.runPromise(Fiber.join(releaseFiber));
    await Effect.runPromise(Fiber.join(renderFiber));

    expect(pdfjsGetDocumentMock).toHaveBeenCalledTimes(2);
  });

  it("waits for an in-flight reset before starting a new render", async () => {
    let resolveCleanup!: () => void;
    const cleanupPromise = new Promise<void>((resolve) => {
      resolveCleanup = resolve;
    });
    const documentCleanup = vi.fn(() => cleanupPromise);
    const firstDocument = {
      numPages: 5,
      cleanup: documentCleanup,
    };
    pdfjsGetDocumentMock.mockImplementationOnce(() => ({
      promise: Promise.resolve(firstDocument),
      destroy: loadingTaskDestroyMock,
    }));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as unknown as CanvasRenderingContext2D
    );

    const service = new PDFService();
    const file = new File(["plain"], "reset-barrier.pdf", { type: "application/pdf" });
    await Effect.runPromise(service.loadPDF(file));

    const resetFiber = Effect.runFork(service.reset());
    await vi.waitFor(() => expect(documentCleanup).toHaveBeenCalledTimes(1));

    let renderSettled = false;
    const renderFiber = Effect.runFork(
      service.renderPage(file, 1, globalThis.document.createElement("canvas"))
    );
    renderFiber.addObserver(() => {
      renderSettled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(renderSettled).toBe(false);
    expect(pdfjsGetDocumentMock).toHaveBeenCalledTimes(1);

    resolveCleanup();
    await Effect.runPromise(Fiber.join(resetFiber));
    await Effect.runPromise(Fiber.join(renderFiber));

    expect(pdfjsGetDocumentMock).toHaveBeenCalledTimes(2);
  });

  it("interrupts renders waiting for a permit before targeted document cleanup", async () => {
    const renderCancel = vi.fn();
    const pageCleanup = vi.fn();
    const documentCleanup = vi.fn();
    let startedRenders = 0;
    const pdfDocument = {
      getPage: vi.fn().mockResolvedValue({
        getViewport: vi.fn().mockReturnValue({ width: 100, height: 200 }),
        cleanup: pageCleanup,
        render: vi.fn().mockImplementation(() => {
          startedRenders += 1;
          let rejectRender!: (cause?: unknown) => void;
          const renderPromise = new Promise<void>((_, reject) => {
            rejectRender = reject;
          });
          return {
            promise: renderPromise,
            cancel: () => {
              renderCancel();
              rejectRender(new Error("render cancelled"));
            },
          };
        }),
      }),
      cleanup: documentCleanup,
    };
    pdfjsGetDocumentMock.mockImplementationOnce(() => ({
      promise: Promise.resolve(pdfDocument),
      destroy: loadingTaskDestroyMock,
    }));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as unknown as CanvasRenderingContext2D
    );

    const service = new PDFService();
    const file = new File(["plain"], "queued-render-release.pdf", { type: "application/pdf" });
    await Effect.runPromise(service.loadPDF(file));

    const fibers = [1, 2, 3].map(() =>
      Effect.runFork(service.renderPage(file, 1, globalThis.document.createElement("canvas")))
    );
    await vi.waitFor(() => expect(startedRenders).toBe(2));

    await Effect.runPromise(service.releaseFile(file));

    expect(renderCancel).toHaveBeenCalledTimes(2);
    expect(pageCleanup).toHaveBeenCalledTimes(3);
    expect(documentCleanup).toHaveBeenCalledTimes(1);
    await Promise.all(fibers.map((fiber) => Effect.runPromise(Fiber.await(fiber))));
  });

  it("interrupts active renders for every file before reset cleans documents", async () => {
    const renderCancel = vi.fn();
    const pageCleanup = vi.fn();
    const documentCleanups = [vi.fn(), vi.fn()];
    let startedRenders = 0;
    const makeDocument = (cleanup: ReturnType<typeof vi.fn>) => ({
      getPage: vi.fn().mockResolvedValue({
        getViewport: vi.fn().mockReturnValue({ width: 100, height: 200 }),
        cleanup: pageCleanup,
        render: vi.fn().mockImplementation(() => {
          startedRenders += 1;
          let rejectRender!: (cause?: unknown) => void;
          const renderPromise = new Promise<void>((_, reject) => {
            rejectRender = reject;
          });
          return {
            promise: renderPromise,
            cancel: () => {
              renderCancel();
              rejectRender(new Error("render cancelled"));
            },
          };
        }),
      }),
      cleanup,
    });
    pdfjsGetDocumentMock
      .mockImplementationOnce(() => ({
        promise: Promise.resolve(makeDocument(documentCleanups[0])),
        destroy: loadingTaskDestroyMock,
      }))
      .mockImplementationOnce(() => ({
        promise: Promise.resolve(makeDocument(documentCleanups[1])),
        destroy: loadingTaskDestroyMock,
      }));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as unknown as CanvasRenderingContext2D
    );

    const service = new PDFService();
    const firstFile = new File(["first"], "first-active-render.pdf", {
      type: "application/pdf",
    });
    const secondFile = new File(["second"], "second-active-render.pdf", {
      type: "application/pdf",
    });
    await Effect.runPromise(service.loadPDF(firstFile));
    await Effect.runPromise(service.loadPDF(secondFile));

    const fibers = [firstFile, secondFile].map((file) =>
      Effect.runFork(service.renderPage(file, 1, document.createElement("canvas")))
    );
    await vi.waitFor(() => expect(startedRenders).toBe(2));

    await Effect.runPromise(service.reset());

    expect(renderCancel).toHaveBeenCalledTimes(2);
    expect(documentCleanups[0]).toHaveBeenCalledTimes(1);
    expect(documentCleanups[1]).toHaveBeenCalledTimes(1);
    await Promise.all(fibers.map((fiber) => Effect.runPromise(Fiber.await(fiber))));
  });

  it("cleans up a page after PDF.js rendering fails", async () => {
    const renderError = new Error("render failed");
    pdfjsGetDocumentMock.mockImplementationOnce(() => ({
      promise: Promise.resolve({
        getPage: vi.fn().mockResolvedValue({
          getViewport: vi.fn().mockReturnValue({ width: 100, height: 200 }),
          cleanup: pageCleanupMock,
          render: vi.fn().mockReturnValue({
            promise: Promise.reject(renderError),
            cancel: renderCancelMock,
          }),
        }),
        cleanup: vi.fn().mockResolvedValue(undefined),
      }),
      destroy: loadingTaskDestroyMock,
    }));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as unknown as CanvasRenderingContext2D
    );

    const service = new PDFService();
    const file = new File(["plain"], "failed-render.pdf", { type: "application/pdf" });

    await expect(
      Effect.runPromise(service.renderPage(file, 1, document.createElement("canvas")))
    ).rejects.toThrow("render failed");
    expect(pageCleanupMock).toHaveBeenCalledTimes(1);
  });

  it("throws when the target canvas has no 2D context", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

    const service = new PDFService();
    const file = new File(["plain"], "test.pdf", { type: "application/pdf" });
    await Effect.runPromise(service.loadPDF(file));

    await expect(
      Effect.runPromise(service.renderPage(file, 1, document.createElement("canvas")))
    ).rejects.toThrow("Could not get canvas context");
    expect(pageCleanupMock).toHaveBeenCalledTimes(1);
  });

  it("resets cached documents and passwords for the session", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as unknown as CanvasRenderingContext2D
    );

    const service = new PDFService();
    const file = new File(["needs-password encrypted"], "protected.pdf", {
      type: "application/pdf",
    });

    await Effect.runPromise(service.loadPDFWithPassword(file, "623"));
    const firstCanvas = document.createElement("canvas");
    await Effect.runPromise(service.renderPage(file, 1, firstCanvas, 1, 0));

    await Effect.runPromise(service.reset());

    expect(service.getPageCount()).toBe(0);

    const secondCanvas = document.createElement("canvas");
    await expect(
      Effect.runPromise(service.renderPage(file, 1, secondCanvas, 1, 0))
    ).rejects.toBeInstanceOf(PDFPasswordRequiredError);
  });
});
