import {
  createPdfRuntime,
  NULL_PTR,
  type PdfRuntimeModule,
  type Ptr,
} from "@embedpdf/engine-runtime";
import wasmUrl from "@embedpdf/engine-runtime-wasm32/embedpdf.wasm?url";
import type { FieldPage } from "./pdfium-fields-source";

export type FieldVariant =
  | "plain"
  | "repair-0"
  | "repair-1"
  | "single-call"
  | "model-adoption"
  | "direct-save";
export type FieldRequest =
  | { command: "dispose" }
  | {
      command: "probe";
      sources: Uint8Array<ArrayBuffer>[];
      pages: readonly FieldPage[];
      variants: readonly FieldVariant[];
    };
export interface FieldOutput {
  readonly variant: FieldVariant;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly diagnostics: { duplicateNameRejected?: boolean; linkedParentUnavailable?: boolean };
}
export type FieldResult =
  | { kind: "disposed" }
  | {
      kind: "outputs";
      outputs: FieldOutput[];
      closedBeforeResponse: boolean;
      openedDocuments: number;
      closedDocuments: number;
    };

const ready = createPdfRuntime({
  prefer: "wasm",
  wasmUrl: new URL(wasmUrl, self.location.href).href,
}).then((runtime) => {
  runtime.fn.EPDF_InitThread();
  return runtime;
});
void ready.catch(() => undefined);
function checked<T>(value: T): NonNullable<T> {
  if (!value) throw new Error("Field preservation probe native call failed.");
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
function save(runtime: PdfRuntimeModule, document: Ptr): Uint8Array<ArrayBuffer> {
  return memory(runtime, 4, (size) => {
    const output = checked(runtime.fn.EPDF_SaveDocumentToOwnedBuffer(document, 2, size));
    try {
      return new Uint8Array(
        runtime.mem.readBytes(output, Number(runtime.mem.peek(size, "i32")) >>> 0)
      );
    } finally {
      runtime.fn.EPDF_FreeBuffer(output);
    }
  });
}
function wide<T>(runtime: PdfRuntimeModule, text: string, use: (pointer: Ptr) => T): T {
  const characters = new Uint16Array(
    [...text].map((character) => character.charCodeAt(0)).concat(0)
  );
  return memory(runtime, characters.byteLength, (pointer) => {
    runtime.mem.writeBytes(pointer, new Uint8Array(characters.buffer));
    return use(pointer);
  });
}

// Bounded counterexample, NOT a generic form copier or candidate production fix.
// Only the two generated fields are authored. Existing imported widget APs are
// retained up to AttachWidget, which regenerates them inside the native API.
function adoptFixtureWidgets(runtime: PdfRuntimeModule, document: Ptr) {
  const fn = runtime.fn;
  const text = wide(runtime, "Shared", (name) =>
    checked(fn.EPDFForm_CreateField(document, 4, name, 0))
  );
  const radio = wide(runtime, "Choice", (name) =>
    checked(fn.EPDFForm_CreateField(document, 3, name, 0))
  );
  const duplicateNameRejected = wide(
    runtime,
    "Shared",
    (name) => fn.EPDFForm_CreateField(document, 4, name, 0) === 0
  );
  for (const [field, value] of [
    [text, "First"],
    [radio, "A"],
  ] as const) {
    wide(runtime, value, (valuePointer) =>
      memory(runtime, 4, (values) => {
        runtime.mem.poke(values, "ptr", valuePointer);
        checked(fn.EPDFForm_SetFieldValue(document, field, 1, values, 1));
      })
    );
  }
  let linkedParentUnavailable = true;
  for (let index = 0; index < 2; index++) {
    const page = checked(fn.FPDF_LoadPage(document, index));
    try {
      for (let annotIndex = 0; annotIndex < 2; annotIndex++) {
        const annot = checked(fn.FPDFPage_GetAnnot(page, annotIndex));
        try {
          const parent = fn.FPDFAnnot_GetLinkedAnnot(annot, "Parent");
          if (parent) {
            linkedParentUnavailable = false;
            fn.FPDFPage_CloseAnnot(parent);
          }
          const object = fn.EPDFAnnot_GetObjectNumber(annot);
          checked(fn.EPDFAnnot_RemoveKey(annot, "Parent"));
          checked(
            fn.EPDFForm_AttachWidget(
              document,
              annotIndex === 0 ? text : radio,
              object,
              annotIndex === 0 ? "" : index === 0 ? "A" : "B",
              0
            )
          );
        } finally {
          fn.FPDFPage_CloseAnnot(annot);
        }
      }
    } finally {
      fn.FPDF_ClosePage(page);
    }
  }
  memory(runtime, 8, (states) => {
    runtime.mem.poke(states, "i32", 1);
    runtime.mem.poke(states, "i32", 0, 4);
    checked(fn.EPDFForm_SetFieldWidgetsChecked(document, radio, states, 2, NULL_PTR, 0, NULL_PTR));
  });
  return { duplicateNameRejected, linkedParentUnavailable };
}

function probe(
  runtime: PdfRuntimeModule,
  request: Extract<FieldRequest, { command: "probe" }>
): FieldResult {
  const fn = runtime.fn;
  const live = new Set<Ptr>();
  let openedDocuments = 0;
  let closedDocuments = 0;
  const register = (document: Ptr) => {
    live.add(document);
    openedDocuments++;
    return document;
  };
  const close = (document: Ptr) => {
    fn.FPDF_CloseDocument(document);
    live.delete(document);
    closedDocuments++;
  };
  const outputs: FieldOutput[] = [];
  for (const variant of request.variants) {
    const allocations: Ptr[] = [];
    const sources: Ptr[] = [];
    let output = NULL_PTR;
    try {
      for (const bytes of request.sources) {
        const pointer = checked(runtime.mem.alloc(bytes.length));
        allocations.push(pointer);
        runtime.mem.writeBytes(pointer, bytes);
        sources.push(register(checked(fn.FPDF_LoadMemDocument(pointer, bytes.length, ""))));
      }
      let diagnostics: FieldOutput["diagnostics"] = {};
      if (variant === "direct-save") {
        outputs.push({ variant, bytes: save(runtime, sources[0]), diagnostics });
        continue;
      }
      output = register(checked(fn.FPDF_CreateNewDocument()));
      if (variant === "single-call") {
        if (request.pages.some((page) => page.source !== 0))
          throw new Error("Single-call control requires one source.");
        checked(
          fn.FPDF_ImportPages(
            output,
            sources[0],
            request.pages.map((page) => page.page).join(","),
            0
          )
        );
      } else {
        for (const [index, page] of request.pages.entries())
          checked(fn.FPDF_ImportPages(output, sources[page.source], String(page.page), index));
      }
      if (variant === "repair-0" || variant === "repair-1")
        checked(fn.EPDFForm_Repair(output, variant === "repair-0" ? 0 : 1, NULL_PTR));
      if (variant === "model-adoption") diagnostics = adoptFixtureWidgets(runtime, output);
      outputs.push({ variant, bytes: save(runtime, output), diagnostics });
    } finally {
      if (output) close(output);
      for (const source of sources) close(source);
      for (const pointer of allocations) runtime.mem.free(pointer);
    }
  }
  // No source or output document survives this response. Independent decoding
  // on the main thread cannot accidentally read a still-live source reference.
  return {
    kind: "outputs",
    outputs,
    closedBeforeResponse: live.size === 0,
    openedDocuments,
    closedDocuments,
  };
}
let queue = Promise.resolve();
self.onmessage = (event: MessageEvent<FieldRequest>) => {
  queue = queue.then(async () => {
    try {
      const runtime = await ready;
      let result: FieldResult;
      if (event.data.command === "dispose") {
        runtime.fn.EPDF_ShutdownThread();
        await runtime.destroy();
        result = { kind: "disposed" };
      } else result = probe(runtime, event.data);
      self.postMessage(
        { result },
        {
          transfer:
            result.kind === "outputs" ? result.outputs.map((output) => output.bytes.buffer) : [],
        }
      );
    } catch (error) {
      self.postMessage({ error: error instanceof Error ? error.message : String(error) });
    }
  });
};
