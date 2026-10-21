import { Effect } from "effect";
import { unzipSync } from "fflate";
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
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
interface PixelEvidence {
  image?: ImageData;
  fontStatus?: string;
}
interface RenderResult {
  scale: number;
  size: number[];
  pixels: number;
}
function retain(image: ImageData, evidence: PixelEvidence) {
  evidence.image = new ImageData(image.data.slice(), image.width, image.height);
  evidence.fontStatus = document.fonts.status;
}
function encode(image: ImageData) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d")!.putImageData(image, 0, 0);
  const png = canvas.toDataURL("image/png");
  canvas.width = canvas.height = 0;
  let raw = "";
  for (let offset = 0; offset < image.data.length; offset += 32768)
    raw += String.fromCharCode(...image.data.subarray(offset, offset + 32768));
  return { png, rgba: btoa(raw), width: image.width, height: image.height };
}
async function nativePage(bytes: Uint8Array, index: number) {
  const doc = await PDFDocument.load(bytes),
    page = doc.getPage(index),
    N = PDFName.of;
  const bounds = (object: unknown) =>
    object instanceof PDFRawStream
      ? {
          bbox: object.dict.lookup(N("BBox"))?.toString(),
          matrix: object.dict.lookup(N("Matrix"))?.toString(),
          resources: object.dict.lookup(N("Resources"))?.toString(),
        }
      : undefined;
  const appearances = (page.node.Annots()?.asArray() ?? []).map((raw) => {
    const widget = doc.context.lookup(raw, PDFDict),
      ap = widget.lookupMaybe(N("AP"), PDFDict);
    return ap?.entries().map(([key, raw]) => {
      const object = doc.context.lookup(raw);
      return {
        key: key.toString(),
        bounds: bounds(object),
        states:
          object instanceof PDFDict
            ? object.entries().map(([state, item]) => ({
                state: state.toString(),
                bounds: bounds(doc.context.lookup(item)),
              }))
            : undefined,
      };
    });
  });
  return {
    page: index + 1,
    media: page.getMediaBox(),
    crop: page.getCropBox(),
    rotation: page.getRotation(),
    unit: page.node.lookup(N("UserUnit"))?.toString(),
    appearances,
    native: (await inspectExport(bytes)).pages[index],
  };
}
export async function inspectFilledPDF(bytes: number[], scale = 1, evidence?: PixelEvidence) {
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
      const context = canvas.getContext("2d", { willReadFrequently: true })!;
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
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      if (evidence && n === 4) retain(image, evidence);
      pages.push({
        annotations,
        pixels: hash(image.data),
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
    const renders: RenderResult[] = [];
    const generatedEvidence: PixelEvidence[] = [],
      referenceEvidence: PixelEvidence[] = [];
    const derivedDocuments = new Map<number, Uint8Array>();
    async function captureDerived<T>(scale: number, run: () => Promise<T>): Promise<T> {
      const original = PDFOperationsService.prototype.buildPDF;
      // Observe the actual private build used by this render, without replacing
      // its result or rendering again. Each test owns an isolated browser page.
      PDFOperationsService.prototype.buildPDF = function (
        this: PDFOperationsService,
        ...args: Parameters<PDFOperationsService["buildPDF"]>
      ) {
        return original.apply(this, args).pipe(
          Effect.map((result) => {
            if (
              args[0].length === 1 &&
              args[0][0].sourceFile === file &&
              args[0][0].sourcePageNumber === 1
            )
              derivedDocuments.set(scale, result.data.slice());
            return result;
          })
        );
      };
      try {
        return await run();
      } finally {
        PDFOperationsService.prototype.buildPDF = original;
      }
    }
    for (const scale of [0.2, 1]) {
      await captureDerived(scale, () =>
        Effect.runPromise(service.renderPageState(pages[0], canvas, scale, rotation, 4_000_000))
      );
      const image = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height),
        evidence: PixelEvidence = {};
      retain(image, evidence);
      generatedEvidence.push(evidence);
      renders.push({
        scale,
        size: [canvas.width, canvas.height],
        pixels: hash(image.data),
      });
    }
    canvas.width = canvas.height = 0;
    const archive = await captureDerived(2, () =>
      Effect.runPromise(images.exportImages([pages[0]]))
    );
    const png = Object.values(unzipSync(new Uint8Array(await archive.data.arrayBuffer())))[0];
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(png)], { type: "image/png" }));
    const pngCanvas = document.createElement("canvas");
    pngCanvas.width = bitmap.width;
    pngCanvas.height = bitmap.height;
    pngCanvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pngImage = pngCanvas
        .getContext("2d")!
        .getImageData(0, 0, pngCanvas.width, pngCanvas.height),
      pngEvidence: PixelEvidence = {};
    retain(pngImage, pngEvidence);
    generatedEvidence.push(pngEvidence);
    const pngResult = {
      size: [pngCanvas.width, pngCanvas.height],
      pixels: hash(pngImage.data),
    };
    pngCanvas.width = pngCanvas.height = 0;
    const originalValue = (await Effect.runPromise(operations.getFields(file))).widgets
      .filter((widget) => widget.fieldRef === fixture.fieldRef)
      .map((widget) => widget.value);
    await Effect.runPromise(operations.dispose());
    await Effect.runPromise(service.dispose());
    const independent = await inspectFilledPDF(Array.from(result.data));
    const references: RenderResult[] = [];
    for (const scale of [0.2, 1, 2]) {
      const evidence: PixelEvidence = {};
      const inspected = await inspectFilledPDF(Array.from(result.data), scale, evidence);
      referenceEvidence.push(evidence);
      references.push({ scale, size: inspected.pages[3].size, pixels: inspected.pages[3].pixels });
    }
    const untouched = await inspectFilledPDF(Array.from(baseline.data));
    const actual = [...renders, { ...pngResult, scale: 2 }];
    const mismatches = actual.flatMap((render, index) => {
      const reference = references[index];
      return render.scale === reference.scale &&
        render.pixels === reference.pixels &&
        JSON.stringify(render.size) === JSON.stringify(reference.size)
        ? []
        : [index];
    });
    // Preserve original buffers before canvas cleanup; encode only a failed pair,
    // after every comparison render and source lifetime has already completed.
    const diagnostics = mismatches.length
      ? {
          sourceBytes: [Array.from(fixture.bytes), Array.from(second.bytes)],
          completedBytes: Array.from(result.data),
          completedNative: await nativePage(result.data, 3),
          geometry,
          unit,
          sourceRotation,
          workspaceRotation,
          userAgent: navigator.userAgent,
          devicePixelRatio,
          pairs: await Promise.all(
            mismatches.map(async (index) => {
              const derived = derivedDocuments.get(actual[index].scale);
              return {
                actual: actual[index],
                reference: references[index],
                actualImage: encode(generatedEvidence[index].image!),
                referenceImage: encode(referenceEvidence[index].image!),
                actualFontStatus: generatedEvidence[index].fontStatus,
                referenceFontStatus: referenceEvidence[index].fontStatus,
                renderOptions: {
                  sourcePage: 1,
                  outputPage: 4,
                  scale: actual[index].scale,
                  rotation,
                  maxRasterPixels: index < 2 ? 4_000_000 : undefined,
                },
                derivedBytes: derived ? Array.from(derived) : undefined,
                derivedNative: derived ? await nativePage(derived, 0) : undefined,
              };
            })
          ),
        }
      : undefined;
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
      diagnostics,
    };
  } finally {
    await Effect.runPromise(operations.dispose());
    await Effect.runPromise(service.dispose());
  }
}
