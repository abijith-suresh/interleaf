import { init, type WrappedPdfiumModule } from "@embedpdf/pdfium";
import wasmUrl from "@embedpdf/pdfium/pdfium.wasm?url";

// Test-only probe. No application code imports this worker or the candidate engine.
// Match the prototype's public API calls without importing its editing/form code.
const ready = init({ locateFile: () => wasmUrl }).then((api) => {
  api.PDFiumExt_Init();
  return api;
});

export interface ProbeRequest {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly page?: number;
  readonly rotation?: number;
  readonly size?: readonly [number, number];
  readonly output?: "save" | "import";
}

export type ProbeResult =
  | { readonly kind: "output"; readonly bytes: Uint8Array<ArrayBuffer> }
  | {
      readonly kind: "render";
      readonly size: number[];
      readonly boxes: number[];
      readonly rotation: number;
      readonly width: number;
      readonly height: number;
      readonly pixels: Uint8ClampedArray<ArrayBuffer>;
    };

function checked<T>(value: T): NonNullable<T> {
  if (!value) throw new Error("PDFium probe call failed.");
  return value;
}

function heap(api: WrappedPdfiumModule) {
  // Emscripten exports these views at runtime; the wrapper's declarations omit them.
  // Read the current view after native calls, because memory growth replaces it.
  return api.pdfium as typeof api.pdfium & {
    HEAPU8: Uint8Array<ArrayBuffer>;
    HEAPF32: Float32Array<ArrayBuffer>;
  };
}

function memory<T>(api: WrappedPdfiumModule, size: number, use: (pointer: number) => T): T {
  const pointer = checked(api.pdfium.wasmExports.malloc(size));
  try {
    return use(pointer);
  } finally {
    api.pdfium.wasmExports.free(pointer);
  }
}

function save(api: WrappedPdfiumModule, document: number) {
  const writer = checked(api.PDFiumExt_OpenFileWriter());
  try {
    checked(api.FPDF_SaveAsCopy(document, writer, 2));
    const size = api.PDFiumExt_GetFileWriterSize(writer);
    return memory(api, size, (pointer) => {
      checked(api.PDFiumExt_GetFileWriterData(writer, pointer, size));
      return heap(api).HEAPU8.slice(pointer, pointer + size);
    });
  } finally {
    api.PDFiumExt_CloseFileWriter(writer);
  }
}

function probe(api: WrappedPdfiumModule, request: ProbeRequest): ProbeResult {
  return memory(api, request.bytes.length, (pointer) => {
    heap(api).HEAPU8.set(request.bytes, pointer);
    const document = checked(api.FPDF_LoadMemDocument(pointer, request.bytes.length, ""));
    try {
      if (request.output === "save") return { kind: "output", bytes: save(api, document) };
      if (request.output === "import") {
        const output = checked(api.FPDF_CreateNewDocument());
        try {
          checked(api.FPDF_ImportPages(output, document, "", 0));
          return { kind: "output", bytes: save(api, output) };
        } finally {
          api.FPDF_CloseDocument(output);
        }
      }
      const page = checked(api.FPDF_LoadPage(document, (request.page ?? 1) - 1));
      try {
        const rotation = api.FPDFPage_GetRotation(page) * 90;
        const size = [api.FPDF_GetPageWidth(page), api.FPDF_GetPageHeight(page)];
        const boxes = memory(api, 16, (p) => {
          checked(api.FPDFPage_GetCropBox(page, p, p + 4, p + 8, p + 12));
          return Array.from(heap(api).HEAPF32.subarray(p / 4, p / 4 + 4));
        });
        const [width, height] = request.size ?? size;
        const bitmap = checked(api.FPDFBitmap_Create(width, height, 1));
        let formInfo = 0;
        let form = 0;
        try {
          formInfo = checked(api.PDFiumExt_OpenFormFillInfo());
          form = api.PDFiumExt_InitFormFillEnvironment(document, formInfo);
          if (form) api.FORM_OnAfterLoadPage(page, form);
          api.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff);
          const turn = (((request.rotation ?? rotation) - rotation + 360) % 360) / 90;
          api.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, turn, 1);
          if (form) api.FPDF_FFLDraw(form, bitmap, page, 0, 0, width, height, turn, 1);
          const buffer = api.FPDFBitmap_GetBuffer(bitmap);
          const stride = api.FPDFBitmap_GetStride(bitmap);
          const pixels = new Uint8ClampedArray(width * height * 4);
          for (let y = 0; y < height; y++) {
            pixels.set(
              heap(api).HEAPU8.subarray(buffer + y * stride, buffer + y * stride + width * 4),
              y * width * 4
            );
          }
          for (let index = 0; index < pixels.length; index += 4) {
            const blue = pixels[index];
            pixels[index] = pixels[index + 2];
            pixels[index + 2] = blue;
          }
          return { kind: "render", size, boxes, rotation, width, height, pixels };
        } finally {
          if (form) {
            api.FORM_OnBeforeClosePage(page, form);
            api.PDFiumExt_ExitFormFillEnvironment(form);
          }
          if (formInfo) api.PDFiumExt_CloseFormFillInfo(formInfo);
          api.FPDFBitmap_Destroy(bitmap);
        }
      } finally {
        api.FPDF_ClosePage(page);
      }
    } finally {
      api.FPDF_CloseDocument(document);
    }
  });
}

// Serialize asynchronous initialization and all native operations. PDFium is not thread-safe.
let queue = Promise.resolve();
self.onmessage = (event: MessageEvent<ProbeRequest>) => {
  queue = queue.then(async () => {
    try {
      const result = probe(await ready, event.data);
      const buffer = result.kind === "output" ? result.bytes.buffer : result.pixels.buffer;
      self.postMessage({ result }, { transfer: [buffer] });
    } catch (error) {
      self.postMessage({ error: error instanceof Error ? error.message : String(error) });
    }
  });
};
