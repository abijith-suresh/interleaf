import { Effect } from "effect";
import { GlobalWorkerOptions, getDocument, OPS } from "pdfjs-dist";
import worker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { inspectExport } from "../../../src/services/__tests__/pdf-export-inspection";
import { PageRenderer } from "../../../src/services/page-renderer";
import { PDFService } from "../../../src/services/pdf-service";
import encoded from "./field-raster-yield.b64?raw";

GlobalWorkerOptions.workerSrc = worker;

function snapshot(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d")!;
  return {
    pixels: Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data),
    checkbox: Array.from(context.getImageData(103, 57, 10, 10).data),
    attributes: context.getContextAttributes(),
  };
}

export async function checkRasterYield() {
  // Synthetic completed one-page input captured by the CI mismatch observer.
  // Its last widget is a checked vector checkbox, following a read-only text field.
  const bytes = Uint8Array.from(atob(encoded.trim()), (c) => c.charCodeAt(0));
  const file = new File([bytes], "raster-yield.pdf", { type: "application/pdf" });
  const task = getDocument({ data: bytes.slice() });
  const service = new PDFService();
  const original = PageRenderer.prototype.render;
  try {
    const page = await (await task.promise).getPage(1);
    const viewport = page.getViewport({ scale: 0.2, rotation: 180 });
    const referenceCanvas = document.createElement("canvas");
    referenceCanvas.width = viewport.width;
    referenceCanvas.height = viewport.height;
    const context = referenceCanvas.getContext("2d", { willReadFrequently: true })!;
    await page.render({ canvas: referenceCanvas, canvasContext: context, viewport }).promise;
    const reference = snapshot(referenceCanvas);
    referenceCanvas.width = referenceCanvas.height = 0;
    const native = await inspectExport(bytes);
    await Effect.runPromise(service.loadPDF(file));

    const results = [];
    for (const mode of ["held", "held-cpu", "unheld"] as const) {
      const executed = new Set<number>(),
        continuations: number[] = [];
      let last = -1,
        operatorCount = 0,
        boundary: number[] = [],
        restored = false;
      PageRenderer.prototype.render = function (...args) {
        if (args[0] !== file) return original.apply(this, args);
        const [, sourcePage] = args;
        const render = sourcePage.render;
        sourcePage.render = function (options) {
          const renderTask = render.call(this, {
            ...options,
            operationsFilter(index, list) {
              executed.add(index);
              last = index;
              operatorCount = list.fnArray.length;
              boundary = [list.fnArray[120], list.fnArray[125]];
              if (mode !== "unheld" && index === 120) {
                // Exceed PDF.js's execution slice with real elapsed time. This
                // yields before the checkbox; no clock or product timing changes.
                const until = performance.now() + 35;
                while (performance.now() < until) {
                  /* test-only held operator */
                }
              }
              return true;
            },
          });
          renderTask.onContinue = (resume: () => void) => {
            continuations.push(last + 1);
            resume();
          };
          return renderTask;
        };
        return original.apply(this, args).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              sourcePage.render = render;
              restored = sourcePage.render === render;
            })
          )
        );
      };
      const canvas = document.createElement("canvas");
      if (mode === "held-cpu") canvas.getContext("2d", { willReadFrequently: true });
      try {
        await Effect.runPromise(service.renderPage(file, 1, canvas, 0.2, 180));
        const image = snapshot(canvas);
        const context = canvas.getContext("2d")!;
        context.clearRect(0, 0, 1, 1);
        results.push({
          mode,
          ...image,
          clearedAlpha: context.getImageData(0, 0, 1, 1).data[3],
          executed: [...executed],
          continuations,
          operatorCount,
          boundary,
          restored,
        });
      } finally {
        PageRenderer.prototype.render = original;
        canvas.width = canvas.height = 0;
      }
    }
    const after = new Uint8Array(await file.arrayBuffer());
    return {
      reference,
      results,
      native,
      expectedBoundary: [OPS.endText, OPS.beginAnnotation],
      sourceUnchanged:
        bytes.length === after.length && bytes.every((value, index) => value === after[index]),
      observerRestored: PageRenderer.prototype.render === original,
    };
  } finally {
    PageRenderer.prototype.render = original;
    await task.destroy();
    await Effect.runPromise(service.dispose());
  }
}
