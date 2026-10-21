import { Effect } from "effect";
import { unzipSync } from "fflate";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import worker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { answerField } from "../../../src/controllers/editor-field-state";
import { createPageStates, duplicatePageState } from "../../../src/controllers/editor-page-state";
import { inspectExport } from "../../../src/services/__tests__/pdf-export-inspection";
import { textFieldFixture } from "../../../src/services/__tests__/pdf-field-fixtures";
import { PDFImageExportService } from "../../../src/services/pdf-image-export-service";
import { PDFOperationsService } from "../../../src/services/pdf-operations-service";
import { PDFService } from "../../../src/services/pdf-service";

GlobalWorkerOptions.workerSrc = worker;
function hash(data: Uint8ClampedArray) {
  let hash = 2166136261;
  for (const value of data) hash = Math.imul(hash ^ value, 16777619);
  return hash >>> 0;
}
export async function inspectFilledPDF(bytes: number[], scale = 1) {
  const data = new Uint8Array(bytes);
  const native = await inspectExport(data);
  const task = getDocument({ data: data.slice() });
  try {
    const doc = await task.promise;
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n),
        viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const context = canvas.getContext("2d")!;
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const annotations = [];
      for (const annotation of await page.getAnnotations()) {
        const a = viewport.convertToViewportPoint(annotation.rect[0], annotation.rect[1]);
        const b = viewport.convertToViewportPoint(annotation.rect[2], annotation.rect[3]);
        const x = Math.max(0, Math.floor(Math.min(a[0], b[0]))),
          y = Math.max(0, Math.floor(Math.min(a[1], b[1])));
        const w = Math.max(1, Math.min(canvas.width - x, Math.ceil(Math.abs(b[0] - a[0])))),
          h = Math.max(1, Math.min(canvas.height - y, Math.ceil(Math.abs(b[1] - a[1]))));
        annotations.push({
          name: annotation.fieldName,
          type: annotation.fieldType,
          value: annotation.fieldValue,
          pixels: hash(context.getImageData(x, y, w, h).data),
        });
      }
      pages.push({
        annotations,
        pixels: hash(context.getImageData(0, 0, canvas.width, canvas.height).data),
        size: [canvas.width, canvas.height],
      });
      canvas.width = canvas.height = 0;
      page.cleanup();
    }
    return { native, pages };
  } finally {
    await task.destroy();
  }
}
export async function checkFilledFields(
  unit: number,
  sourceRotation: number,
  workspaceRotation: number
) {
  const fixture = await textFieldFixture({ unit, rotation: sourceRotation });
  const second = await textFieldFixture({
    unit,
    rotation: sourceRotation,
    value: "BOB",
    nullAttributes: false,
  });
  const file = new File([new Uint8Array(fixture.bytes)], "same.pdf", { type: "application/pdf" });
  const other = new File([new Uint8Array(second.bytes)], "same.pdf", { type: "application/pdf" });
  const service = new PDFService(),
    operations = new PDFOperationsService(service),
    images = new PDFImageExportService(service);
  try {
    await Effect.runPromise(service.loadPDF(file));
    await Effect.runPromise(service.loadPDF(other));
    const descriptors = await Effect.runPromise(operations.getFields(file));
    let originals = createPageStates(file, 2).map((page) => ({
      ...page,
      rotation: workspaceRotation,
    }));
    originals[1].markedForDeletion = true;
    await Effect.runPromise(
      operations.validateFieldAnswer(file, { fieldRef: fixture.fieldRef, value: "SAVED" }, [1, 2])
    );
    originals = answerField(originals, originals[0].id, fixture.fieldRef, "SAVED");
    const markedValue = originals[1].fieldAnswers?.[0].value;
    originals[1].markedForDeletion = false;
    const duplicate = duplicatePageState(originals[0]),
      again = duplicatePageState(duplicate);
    let pages = answerField(
      [
        ...originals,
        duplicate,
        again,
        ...createPageStates(other, 2).map((page) => ({ ...page, rotation: workspaceRotation })),
      ],
      duplicate.id,
      fixture.fieldRef,
      "COPY"
    );
    pages = answerField(pages, again.id, fixture.fieldRef, "THIRD");
    pages[0] = {
      ...pages[0],
      addedText: [{ id: "text", text: "Manual", fontSize: 10, x: 70, y: 80, rotation: 0 }],
      addedCheckmarks: [{ id: "tick", size: 12, x: 100, y: 120, rotation: 0 }],
    };
    const result = await Effect.runPromise(
      operations.buildPDF(pages, { selectedIndices: [1, 2, 3, 0, 4] })
    );
    // Export helpers and source services close before the independent reopen below.
    const baseline = await Effect.runPromise(
      operations.buildPDF(
        createPageStates(file, 2).map((page) => ({ ...page, rotation: workspaceRotation }))
      )
    );
    const geometry = await Effect.runPromise(service.getPageGeometry(file, 1));
    const canvas = document.createElement("canvas");
    const rotation = (sourceRotation + workspaceRotation) % 360;
    const renders = [];
    for (const scale of [0.2, 1]) {
      await Effect.runPromise(
        service.renderPageState(pages[0], canvas, scale, rotation, 4_000_000)
      );
      renders.push({
        scale,
        size: [canvas.width, canvas.height],
        pixels: hash(canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data),
      });
    }
    canvas.width = canvas.height = 0;
    const archive = await Effect.runPromise(images.exportImages([pages[0]]));
    const png = Object.values(unzipSync(new Uint8Array(await archive.data.arrayBuffer())))[0];
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(png)], { type: "image/png" }));
    const pngCanvas = document.createElement("canvas");
    pngCanvas.width = bitmap.width;
    pngCanvas.height = bitmap.height;
    pngCanvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pngResult = {
      size: [pngCanvas.width, pngCanvas.height],
      pixels: hash(
        pngCanvas.getContext("2d")!.getImageData(0, 0, pngCanvas.width, pngCanvas.height).data
      ),
    };
    pngCanvas.width = pngCanvas.height = 0;
    const originalValue = (await Effect.runPromise(operations.getFields(file))).widgets
      .filter((widget) => widget.fieldRef === fixture.fieldRef)
      .map((widget) => widget.value);
    await Effect.runPromise(operations.dispose());
    await Effect.runPromise(service.dispose());
    const independent = await inspectFilledPDF(Array.from(result.data));
    const references = [];
    for (const scale of [0.2, 1, 2]) {
      const inspected = await inspectFilledPDF(Array.from(result.data), scale);
      references.push({ scale, size: inspected.pages[3].size, pixels: inspected.pages[3].pixels });
    }
    const untouched = await inspectFilledPDF(Array.from(baseline.data));
    return {
      fieldRef: fixture.fieldRef,
      widgetRefs: fixture.widgetRefs,
      descriptors,
      markedValue,
      independent,
      untouched,
      renders,
      references,
      png: pngResult,
      bytes: Array.from(result.data),
      originalValue,
      geometry,
    };
  } finally {
    await Effect.runPromise(operations.dispose());
    await Effect.runPromise(service.dispose());
  }
}
