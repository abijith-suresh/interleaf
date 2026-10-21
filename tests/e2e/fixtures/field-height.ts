import { Effect } from "effect";
import { unzipSync } from "fflate";
import { PDFDocument, PDFName, StandardFontEmbedder, StandardFonts } from "pdf-lib";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import worker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { createPageStates } from "../../../src/controllers/editor-page-state";
import { PDFImageExportService } from "../../../src/services/pdf-image-export-service";
import { PDFOperationsService } from "../../../src/services/pdf-operations-service";
import { PDFService } from "../../../src/services/pdf-service";
import shortSource from "./field-short.b64?raw";
import { inspectFilledPDF } from "./filled-fields";

GlobalWorkerOptions.workerSrc = worker;
const decode = () => Uint8Array.from(atob(shortSource.trim()), (c) => c.charCodeAt(0));
const text = "gjpqyQ{}[]()|_";
function pixels(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d");
  if (!context) throw Error("Missing canvas context");
  return Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data);
}
async function render(bytes: Uint8Array) {
  const task = getDocument({ data: bytes.slice() });
  try {
    const doc = await task.promise,
      page = await doc.getPage(1),
      viewport = page.getViewport({ scale: 4 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw Error("Missing canvas context");
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    // Exclude the border; compare the complete ink envelope with an unclipped reference.
    const rgba = context.getImageData(86, 40, 540, 200).data;
    let color = 2166136261;
    for (const component of rgba) color = Math.imul(color ^ component, 16777619);
    let left = 540,
      right = -1,
      top = 200,
      bottom = -1,
      ink = 0,
      mask = 2166136261;
    for (let y = 0; y < 200; y++)
      for (let x = 0; x < 540; x++) {
        const i = (y * 540 + x) * 4;
        mask = Math.imul(mask ^ (rgba[i] < 128 ? 1 : 0), 16777619);
        if (rgba[i] < 128 && rgba[i + 1] < 128 && rgba[i + 2] < 128) {
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
          ink++;
        }
      }
    return {
      all: pixels(canvas),
      ink,
      mask: mask >>> 0,
      color: color >>> 0,
      bounds: [left, top, right, bottom],
    };
  } finally {
    await task.destroy();
  }
}
export async function checkFieldHeight(height: number) {
  const base = await PDFDocument.load(decode());
  const field = base.getForm().getTextField("Name"),
    widget = field.acroField.getWidgets()[0];
  widget.setRectangle({ x: 20, y: 50, width: 140, height });
  widget.getAppearanceCharacteristics()!.setBorderColor([1, 1, 1]);
  field.setText("");
  field.updateAppearances(await base.embedFont(StandardFonts.Helvetica));
  const source = await base.save({ updateFieldAppearances: false });
  const file = new File([new Uint8Array(source)], "height.pdf");
  const service = new PDFService(),
    operations = new PDFOperationsService(service),
    images = new PDFImageExportService(service);
  const states = createPageStates(file, 1);
  states[0].fieldAnswers = [{ fieldRef: field.ref.toString(), value: text }];
  let saved: Uint8Array, pngPixels: number[], viewerPixels: number[], thumbnailPixels: number[];
  try {
    await Effect.runPromise(service.loadPDF(file));
    await Effect.runPromise(operations.validateFieldAnswer(file, states[0].fieldAnswers[0], [1]));
    saved = (await Effect.runPromise(operations.buildPDF(states))).data;
    const png = await Effect.runPromise(images.exportImages(states));
    const entry = Object.values(unzipSync(new Uint8Array(await png.data.arrayBuffer())))[0];
    const bitmap = await createImageBitmap(
      new Blob([new Uint8Array(entry)], { type: "image/png" })
    );
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    bitmap.close();
    pngPixels = pixels(canvas);
    for (const kind of ["viewer", "thumbnail"]) {
      const generated = document.createElement("canvas");
      await Effect.runPromise(service.renderPageState(states[0], generated, 4, 0, 4_000_000));
      if (kind === "viewer") viewerPixels = pixels(generated);
      else thumbnailPixels = pixels(generated);
    }
  } finally {
    await Effect.runPromise(operations.dispose());
    await Effect.runPromise(service.dispose());
  }
  const reference = await PDFDocument.load(source),
    page = reference.getPage(0);
  // No annotation/AP clipping in the reference: ordinary page text at the expected baseline.
  page.node.delete(PDFName.of("Annots"));
  reference.catalog.delete(PDFName.of("AcroForm"));
  const font = await reference.embedFont(StandardFonts.Helvetica),
    bounds = StandardFontEmbedder.for("Helvetica" as Parameters<typeof StandardFontEmbedder.for>[0])
      .font.FontBBox;
  const baseline = 52 + (height - 4 - (bounds[3] - bounds[1]) * 0.012) / 2 - bounds[1] * 0.012;
  page.drawText(text, { font, size: 12, x: 22, y: baseline });
  const expected = await render(await reference.save()),
    actual = await render(saved);
  const pngTask = getDocument({ data: saved.slice() });
  let pngReference: number[];
  try {
    const page = await (await pngTask.promise).getPage(1),
      viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const canvasContext = canvas.getContext("2d", { willReadFrequently: true })!;
    await page.render({ canvas, canvasContext, viewport }).promise;
    pngReference = pixels(canvas);
  } finally {
    await pngTask.destroy();
  }
  // Every handle is closed before the independent value/type inspection.
  return {
    actual: { ink: actual.ink, mask: actual.mask, color: actual.color, bounds: actual.bounds },
    expected: {
      ink: expected.ink,
      mask: expected.mask,
      color: expected.color,
      bounds: expected.bounds,
    },
    viewerMatches: JSON.stringify(viewerPixels!) === JSON.stringify(actual.all),
    thumbnailMatches: JSON.stringify(thumbnailPixels!) === JSON.stringify(actual.all),
    pngMatches: JSON.stringify(pngPixels!) === JSON.stringify(pngReference),
    inspected: await inspectFilledPDF(Array.from(saved)),
    bytes: Array.from(saved),
  };
}
