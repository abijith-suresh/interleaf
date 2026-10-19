import { PDFDocument, PDFName, PDFNumber } from "pdf-lib";
import { difference, geometrySource, pageDictionaries, pixels, reference } from "./pdfium-core";
import type { SuccessorRequest, SuccessorResult } from "./pdfium-successor-worker";

async function withSuccessor<T>(
  use: (request: (input: SuccessorRequest) => Promise<SuccessorResult>) => Promise<T>
) {
  const worker = new Worker(new URL("./pdfium-successor-worker.ts", import.meta.url), {
    type: "module",
  });
  let failed = false;
  const request = (input: SuccessorRequest): Promise<SuccessorResult> =>
    new Promise((resolve, reject) => {
      const fail = (message: string) => {
        failed = true;
        clearTimeout(timeout);
        reject(new Error(message));
      };
      const timeout = setTimeout(() => fail("Successor probe response timed out."), 30_000);
      worker.onmessage = (event) => {
        clearTimeout(timeout);
        if (event.data.error) reject(new Error(event.data.error));
        else resolve(event.data.result);
      };
      worker.onerror = (event) => fail(event.message);
      worker.onmessageerror = () => fail("Could not read successor probe response.");
      worker.postMessage(input);
    });
  const dispose = async () => {
    const response = await request({ command: "dispose" });
    if (response.kind !== "disposed") throw new Error("Successor disposal was not acknowledged.");
  };
  try {
    return await use(request);
  } finally {
    try {
      // Close PDFium's thread state before releasing the worker's WASM memory.
      // The published wasm runtime.destroy() alone is a no-op.
      if (!failed) {
        await dispose();
      }
    } finally {
      worker.terminate();
    }
  }
}

export async function checkSuccessorAccessor() {
  const pdf = await PDFDocument.create();
  for (const unit of [undefined, 0, -2, 1.5]) {
    const page = pdf.addPage([100, 200]);
    if (unit !== undefined) page.node.set(PDFName.of("UserUnit"), PDFNumber.of(unit));
  }
  return withSuccessor(async (request) => {
    const response = await request({
      command: "accessor",
      bytes: new Uint8Array(await pdf.save()),
    });
    if (response.kind !== "accessor") throw new Error("Expected accessor response.");
    return response;
  });
}

export async function checkSuccessorGeometry() {
  // Reuse the original 24 cases without changing or weakening the stable probe.
  const { bytes, cases } = await geometrySource();
  const oracle = await reference(bytes);
  try {
    return await withSuccessor(async (request) => {
      const rows = [];
      for (const item of cases) {
        const renders = [];
        for (const rotation of [0, 90, 180, 270]) {
          // Only the PDF bytes, page index and requested rotation reach this worker.
          // No expected UserUnit, scalar, size or pixels are supplied to the candidate.
          const actual = await request({ command: "render", bytes, page: item.number, rotation });
          if (actual.kind !== "render") throw new Error("Expected rendered successor response.");
          const expected = await pixels(oracle.pdf, item.number, rotation);
          renders.push({
            rotation,
            intrinsicRotation: actual.rotation,
            unit: actual.unit,
            rawSize: actual.rawSize,
            physicalSize: actual.physicalSize,
            size: [actual.width, actual.height],
            expectedSize: [expected.width, expected.height],
            ...difference(actual.pixels, expected.pixels),
          });
        }
        const page = await oracle.pdf.getPage(item.number);
        const viewport = page.getViewport({ scale: 1 });
        rows.push({ ...item, physicalSize: [viewport.width, viewport.height], renders });
        page.cleanup();
      }
      const expectedDictionaries = pageDictionaries(await PDFDocument.load(bytes));
      const outputs = [];
      for (const command of ["save", "import"] as const) {
        const response = await request({ command, bytes });
        if (response.kind !== "output") throw new Error("Expected saved successor output.");
        const reopened = await reference(response.bytes);
        try {
          const renders = [];
          for (const item of cases) {
            const expected = await pixels(oracle.pdf, item.number, item.rotation);
            const actual = await pixels(reopened.pdf, item.number, item.rotation);
            const native = await request({
              command: "render",
              bytes: response.bytes,
              page: item.number,
            });
            if (native.kind !== "render") throw new Error("Expected reopened successor render.");
            renders.push({
              size: [actual.width, actual.height],
              expectedSize: [expected.width, expected.height],
              nativeSize: [native.width, native.height],
              unit: native.unit,
              nativeDifference: difference(native.pixels, expected.pixels),
              oracleDifference: difference(actual.pixels, expected.pixels),
            });
          }
          outputs.push({
            command,
            dictionaries: pageDictionaries(await PDFDocument.load(response.bytes)),
            expectedDictionaries,
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
