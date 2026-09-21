import { Context, Effect, Exit, Fiber, Layer, ManagedRuntime } from "effect";
import type {
  PageState,
  PDFCompressionResult,
  PDFError,
  PDFImageExportResult,
  PDFOperationResult,
} from "../types/interfaces";
import { PDFProcessingError } from "../types/interfaces";
import {
  type PDFCompressionError,
  type PDFCompressionOptions,
  PDFCompressionService,
} from "./pdf-compression-service";
import type { PDFImageExportOptions } from "./pdf-image-export-service";
import type {
  PDFBuildOptions,
  PDFImagesToPDFOptions,
  PDFOperationsService,
} from "./pdf-operations-service";
import { PDFService } from "./pdf-service";
import { makeQpdfProcessing, type QpdfProcessingError } from "./qpdf-processing";

export interface PDFProcessingShape {
  readonly loadPDF: (file: File) => Effect.Effect<void, PDFError>;
  readonly loadPDFWithPassword: (file: File, password: string) => Effect.Effect<void, PDFError>;
  readonly getPageCount: Effect.Effect<number>;
  readonly renderPage: (
    file: File,
    pageNumber: number,
    canvas: HTMLCanvasElement,
    scale?: number,
    rotation?: number
  ) => Effect.Effect<void, PDFError>;
  readonly getPageRotation: (file: File, pageNumber: number) => Effect.Effect<number, PDFError>;
  readonly getPageSize: (
    file: File,
    pageNumber: number,
    rotation?: number
  ) => Effect.Effect<{ readonly width: number; readonly height: number }, PDFError>;
  readonly buildPDF: (
    pages: readonly PageState[],
    options?: PDFBuildOptions
  ) => Effect.Effect<PDFOperationResult, PDFError>;
  readonly imagesToPDF: (
    files: readonly File[],
    options?: PDFImagesToPDFOptions
  ) => Effect.Effect<PDFOperationResult, PDFProcessingError>;
  readonly exportImages: (
    pages: readonly PageState[],
    options?: PDFImageExportOptions
  ) => Effect.Effect<PDFImageExportResult, PDFError>;
  readonly compressPDF: (
    file: File,
    options?: PDFCompressionOptions
  ) => Effect.Effect<PDFCompressionResult, PDFError | QpdfProcessingError | PDFCompressionError>;
  readonly releaseFile: (file: File) => Effect.Effect<void>;
  readonly reset: Effect.Effect<void>;
  readonly clearCache: Effect.Effect<void>;
}

export class PDFProcessing extends Context.Service<PDFProcessing, PDFProcessingShape>()(
  "interleaf/PDFProcessing"
) {}

export interface PDFRuntime {
  readonly runFork: <A, E>(
    effect: Effect.Effect<A, E, PDFProcessing>,
    options?: Effect.RunOptions
  ) => Fiber.Fiber<A, E>;
  readonly runPromise: <A, E>(
    effect: Effect.Effect<A, E, PDFProcessing>,
    options?: Effect.RunOptions
  ) => Promise<A>;
  readonly dispose: () => Promise<void>;
}

export interface PDFRuntimeOptions {
  readonly qpdfWorkerUrl?: string | URL;
}

export function makePDFRuntime(options: PDFRuntimeOptions = {}): PDFRuntime {
  const live = Layer.effect(
    PDFProcessing,
    Effect.acquireRelease(
      Effect.gen(function* () {
        const pdfService = new PDFService();
        let operationsService: PDFOperationsService | undefined;
        const getOperationsService = yield* Effect.cached(
          Effect.tryPromise({
            try: async () => {
              const { PDFOperationsService } = await import("./pdf-operations-service");
              const service = new PDFOperationsService(pdfService);
              operationsService = service;
              return service;
            },
            catch: (cause) =>
              new PDFProcessingError({
                operation: "load-pdf-operations",
                cause,
                message:
                  cause instanceof Error && cause.message
                    ? cause.message
                    : "Could not load PDF editing support.",
              }),
          })
        );
        const getImageExportService = yield* Effect.cachedWithTTL(
          Effect.tryPromise({
            try: async () => {
              const { PDFImageExportService } = await import("./pdf-image-export-service");
              const service = new PDFImageExportService(pdfService);
              return service;
            },
            catch: (cause) =>
              new PDFProcessingError({
                operation: "load-pdf-image-export",
                cause,
                message:
                  cause instanceof Error && cause.message
                    ? cause.message
                    : "Could not load PDF image export support.",
              }),
          }),
          (exit) => (Exit.isSuccess(exit) ? "1 hour" : 0)
        );
        const qpdfProcessing = makeQpdfProcessing({
          workerUrl: options.qpdfWorkerUrl ?? `${import.meta.env.BASE_URL}qpdf/qpdf-worker.js`,
        });
        const compressionService = new PDFCompressionService(qpdfProcessing);

        const service: PDFProcessingShape & { readonly closeQpdf: () => void } = {
          loadPDF: (file: File) => pdfService.loadPDF(file),
          loadPDFWithPassword: (file: File, password: string) =>
            pdfService.loadPDFWithPassword(file, password),
          getPageCount: Effect.sync(() => pdfService.getPageCount()),
          renderPage: (
            file: File,
            pageNumber: number,
            canvas: HTMLCanvasElement,
            scale?: number,
            rotation?: number
          ) => pdfService.renderPage(file, pageNumber, canvas, scale, rotation),
          getPageRotation: (file: File, pageNumber: number) =>
            pdfService.getPageRotation(file, pageNumber),
          getPageSize: (file: File, pageNumber: number, rotation?: number) =>
            pdfService.getPageSize(file, pageNumber, rotation),
          buildPDF: (pages: readonly PageState[], options?: PDFBuildOptions) =>
            Effect.flatMap(getOperationsService, (service) => service.buildPDF(pages, options)),
          imagesToPDF: (files: readonly File[], options?: PDFImagesToPDFOptions) =>
            Effect.flatMap(getOperationsService, (service) => service.imagesToPDF(files, options)),
          exportImages: (pages: readonly PageState[], options?: PDFImageExportOptions) =>
            Effect.flatMap(getImageExportService, (service) =>
              service.exportImages(pages, options)
            ),
          compressPDF: (file: File, options?: PDFCompressionOptions) =>
            compressionService.compressPDF(file, pdfService.getPassword(file), options),
          releaseFile: (file: File) =>
            Effect.gen(function* () {
              yield* pdfService.releaseFile(file);
              if (operationsService) {
                yield* operationsService.releaseFile(file);
              }
            }),
          reset: Effect.suspend(() => pdfService.reset()),
          clearCache: Effect.suspend(() => operationsService?.clearCache() ?? Effect.void),
          closeQpdf: qpdfProcessing.close,
        };

        return service;
      }),
      (service) =>
        Effect.gen(function* () {
          yield* service.reset;
          yield* service.clearCache;
          service.closeQpdf();
        })
    )
  );

  const managedRuntime = ManagedRuntime.make(live);
  const fibers = new Set<Fiber.Fiber<unknown, unknown>>();
  let disposed = false;
  let disposePromise: Promise<void> | undefined;

  return {
    runFork<A, E>(effect: Effect.Effect<A, E, PDFProcessing>, options?: Effect.RunOptions) {
      if (disposed) {
        throw new Error("PDF runtime has been disposed");
      }

      const fiber = managedRuntime.runFork(effect, options);
      const trackedFiber = fiber as Fiber.Fiber<unknown, unknown>;
      fibers.add(trackedFiber);
      fiber.addObserver(() => {
        fibers.delete(trackedFiber);
      });
      return fiber;
    },
    runPromise<A, E>(effect: Effect.Effect<A, E, PDFProcessing>, options?: Effect.RunOptions) {
      return managedRuntime.runPromise(effect, options);
    },
    dispose() {
      if (disposePromise) return disposePromise;

      disposed = true;
      disposePromise = (async () => {
        const activeFibers = Array.from(fibers);
        if (activeFibers.length > 0) {
          await managedRuntime.runPromise(
            Effect.forEach(activeFibers, Fiber.interrupt, { discard: true })
          );
        }
        await managedRuntime.dispose();
      })();

      return disposePromise;
    },
  };
}
