import { Deferred, Effect, Exit, Fiber } from "effect";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PDFProcessingError } from "../../types/interfaces";

const pdfServiceMock = vi.hoisted(() => ({
  preload: vi.fn(),
  loadPDF: vi.fn(),
  getPageCount: vi.fn(),
  getPassword: vi.fn(),
  releaseFile: vi.fn(),
  reset: vi.fn(),
  dispose: vi.fn(),
}));

const operationsServiceMock = vi.hoisted(() => ({
  buildPDF: vi.fn(),
  imagesToPDF: vi.fn(),
  releaseFile: vi.fn(),
  clearCache: vi.fn(),
  dispose: vi.fn(),
}));

const imageExportServiceMock = vi.hoisted(() => ({
  exportImages: vi.fn(),
}));

const qpdfProcessingMock = vi.hoisted(() => ({
  optimizeLosslessly: vi.fn(),
  close: vi.fn(),
}));

vi.mock("../pdf-service", () => ({
  PDFService: vi.fn(
    class {
      constructor() {
        Object.assign(this, pdfServiceMock);
      }
    }
  ),
}));
vi.mock("../pdf-operations-service", () => ({
  PDFOperationsService: vi.fn(
    class {
      constructor() {
        Object.assign(this, operationsServiceMock);
      }
    }
  ),
}));
vi.mock("../pdf-image-export-service", () => ({
  PDFImageExportService: vi.fn(
    class {
      constructor() {
        Object.assign(this, imageExportServiceMock);
      }
    }
  ),
}));
vi.mock("../qpdf-processing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../qpdf-processing")>();
  const { Effect, Layer } = await import("effect");
  return {
    ...actual,
    makeQpdfProcessingLayer: () =>
      Layer.effect(
        actual.QpdfProcessing,
        Effect.acquireRelease(Effect.succeed(qpdfProcessingMock), () =>
          Effect.sync(() => qpdfProcessingMock.close())
        )
      ),
  };
});

import { PDFImageExportService } from "../pdf-image-export-service";
import { PDFOperationsService } from "../pdf-operations-service";
import { makePDFRuntime, PDFProcessing, type PDFRuntime } from "../pdf-runtime";

let runtime: PDFRuntime;

beforeEach(() => {
  vi.resetAllMocks();
  pdfServiceMock.preload.mockReturnValue(Effect.void);
  pdfServiceMock.loadPDF.mockReturnValue(Effect.succeed(undefined));
  pdfServiceMock.getPageCount.mockReturnValue(0);
  pdfServiceMock.getPassword.mockReturnValue(undefined);
  pdfServiceMock.releaseFile.mockReturnValue(Effect.succeed(undefined));
  pdfServiceMock.reset.mockReturnValue(Effect.succeed(undefined));
  pdfServiceMock.dispose.mockReturnValue(Effect.void);
  operationsServiceMock.buildPDF.mockReturnValue(
    Effect.succeed({ data: new Uint8Array(), suggestedFileName: "document.pdf" })
  );
  operationsServiceMock.imagesToPDF.mockReturnValue(
    Effect.succeed({ data: new Uint8Array(), suggestedFileName: "interleaf-images.pdf" })
  );
  operationsServiceMock.releaseFile.mockReturnValue(Effect.succeed(undefined));
  operationsServiceMock.clearCache.mockReturnValue(Effect.succeed(undefined));
  operationsServiceMock.dispose.mockReturnValue(Effect.void);
  imageExportServiceMock.exportImages.mockReturnValue(
    Effect.succeed({ data: new Blob(), suggestedFileName: "document-images.zip" })
  );
  runtime = makePDFRuntime({ qpdfWorkerUrl: "/qpdf/qpdf-worker.js" });
});

afterEach(async () => {
  await runtime.dispose();
  vi.restoreAllMocks();
});

it("returns the active page count after loading a PDF", async () => {
  pdfServiceMock.getPageCount.mockReturnValue(7);
  const file = new File(["plain"], "document.pdf", { type: "application/pdf" });

  await runtime.runPromise(PDFProcessing.use((service) => service.loadPDF(file)));
  const count = await runtime.runPromise(PDFProcessing.use((service) => service.getPageCount));

  expect(count).toBe(7);
  expect(pdfServiceMock.loadPDF).toHaveBeenCalledExactlyOnceWith(file);
  expect(pdfServiceMock.reset).not.toHaveBeenCalled();
});

it("interrupts runtime-owned work before disposing services", async () => {
  const started = Deferred.makeUnsafe<void>();
  let interrupted = false;
  const fiber = runtime.runFork(
    PDFProcessing.use(() =>
      Deferred.succeed(started, undefined).pipe(
        Effect.andThen(Effect.never),
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            interrupted = true;
          })
        )
      )
    )
  );
  pdfServiceMock.dispose.mockImplementation(() =>
    Effect.sync(() => {
      expect(interrupted).toBe(true);
    })
  );

  await Effect.runPromise(Deferred.await(started));
  await runtime.dispose();

  expect(Exit.isFailure(await Effect.runPromise(Fiber.await(fiber)))).toBe(true);
  expect(pdfServiceMock.dispose).toHaveBeenCalledTimes(1);
});

it("shares lazy PDF editing support for the lifetime of the runtime", async () => {
  const files = [new File(["image"], "image.png", { type: "image/png" })];
  expect(PDFOperationsService).not.toHaveBeenCalled();

  await runtime.runPromise(PDFProcessing.use((service) => service.buildPDF([])));
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 2 * 60 * 60 * 1000);
  await runtime.runPromise(PDFProcessing.use((service) => service.imagesToPDF(files)));

  expect(PDFOperationsService).toHaveBeenCalledTimes(1);
  expect(operationsServiceMock.buildPDF).toHaveBeenCalledExactlyOnceWith([], undefined);
  expect(operationsServiceMock.imagesToPDF).toHaveBeenCalledExactlyOnceWith(files, undefined);

  await runtime.dispose();
  expect(operationsServiceMock.clearCache).toHaveBeenCalledTimes(1);
});

it("releases a file from each initialized service even when PDF.js cleanup fails", async () => {
  const file = new File(["plain"], "document.pdf", { type: "application/pdf" });
  await runtime.runPromise(PDFProcessing.use((service) => service.buildPDF([])));
  pdfServiceMock.releaseFile.mockReturnValueOnce(
    Effect.fail(
      new PDFProcessingError({
        operation: "cleanup-pdf-js",
        file,
        cause: new Error("cleanup failed"),
        message: "cleanup failed",
      })
    )
  );

  await expect(
    runtime.runPromise(PDFProcessing.use((service) => service.releaseFile(file)))
  ).rejects.toMatchObject({ operation: "cleanup-pdf-js", file });
  expect(pdfServiceMock.releaseFile).toHaveBeenCalledExactlyOnceWith(file);
  expect(operationsServiceMock.releaseFile).toHaveBeenCalledExactlyOnceWith(file);
});

it("shares lazy editing support across concurrent exports without serializing them", async () => {
  const release = Deferred.makeUnsafe<void>();
  operationsServiceMock.buildPDF.mockReturnValue(
    Deferred.await(release).pipe(
      Effect.as({ data: new Uint8Array(), suggestedFileName: "document.pdf" })
    )
  );

  const builds = Promise.all([
    runtime.runPromise(PDFProcessing.use((service) => service.buildPDF([]))),
    runtime.runPromise(PDFProcessing.use((service) => service.buildPDF([]))),
  ]);
  try {
    await vi.waitFor(() => expect(operationsServiceMock.buildPDF).toHaveBeenCalledTimes(2));
    expect(PDFOperationsService).toHaveBeenCalledTimes(1);
  } finally {
    await Effect.runPromise(Deferred.succeed(release, undefined));
    await builds;
  }
});

it("loads image export support only on first use", async () => {
  expect(PDFImageExportService).not.toHaveBeenCalled();

  await runtime.runPromise(PDFProcessing.use((service) => service.exportImages([])));
  await runtime.runPromise(PDFProcessing.use((service) => service.exportImages([])));

  expect(PDFImageExportService).toHaveBeenCalledTimes(1);
  expect(imageExportServiceMock.exportImages).toHaveBeenCalledTimes(2);
});

it("cleans loaded PDFs without initializing PDF editing support", async () => {
  const file = new File(["plain"], "document.pdf", { type: "application/pdf" });
  await runtime.runPromise(PDFProcessing.use((service) => service.loadPDF(file)));

  await runtime.dispose();

  expect(PDFOperationsService).not.toHaveBeenCalled();
  expect(operationsServiceMock.clearCache).not.toHaveBeenCalled();
  expect(pdfServiceMock.reset).toHaveBeenCalledTimes(1);
});

it("passes the unlocked source PDF to compression and closes qpdf on disposal", async () => {
  pdfServiceMock.getPassword.mockReturnValue("623");
  qpdfProcessingMock.optimizeLosslessly.mockReturnValue(
    Effect.succeed({
      data: new Uint8Array([4, 5]),
      inputBytes: 6,
      candidateBytes: 2,
      outputBytes: 2,
      reduced: true,
    })
  );
  const file = new File(["source"], "source.pdf", { type: "application/pdf" });

  await expect(
    runtime.runPromise(PDFProcessing.use((service) => service.compressPDF(file)))
  ).resolves.toMatchObject({
    inputBytes: 6,
    outputBytes: 2,
    suggestedFileName: "source-compressed.pdf",
  });
  expect(qpdfProcessingMock.optimizeLosslessly).toHaveBeenCalledExactlyOnceWith(
    new Uint8Array(await file.arrayBuffer()),
    "623"
  );

  await runtime.dispose();
  expect(qpdfProcessingMock.close).toHaveBeenCalledTimes(1);
});

it("can warm the PDF engine without opening a document or initializing export services", async () => {
  await runtime.runPromise(PDFProcessing.use((service) => service.preload));
  expect(pdfServiceMock.preload).toHaveBeenCalledOnce();
  expect(pdfServiceMock.loadPDF).not.toHaveBeenCalled();
  expect(PDFOperationsService).not.toHaveBeenCalled();
});
