import { it } from "@effect/vitest";
import { Effect, Exit, Fiber } from "effect";
import { expect, vi } from "vitest";

const pdfServiceMock = vi.hoisted(() => ({
  loadPDF: vi.fn(),
  loadPDFWithPassword: vi.fn(),
  getPageCount: vi.fn(),
  renderPage: vi.fn(),
  reset: vi.fn(),
}));

const operationsServiceMock = vi.hoisted(() => ({
  buildPDF: vi.fn(),
  clearCache: vi.fn(),
}));

vi.mock("../pdf-service", () => ({
  PDFService: class {
    loadPDF = pdfServiceMock.loadPDF;
    loadPDFWithPassword = pdfServiceMock.loadPDFWithPassword;
    getPageCount = pdfServiceMock.getPageCount;
    renderPage = pdfServiceMock.renderPage;
    reset = pdfServiceMock.reset;
  },
}));
vi.mock("../pdf-operations-service", () => ({
  PDFOperationsService: class {
    buildPDF = operationsServiceMock.buildPDF;
    clearCache = operationsServiceMock.clearCache;
  },
}));

import { makePDFRuntime, PDFProcessing } from "../pdf-runtime";

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
