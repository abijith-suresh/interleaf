import { Context, Effect, Fiber, Layer, ManagedRuntime } from "effect";
import type {
  PageState,
  PDFCompressionResult,
  PDFError,
  PDFOperationResult,
} from "../types/interfaces";
import {
  type PDFCompressionError,
  type PDFCompressionOptions,
  PDFCompressionService,
} from "./pdf-compression-service";
import { type PDFBuildOptions, PDFOperationsService } from "./pdf-operations-service";
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
  readonly buildPDF: (
    pages: readonly PageState[],
    options?: PDFBuildOptions
  ) => Effect.Effect<PDFOperationResult, PDFError>;
  readonly compressPDF: (
    pages: readonly PageState[],
    options?: PDFCompressionOptions
  ) => Effect.Effect<PDFCompressionResult, PDFError | QpdfProcessingError | PDFCompressionError>;
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
      Effect.sync(() => {
        const pdfService = new PDFService();
        const operationsService = new PDFOperationsService(pdfService);
        const qpdfProcessing = makeQpdfProcessing({
          workerUrl: options.qpdfWorkerUrl ?? `${import.meta.env.BASE_URL}qpdf/qpdf-worker.js`,
        });
        const compressionService = new PDFCompressionService(operationsService, qpdfProcessing);

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
          buildPDF: (pages: readonly PageState[], options?: PDFBuildOptions) =>
            operationsService.buildPDF(pages, options),
          compressPDF: (pages: readonly PageState[], options?: PDFCompressionOptions) =>
            compressionService.compressPDF(pages, options),
          reset: Effect.suspend(() => pdfService.reset()),
          clearCache: Effect.suspend(() => operationsService.clearCache()),
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
