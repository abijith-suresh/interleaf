import { it } from "@effect/vitest";
import { Effect, Exit, Fiber } from "effect";
import { beforeEach, expect, vi } from "vitest";

const pdfServiceMock = vi.hoisted(() => ({
  loadPDF: vi.fn(),
  loadPDFWithPassword: vi.fn(),
  getPageCount: vi.fn(),
  getPassword: vi.fn(),
  getPageRotation: vi.fn(),
  renderPage: vi.fn(),
  reset: vi.fn(),
}));

const operationsServiceMock = vi.hoisted(() => ({
  buildPDF: vi.fn(),
  clearCache: vi.fn(),
  constructed: 0,
}));

const imageExportServiceMock = vi.hoisted(() => ({
  exportImages: vi.fn(),
  constructed: 0,
}));

const qpdfProcessingMock = vi.hoisted(() => ({
  optimizeLosslessly: vi.fn(),
  close: vi.fn(),
}));

vi.mock("../pdf-service", () => ({
  PDFService: class {
    loadPDF = pdfServiceMock.loadPDF;
    loadPDFWithPassword = pdfServiceMock.loadPDFWithPassword;
    getPageCount = pdfServiceMock.getPageCount;
    getPassword = pdfServiceMock.getPassword;
    getPageRotation = pdfServiceMock.getPageRotation;
    renderPage = pdfServiceMock.renderPage;
    reset = pdfServiceMock.reset;
  },
}));
vi.mock("../pdf-operations-service", () => ({
  PDFOperationsService: class {
    constructor() {
      operationsServiceMock.constructed += 1;
    }

    buildPDF = operationsServiceMock.buildPDF;
    clearCache = operationsServiceMock.clearCache;
  },
}));
vi.mock("../pdf-image-export-service", () => ({
  PDFImageExportService: class {
    constructor() {
      imageExportServiceMock.constructed += 1;
    }

    exportImages = imageExportServiceMock.exportImages;
  },
}));
vi.mock("../qpdf-processing", () => ({
  makeQpdfProcessing: () => qpdfProcessingMock,
}));

import { makePDFRuntime, PDFProcessing } from "../pdf-runtime";

beforeEach(() => {
  vi.clearAllMocks();
  pdfServiceMock.loadPDF.mockReturnValue(Effect.succeed(undefined));
  pdfServiceMock.loadPDFWithPassword.mockReturnValue(Effect.succeed(undefined));
  pdfServiceMock.getPageCount.mockReturnValue(0);
  pdfServiceMock.getPassword.mockReturnValue(undefined);
  pdfServiceMock.getPageRotation.mockReturnValue(Effect.succeed(0));
  pdfServiceMock.renderPage.mockReturnValue(Effect.succeed(undefined));
  pdfServiceMock.reset.mockReturnValue(Effect.succeed(undefined));
  operationsServiceMock.buildPDF.mockReturnValue(
    Effect.succeed({ data: new Uint8Array(), suggestedFileName: "document.pdf" })
  );
  operationsServiceMock.clearCache.mockReturnValue(Effect.succeed(undefined));
  operationsServiceMock.constructed = 0;
  imageExportServiceMock.exportImages.mockReturnValue(
    Effect.succeed({ data: new Blob(), suggestedFileName: "document-images.zip" })
  );
  imageExportServiceMock.constructed = 0;
});

it.effect("runs PDF processing through a scoped Effect v4 runtime", () => {
  pdfServiceMock.loadPDF.mockReturnValue(Effect.succeed(undefined));
  pdfServiceMock.getPageCount.mockReturnValue(7);
  pdfServiceMock.reset.mockReturnValue(Effect.succeed(undefined));
  operationsServiceMock.clearCache.mockReturnValue(Effect.succeed(undefined));

  return Effect.scoped(
    Effect.gen(function* () {
      const runtime = yield* Effect.acquireRelease(Effect.sync(makePDFRuntime), (managedRuntime) =>
        Effect.promise(() => managedRuntime.dispose())
      );
      const file = new File(["plain"], "document.pdf", { type: "application/pdf" });

      yield* Effect.tryPromise({
        try: () => runtime.runPromise(PDFProcessing.use((service) => service.loadPDF(file))),
        catch: (cause) => cause,
      });
      const pageCount = yield* Effect.tryPromise({
        try: () => runtime.runPromise(PDFProcessing.use((service) => service.getPageCount)),
        catch: (cause) => cause,
      });

      expect(pageCount).toBe(7);
      expect(pdfServiceMock.loadPDF).toHaveBeenCalledWith(file);
      expect(pdfServiceMock.reset).not.toHaveBeenCalled();
    })
  );
});

it.effect("interrupts all runtime-owned fibers before disposing services", () =>
  Effect.gen(function* () {
    const runtime = makePDFRuntime();
    const fiber = runtime.runFork(PDFProcessing.use(() => Effect.never));

    yield* Effect.promise(() => runtime.dispose());

    const exit = yield* Fiber.await(fiber);
    expect(Exit.isFailure(exit)).toBe(true);
  })
);

it.effect("loads PDF editing support only when building a document", () => {
  return Effect.tryPromise({
    try: async () => {
      const runtime = makePDFRuntime();

      expect(operationsServiceMock.constructed).toBe(0);
      await runtime.runPromise(PDFProcessing.use((service) => service.buildPDF([])));
      expect(operationsServiceMock.constructed).toBe(1);
      expect(operationsServiceMock.buildPDF).toHaveBeenCalledWith([], undefined);

      await runtime.dispose();
      expect(operationsServiceMock.clearCache).toHaveBeenCalledTimes(1);
    },
    catch: (cause) => cause,
  });
});

it.effect("shares lazy PDF editing support across concurrent exports", () => {
  let activeBuilds = 0;
  let maximumActiveBuilds = 0;
  operationsServiceMock.buildPDF.mockImplementation(() =>
    Effect.promise(
      () =>
        new Promise((resolve) => {
          activeBuilds += 1;
          maximumActiveBuilds = Math.max(maximumActiveBuilds, activeBuilds);
          setTimeout(() => {
            activeBuilds -= 1;
            resolve({ data: new Uint8Array(), suggestedFileName: "document.pdf" });
          }, 0);
        })
    )
  );

  return Effect.tryPromise({
    try: async () => {
      const runtime = makePDFRuntime();

      await Promise.all([
        runtime.runPromise(PDFProcessing.use((service) => service.buildPDF([]))),
        runtime.runPromise(PDFProcessing.use((service) => service.buildPDF([]))),
      ]);

      expect(operationsServiceMock.constructed).toBe(1);
      expect(operationsServiceMock.buildPDF).toHaveBeenCalledTimes(2);
      expect(maximumActiveBuilds).toBe(2);

      await runtime.dispose();
    },
    catch: (cause) => cause,
  });
});

it.effect("loads image export support only when exporting pages", () => {
  return Effect.tryPromise({
    try: async () => {
      const runtime = makePDFRuntime();

      expect(imageExportServiceMock.constructed).toBe(0);
      await runtime.runPromise(PDFProcessing.use((service) => service.exportImages([])));
      expect(imageExportServiceMock.constructed).toBe(1);
      expect(imageExportServiceMock.exportImages).toHaveBeenCalledWith([], undefined);

      await runtime.dispose();
    },
    catch: (cause) => cause,
  });
});

it.effect("does not load PDF editing support during runtime cleanup", () => {
  return Effect.tryPromise({
    try: async () => {
      const runtime = makePDFRuntime();
      const file = new File(["plain"], "document.pdf", { type: "application/pdf" });

      await runtime.runPromise(PDFProcessing.use((service) => service.loadPDF(file)));

      await runtime.dispose();

      expect(operationsServiceMock.constructed).toBe(0);
      expect(operationsServiceMock.clearCache).not.toHaveBeenCalled();
      expect(pdfServiceMock.reset).toHaveBeenCalledTimes(1);
    },
    catch: (cause) => cause,
  });
});

it.effect("passes the unlocked source PDF to lossless compression", () => {
  vi.clearAllMocks();
  pdfServiceMock.getPassword.mockReturnValue("623");
  pdfServiceMock.reset.mockReturnValue(Effect.succeed(undefined));
  operationsServiceMock.clearCache.mockReturnValue(Effect.succeed(undefined));
  qpdfProcessingMock.optimizeLosslessly.mockReturnValue(
    Effect.succeed({
      data: new Uint8Array([4, 5]),
      inputBytes: 6,
      candidateBytes: 2,
      outputBytes: 2,
      reduced: true,
    })
  );

  return Effect.tryPromise({
    try: async () => {
      const runtime = makePDFRuntime({ qpdfWorkerUrl: "/qpdf/qpdf-worker.js" });
      const file = new File(["source"], "source.pdf", { type: "application/pdf" });

      await expect(
        runtime.runPromise(PDFProcessing.use((service) => service.compressPDF(file)))
      ).resolves.toMatchObject({
        inputBytes: 6,
        outputBytes: 2,
        suggestedFileName: "source-compressed.pdf",
      });
      expect(qpdfProcessingMock.optimizeLosslessly).toHaveBeenCalledWith(
        new Uint8Array(await file.arrayBuffer()),
        "623"
      );

      await runtime.dispose();
      expect(qpdfProcessingMock.close).toHaveBeenCalledTimes(1);
    },
    catch: (cause) => cause,
  });
});
