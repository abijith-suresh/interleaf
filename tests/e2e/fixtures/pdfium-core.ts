import { degrees, PDFDocument, PDFName, PDFNumber, rgb } from "pdf-lib";
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { ProbeRequest, ProbeResult } from "./pdfium-core-worker";

GlobalWorkerOptions.workerSrc = pdfjsWorker;

function withProbe<T>(
  use: (probe: (request: ProbeRequest) => Promise<ProbeResult>) => Promise<T>
): Promise<T> {
  const worker = new Worker(new URL("./pdfium-core-worker.ts", import.meta.url), {
    type: "module",
  });
  // Each invocation has one request in flight. Always release the worker, also on failed assertions.
  const probe = (request: ProbeRequest): Promise<ProbeResult> =>
    new Promise((resolve, reject) => {
      worker.onmessage = (event) => {
        if (event.data.error) reject(new Error(event.data.error));
        else resolve(event.data.result);
      };
      worker.onerror = (event) => reject(new Error(event.message));
      worker.postMessage(request);
    });
  return use(probe).finally(() => worker.terminate());
}

async function reference(bytes: Uint8Array<ArrayBuffer>) {
  const task = getDocument({ data: bytes.slice() });
  const pdf = await task.promise;
  return { pdf, dispose: () => task.destroy() };
}

async function pixels(pdf: PDFDocumentProxy, number: number, rotation: number, scale = 1) {
  const page = await pdf.getPage(number);
  const viewport = page.getViewport({ scale, rotation });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Missing reference canvas context.");
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    return {
      width: canvas.width,
      height: canvas.height,
      pixels: context.getImageData(0, 0, canvas.width, canvas.height).data,
    };
  } finally {
    canvas.width = canvas.height = 0;
    page.cleanup();
  }
}

function difference(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  if (a.length !== b.length) throw new Error("Cannot compare different bitmap dimensions.");
  let changed = 0;
  let totalError = 0;
  let ink = 0;
  for (let index = 0; index < a.length; index += 4) {
    const error = Math.max(
      ...[0, 1, 2, 3].map((channel) => Math.abs(a[index + channel] - b[index + channel]))
    );
    if (error > 8) changed++;
    totalError += error;
    if (Math.min(...a.subarray(index, index + 3)) < 128) ink++;
  }
  return { changedFraction: changed / (a.length / 4), meanError: totalError / (a.length / 4), ink };
}

async function geometrySource() {
  const pdf = await PDFDocument.create();
  const cases = [];
  for (const origin of [
    [20, 40],
    [-30, -50],
  ]) {
    for (const unit of [1, 1.5, 2]) {
      for (const rotation of [0, 90, 180, 270]) {
        const page = pdf.addPage([400, 600]);
        page.setMediaBox(-100, -100, 400, 600);
        page.setCropBox(origin[0], origin[1], 120, 200);
        page.node.set(PDFName.of("UserUnit"), PDFNumber.of(unit));
        page.setRotation(degrees(rotation));
        // Asymmetry detects reversed rotation, translation, clipping and blank output.
        for (const [x, y, width, height, color] of [
          [5, 8, 35, 75, rgb(0.9, 0.1, 0.2)],
          [65, 120, 45, 65, rgb(0.1, 0.3, 0.9)],
          [-20, 90, 50, 18, rgb(0.1, 0.7, 0.2)],
        ] as const) {
          page.drawRectangle({ x: origin[0] + x, y: origin[1] + y, width, height, color });
        }
        cases.push({ number: cases.length + 1, origin, unit, rotation });
      }
    }
  }
  return { bytes: new Uint8Array(await pdf.save()), cases };
}

function pageDictionaries(pdf: PDFDocument) {
  return pdf.getPages().map((page) => ({
    crop: page.getCropBox(),
    media: page.getMediaBox(),
    rotation: page.getRotation().angle,
    userUnit: page.node.get(PDFName.of("UserUnit"))?.toString(),
  }));
}

export async function smallestUserUnitRegression() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([400, 600]);
  page.setCropBox(20, 40, 100, 200);
  page.setRotation(degrees(90));
  page.node.set(PDFName.of("UserUnit"), PDFNumber.of(2));
  const bytes = new Uint8Array(await pdf.save());
  return withProbe(async (probe) => {
    const observed = await probe({ bytes });
    if (observed.kind !== "render") throw new Error("Expected rendered response.");
    const oracle = await reference(bytes);
    try {
      const page = await oracle.pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1 });
      return { actual: observed.size, required: [viewport.width, viewport.height] };
    } finally {
      await oracle.dispose();
    }
  });
}

export async function checkPDFiumGeometry() {
  const { bytes, cases } = await geometrySource();
  const oracle = await reference(bytes);
  try {
    return await withProbe(async (probe) => {
      const rows = [];
      for (const item of cases) {
        const page = await oracle.pdf.getPage(item.number);
        const physical = page.getViewport({ scale: 1 });
        const observed = await probe({ bytes, page: item.number });
        if (observed.kind !== "render") throw new Error("Expected rendered response.");
        const unscaledReference = await pixels(
          oracle.pdf,
          item.number,
          item.rotation,
          1 / item.unit
        );
        const renders = [];
        for (const rotation of [0, 90, 180, 270]) {
          const expected = await pixels(oracle.pdf, item.number, rotation);
          // These dimensions come from the oracle, not from a proposed production fix.
          const actual = await probe({
            bytes,
            page: item.number,
            rotation,
            size: [expected.width, expected.height],
          });
          if (actual.kind !== "render") throw new Error("Expected rendered response.");
          renders.push({
            rotation,
            size: [actual.width, actual.height],
            expectedSize: [expected.width, expected.height],
            ...difference(actual.pixels, expected.pixels),
          });
        }
        rows.push({
          ...item,
          publicSize: observed.size,
          reportedRotation: observed.rotation,
          physicalSize: [physical.width, physical.height],
          crop: observed.boxes,
          apiBitmap: {
            size: [observed.width, observed.height],
            referenceSize: [unscaledReference.width, unscaledReference.height],
            ...difference(observed.pixels, unscaledReference.pixels),
          },
          renders,
        });
        page.cleanup();
      }
      const outputs = [];
      const expectedDictionaries = pageDictionaries(await PDFDocument.load(bytes));
      for (const output of ["save", "import"] as const) {
        const response = await probe({ bytes, output });
        if (response.kind !== "output") throw new Error("Expected saved PDF bytes.");
        const data = response.bytes;
        const reopened = await reference(data);
        try {
          const renders = [];
          const sizes = [];
          for (const item of cases) {
            const expected = await pixels(oracle.pdf, item.number, item.rotation);
            const actual = await pixels(reopened.pdf, item.number, item.rotation);
            sizes.push([actual.width, actual.height]);
            renders.push(difference(actual.pixels, expected.pixels));
          }
          outputs.push({
            output,
            dictionaries: pageDictionaries(await PDFDocument.load(data)),
            expectedDictionaries,
            sizes,
            expectedSizes: rows.map((row) => row.physicalSize),
            renders,
          });
        } finally {
          await reopened.dispose();
        }
      }
      return { rows, outputs };
    });
  } finally {
    await oracle.dispose();
  }
}
