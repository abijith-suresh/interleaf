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

  it("deduplicates concurrent loads for the same file", async () => {
    const service = new PDFService();
    const file = new File(["plain"], "test.pdf", { type: "application/pdf" });

    await Promise.all([
      Effect.runPromise(service.loadPDF(file)),
      Effect.runPromise(service.loadPDF(file)),
    ]);

    expect(pdfjsGetDocumentMock).toHaveBeenCalledTimes(1);
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
    let resolveLoading!: (document: unknown) => void;
    const loadingPromise = new Promise((resolve) => {
      resolveLoading = resolve;
    });
    pdfjsGetDocumentMock.mockImplementationOnce(() => ({
      promise: loadingPromise,
      destroy: loadingTaskDestroyMock,
    }));

    const service = new PDFService();
    const file = new File(["plain"], "pending.pdf", { type: "application/pdf" });
    const fiber = Effect.runFork(service.loadPDF(file));

    await vi.waitFor(() => expect(pdfjsGetDocumentMock).toHaveBeenCalled());
    await Effect.runPromise(Fiber.interrupt(fiber));

    expect(loadingTaskDestroyMock).not.toHaveBeenCalled();
    await Effect.runPromise(service.reset());
    expect(loadingTaskDestroyMock).toHaveBeenCalledTimes(1);
    resolveLoading(undefined);
  });

  it("does not cache a PDF load that finishes after a targeted release", async () => {
    let resolveLoading!: (document: unknown) => void;
    const loadingPromise = new Promise((resolve) => {
      resolveLoading = resolve;
    });
    pdfjsGetDocumentMock.mockImplementationOnce(() => ({
      promise: loadingPromise,
      destroy: loadingTaskDestroyMock,
    }));

    const service = new PDFService();
    const file = new File(["plain"], "released-pending.pdf", { type: "application/pdf" });
    const fiber = Effect.runFork(service.loadPDF(file));

    await vi.waitFor(() => expect(pdfjsGetDocumentMock).toHaveBeenCalled());
    await Effect.runPromise(service.releaseFile(file));
    resolveLoading({
      numPages: 5,
      cleanup: vi.fn().mockResolvedValue(undefined),
    });
    await Effect.runPromise(Fiber.await(fiber));

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
    const loadingPromise = new Promise(() => undefined);
    pdfjsGetDocumentMock.mockImplementationOnce(() => ({
      promise: loadingPromise,
      destroy: loadingTaskDestroyMock,
    }));

    const service = new PDFService();
    const file = new File(["plain"], "reset-pending.pdf", { type: "application/pdf" });
    const fiber = Effect.runFork(service.loadPDF(file));

    await vi.waitFor(() => expect(pdfjsGetDocumentMock).toHaveBeenCalled());
    await Effect.runPromise(service.reset());
    await Effect.runPromise(Fiber.await(fiber));

    expect(loadingTaskDestroyMock).toHaveBeenCalledTimes(1);
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
  });

  it("reads the source page rotation for composed exports", async () => {
    const service = new PDFService();
    const file = new File(["rotated"], "rotated.pdf", { type: "application/pdf" });
    await Effect.runPromise(service.loadPDF(file));

    await expect(Effect.runPromise(service.getPageRotation(file, 1))).resolves.toBe(90);
  });

  it("cancels an in-flight PDF.js render when the fiber is interrupted", async () => {
    let renderStarted = false;
    let resolveRender!: () => void;
    const renderPromise = new Promise<void>((resolve) => {
      resolveRender = resolve;
    });
    pdfjsGetDocumentMock.mockImplementationOnce(() => ({
      promise: Promise.resolve({
        getPage: vi.fn().mockResolvedValue({
          getViewport: vi.fn().mockReturnValue({ width: 100, height: 200 }),
          render: vi.fn().mockImplementation(() => {
            renderStarted = true;
            return { promise: renderPromise, cancel: renderCancelMock };
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

    expect(renderCancelMock).toHaveBeenCalledTimes(1);
    resolveRender();
  });

  it("throws when the target canvas has no 2D context", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

    const service = new PDFService();
    const file = new File(["plain"], "test.pdf", { type: "application/pdf" });
    await Effect.runPromise(service.loadPDF(file));

    await expect(
      Effect.runPromise(service.renderPage(file, 1, document.createElement("canvas")))
    ).rejects.toThrow("Could not get canvas context");
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
