import {
  createPdfRuntime,
  NULL_PTR,
  type PdfRuntimeModule,
  type Ptr,
} from "@embedpdf/engine-runtime";
import wasmUrl from "@embedpdf/engine-runtime-wasm32/embedpdf.wasm?url";

// Test-only published successor. Every native operation runs serially in this worker.
const ready = createPdfRuntime({
  prefer: "wasm",
  wasmUrl: new URL(wasmUrl, self.location.href).href,
}).then((runtime) => {
  runtime.fn.EPDF_InitThread();
  return runtime;
});

export type SuccessorRequest =
  | { readonly command: "dispose" }
  | {
      readonly command: "render" | "save" | "import" | "accessor";
      readonly bytes: Uint8Array<ArrayBuffer>;
      readonly page?: number;
      readonly rotation?: number;
    };

type UnitRead = {
  readonly success: boolean;
  readonly value: number;
  readonly guardsIntact: boolean;
};
export type SuccessorResult =
  | { readonly kind: "disposed" }
  | { readonly kind: "output"; readonly bytes: Uint8Array<ArrayBuffer> }
  | {
      readonly kind: "accessor";
      readonly pages: UnitRead[];
      readonly invalid: UnitRead[];
      readonly nullOutput: boolean;
    }
  | {
      readonly kind: "render";
      readonly rawSize: number[];
      readonly physicalSize: number[];
      readonly unit: UnitRead;
      readonly rotation: number;
      readonly width: number;
      readonly height: number;
      readonly pixels: Uint8ClampedArray<ArrayBuffer>;
    };

function checked<T>(value: T): NonNullable<T> {
  if (!value) throw new Error("Published successor probe call failed.");
  return value;
}

function memory<T>(runtime: PdfRuntimeModule, size: number, use: (pointer: Ptr) => T): T {
  const pointer = checked(runtime.mem.alloc(size));
  try {
    return use(pointer);
  } finally {
    runtime.mem.free(pointer);
  }
}

function offset(pointer: Ptr, bytes: number): Ptr {
  return (pointer + BigInt(bytes)) as Ptr;
}

function userUnit(runtime: PdfRuntimeModule, document: Ptr, index: number): UnitRead {
  // The published ABI writes a float, not a returned scalar or double. Guard both
  // sides so an incorrect out-pointer width cannot silently supply valid geometry.
  return memory(runtime, 12, (pointer) => {
    runtime.mem.poke(pointer, "i32", 1234567);
    runtime.mem.poke(pointer, "i32", 7654321, 8);
    runtime.mem.poke(pointer, "f32", -777.25, 4);
    const success = runtime.fn.EPDF_GetPageUserUnitByIndex(document, index, offset(pointer, 4));
    return {
      success,
      value: Number(runtime.mem.peek(pointer, "f32", 4)),
      guardsIntact:
        runtime.mem.peek(pointer, "i32") === 1234567 &&
        runtime.mem.peek(pointer, "i32", 8) === 7654321,
    };
  });
}

function save(runtime: PdfRuntimeModule, document: Ptr): Uint8Array<ArrayBuffer> {
  // The release artifact's epdf_save.h declares unsigned long* out_size, 4 bytes
  // in wasm32. The owned output must be freed with EPDF_FreeBuffer, not mem.free.
  return memory(runtime, 4, (sizePointer) => {
    const output = checked(runtime.fn.EPDF_SaveDocumentToOwnedBuffer(document, 2, sizePointer));
    try {
      const length = Number(runtime.mem.peek(sizePointer, "i32")) >>> 0;
      return new Uint8Array(runtime.mem.readBytes(output, length));
    } finally {
      runtime.fn.EPDF_FreeBuffer(output);
    }
  });
}

function probe(
  runtime: PdfRuntimeModule,
  request: Exclude<SuccessorRequest, { command: "dispose" }>
): SuccessorResult {
  return memory(runtime, request.bytes.length, (pointer) => {
    runtime.mem.writeBytes(pointer, request.bytes);
    const document = checked(runtime.fn.FPDF_LoadMemDocument(pointer, request.bytes.length, ""));
    try {
      if (request.command === "accessor") {
        const count = runtime.fn.FPDF_GetPageCount(document);
        return {
          kind: "accessor",
          pages: Array.from({ length: count }, (_, index) => userUnit(runtime, document, index)),
          invalid: [
            userUnit(runtime, document, -1),
            userUnit(runtime, document, count),
            userUnit(runtime, NULL_PTR, 0),
          ],
          nullOutput: runtime.fn.EPDF_GetPageUserUnitByIndex(document, 0, NULL_PTR),
        };
      }
      if (request.command === "save") return { kind: "output", bytes: save(runtime, document) };
      if (request.command === "import") {
        const output = checked(runtime.fn.FPDF_CreateNewDocument());
        try {
          checked(runtime.fn.FPDF_ImportPages(output, document, "", 0));
          return { kind: "output", bytes: save(runtime, output) };
        } finally {
          runtime.fn.FPDF_CloseDocument(output);
        }
      }
      const index = (request.page ?? 1) - 1;
      const unit = userUnit(runtime, document, index);
      checked(unit.success && unit.guardsIntact && unit.value > 0);
      const page = checked(runtime.fn.FPDF_LoadPage(document, index));
      try {
        const rotation = runtime.fn.FPDFPage_GetRotation(page) * 90;
        const rawSize = [runtime.fn.FPDF_GetPageWidth(page), runtime.fn.FPDF_GetPageHeight(page)];
        const physicalSize = rawSize.map((value) => value * unit.value);
        const requested = request.rotation ?? rotation;
        const unrotated = rotation % 180 ? [physicalSize[1], physicalSize[0]] : physicalSize;
        const [width, height] = (requested % 180 ? [unrotated[1], unrotated[0]] : unrotated).map(
          Math.trunc
        );
        const bitmap = checked(runtime.fn.FPDFBitmap_Create(width, height, 1));
        try {
          checked(runtime.fn.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff));
          const turn = ((requested - rotation + 360) % 360) / 90;
          runtime.fn.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, turn, 1);
          const stride = runtime.fn.FPDFBitmap_GetStride(bitmap);
          const native = runtime.mem.readBytes(
            runtime.fn.FPDFBitmap_GetBuffer(bitmap),
            stride * height
          );
          const pixels = new Uint8ClampedArray(width * height * 4);
          for (let y = 0; y < height; y++)
            pixels.set(native.subarray(y * stride, y * stride + width * 4), y * width * 4);
          for (let index = 0; index < pixels.length; index += 4) {
            const blue = pixels[index];
            pixels[index] = pixels[index + 2];
            pixels[index + 2] = blue;
          }
          return { kind: "render", rawSize, physicalSize, unit, rotation, width, height, pixels };
        } finally {
          runtime.fn.FPDFBitmap_Destroy(bitmap);
        }
      } finally {
        runtime.fn.FPDF_ClosePage(page);
      }
    } finally {
      runtime.fn.FPDF_CloseDocument(document);
    }
  });
}

let queue = Promise.resolve();
self.onmessage = (event: MessageEvent<SuccessorRequest>) => {
  queue = queue.then(async () => {
    try {
      const runtime = await ready;
      let result: SuccessorResult;
      if (event.data.command === "dispose") {
        runtime.fn.EPDF_ShutdownThread();
        await runtime.destroy();
        result = { kind: "disposed" };
      } else {
        result = probe(runtime, event.data);
      }
      const transfer =
        result.kind === "render"
          ? [result.pixels.buffer]
          : result.kind === "output"
            ? [result.bytes.buffer]
            : [];
      self.postMessage({ result }, { transfer });
    } catch (error) {
      self.postMessage({ error: error instanceof Error ? error.message : String(error) });
    }
  });
};
