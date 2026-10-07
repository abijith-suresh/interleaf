import type { WrappedPdfiumModule } from "@embedpdf/pdfium";
import { PDFReadCache } from "./cache";
import type {
  PDFBounds,
  PDFContentEdit,
  PDFFormField,
  PDFiumImage,
  PDFiumPageRef,
  PDFPageContent,
  PDFTextRun,
} from "./protocol";

type Document = { handle: number; allocation: number; formInfo: number; form: number };

export class PDFiumPasswordError extends Error {}

/** All native handles and input allocations belong to this worker. Never expose them to the UI. */
export class PDFiumEngine {
  private documents = new Map<number, Document>();
  private nextId = 0;
  private readonly sizes = new PDFReadCache<{ width: number; height: number; rotation: number }>(
    64 * 1024,
    512
  );
  constructor(private readonly api: WrappedPdfiumModule) {
    api.PDFiumExt_Init();
  }

  private get heap() {
    return this.api.pdfium as typeof this.api.pdfium & {
      HEAPU8: Uint8Array<ArrayBuffer>;
      HEAP32: Int32Array<ArrayBuffer>;
      HEAPU32: Uint32Array<ArrayBuffer>;
      HEAPF32: Float32Array<ArrayBuffer>;
    };
  }

  private checked<T>(value: T, message: string): T {
    if (!value) throw new Error(message);
    return value;
  }

  private memory<T>(size: number, use: (pointer: number) => T): T {
    const pointer = this.checked(
      this.api.pdfium.wasmExports.malloc(size),
      "PDF memory allocation failed."
    );
    try {
      return use(pointer);
    } finally {
      this.api.pdfium.wasmExports.free(pointer);
    }
  }

  private wide<T>(value: string, use: (pointer: number) => T): T {
    return this.memory((value.length + 1) * 2, (pointer) => {
      this.api.pdfium.stringToUTF16(value, pointer, (value.length + 1) * 2);
      return use(pointer);
    });
  }

  private readWide(read: (pointer: number, length: number) => number): string {
    const length = read(0, 0);
    if (!length) return "";
    return this.memory(length, (pointer) => {
      read(pointer, length);
      return this.api.pdfium.UTF16ToString(pointer);
    });
  }

  private load(bytes: Uint8Array, password = ""): Document {
    const allocation = this.checked(
      this.api.pdfium.wasmExports.malloc(bytes.length),
      "PDF memory allocation failed."
    );
    this.heap.HEAPU8.set(bytes, allocation);
    const handle = this.api.FPDF_LoadMemDocument(allocation, bytes.length, password);
    if (!handle) {
      const code = this.api.FPDF_GetLastError();
      this.api.pdfium.wasmExports.free(allocation);
      if (code === 4) throw new PDFiumPasswordError("This PDF needs a valid password.");
      throw new Error(`Could not open PDF (PDFium error ${code}).`);
    }
    if (this.api.EPDF_IsEncrypted(handle) && !this.api.EPDF_RemoveEncryption(handle)) {
      this.api.FPDF_CloseDocument(handle);
      this.api.pdfium.wasmExports.free(allocation);
      throw new Error("Could not unlock this PDF for editing.");
    }
    return this.attach(handle, allocation);
  }

  private attach(handle: number, allocation = 0): Document {
    const formInfo = this.api.PDFiumExt_OpenFormFillInfo();
    const form = this.api.PDFiumExt_InitFormFillEnvironment(handle, formInfo);
    return { handle, allocation, formInfo, form };
  }

  private destroy(doc: Document): void {
    if (doc.form) this.api.PDFiumExt_ExitFormFillEnvironment(doc.form);
    this.api.PDFiumExt_CloseFormFillInfo(doc.formInfo);
    this.api.FPDF_CloseDocument(doc.handle);
    if (doc.allocation) this.api.pdfium.wasmExports.free(doc.allocation);
  }

  private document(id: number): Document {
    return this.checked(this.documents.get(id), "This PDF was closed.") as Document;
  }

  private page<T>(doc: Document, number: number, use: (page: number) => T): T {
    if (!Number.isInteger(number) || number < 1 || number > this.api.FPDF_GetPageCount(doc.handle))
      throw new Error("Invalid PDF page.");
    const page = this.checked(
      this.api.FPDF_LoadPage(doc.handle, number - 1),
      "Could not load PDF page."
    );
    if (doc.form) this.api.FORM_OnAfterLoadPage(page, doc.form);
    try {
      return use(page);
    } finally {
      if (doc.form) this.api.FORM_OnBeforeClosePage(page, doc.form);
      this.api.FPDF_ClosePage(page);
    }
  }

  open(bytes: Uint8Array, password?: string): { id: number; count: number } {
    const doc = this.load(bytes, password);
    const id = ++this.nextId;
    this.documents.set(id, doc);
    return { id, count: this.api.FPDF_GetPageCount(doc.handle) };
  }

  close(id: number): void {
    const doc = this.documents.get(id);
    if (doc) {
      this.documents.delete(id);
      this.sizes.invalidate(id);
      this.destroy(doc);
    }
  }

  dispose(): void {
    for (const id of this.documents.keys()) this.close(id);
  }

  info(id: number, number: number, rotation: number) {
    const doc = this.document(id);
    const key = `${id}:${number}`;
    let size = this.sizes.get(key);
    if (!size) {
      size = this.page(doc, number, (page) => ({
        ...this.unrotatedSize(page),
        rotation: this.api.FPDFPage_GetRotation(page) * 90,
      }));
      this.sizes.set(key, size, 48);
    }
    const swap = Math.abs(rotation) % 180 !== 0;
    return {
      width: swap ? size.height : size.width,
      height: swap ? size.width : size.height,
      rotation: size.rotation,
    };
  }

  render(id: number, number: number, rotation: number, scale: number) {
    if (!Number.isFinite(scale) || scale <= 0) throw new Error("Invalid preview scale.");
    const size = this.info(id, number, rotation);
    const width = Math.max(1, Math.ceil(size.width * scale));
    const height = Math.max(1, Math.ceil(size.height * scale));
    if (width > 32768 || height > 32768 || width * height > 16_000_000)
      throw new Error("The page preview exceeds the pixel limit.");
    return this.page(this.document(id), number, (page) => {
      const bitmap = this.checked(
        this.api.FPDFBitmap_Create(width, height, 1),
        "Could not allocate preview."
      );
      try {
        this.api.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff);
        const rotate = ((rotation - size.rotation) / 90 + 4) % 4;
        this.api.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, rotate, 1);
        const doc = this.document(id);
        if (doc.form) this.api.FPDF_FFLDraw(doc.form, bitmap, page, 0, 0, width, height, rotate, 1);
        const buffer = this.api.FPDFBitmap_GetBuffer(bitmap);
        const stride = this.api.FPDFBitmap_GetStride(bitmap);
        const pixels = new Uint8ClampedArray(width * height * 4);
        const heap = this.heap.HEAPU8;
        for (let y = 0; y < height; y++)
          pixels.set(
            heap.subarray(buffer + y * stride, buffer + y * stride + width * 4),
            y * width * 4
          );
        for (let i = 0; i < pixels.length; i += 4) {
          const blue = pixels[i];
          pixels[i] = pixels[i + 2];
          pixels[i + 2] = blue;
        }
        return { width, height, pixels };
      } finally {
        this.api.FPDFBitmap_Destroy(bitmap);
      }
    });
  }

  private floats(size: number, read: (pointer: number) => void): number[] {
    return this.memory(size * 4, (pointer) => {
      read(pointer);
      return Array.from(this.heap.HEAPF32.subarray(pointer / 4, pointer / 4 + size));
    });
  }

  private bounds(object: number): number[] {
    return this.floats(4, (p) =>
      this.checked(
        this.api.FPDFPageObj_GetBounds(object, p, p + 4, p + 8, p + 12),
        "Could not measure text."
      )
    );
  }

  private textRun(object: number, textPage: number, index: number, page?: number): PDFTextRun {
    const text = this.readWide((p, n) => this.api.FPDFTextObj_GetText(object, textPage, p, n));
    const fontSize = this.floats(1, (p) => this.api.FPDFTextObj_GetFontSize(object, p))[0];
    const matrix = this.floats(6, (p) => this.api.FPDFPageObj_GetMatrix(object, p));
    const clip = this.api.FPDFPageObj_GetClipPath(object);
    const reason =
      matrix[0] <= 0 || matrix[3] <= 0 || Math.abs(matrix[1]) > 0.001 || Math.abs(matrix[2]) > 0.001
        ? "Rotated, mirrored, or slanted text cannot be replaced."
        : (clip && this.api.FPDFClipPath_CountPaths(clip) > 0) ||
            this.api.FPDFTextObj_GetTextRenderMode(object) !== 0 ||
            this.api.FPDFPageObj_HasTransparency(object)
          ? "Text with clipping, strokes, or transparency cannot be replaced."
          : !text.trim() || /[\r\n]/.test(text)
            ? "This text run does not contain one editable line."
            : undefined;
    return {
      index,
      text,
      fontSize,
      editable: !reason,
      reason,
      ...(page ? { bounds: this.normalizedBounds(page, this.bounds(object)) } : {}),
    };
  }

  private field(doc: Document, annot: number, index: number): PDFFormField {
    const flags = this.api.FPDFAnnot_GetFormFieldFlags(doc.form, annot);
    const type = this.api.FPDFAnnot_GetFormFieldType(doc.form, annot);
    const read = (f: (env: number, a: number, p: number, n: number) => number) =>
      this.readWide((p, n) => f(doc.form, annot, p, n));
    const options = Array.from(
      { length: Math.max(0, this.api.FPDFAnnot_GetOptionCount(doc.form, annot)) },
      (_, i) => this.readWide((p, n) => this.api.FPDFAnnot_GetOptionLabel(doc.form, annot, i, p, n))
    );
    return {
      index,
      fieldId: this.api.EPDFAnnot_GetFormFieldObjectNumber(doc.form, annot),
      type,
      flags,
      name: read(this.api.FPDFAnnot_GetFormFieldName),
      value: read(this.api.FPDFAnnot_GetFormFieldValue),
      checked: this.api.FPDFAnnot_IsChecked(doc.form, annot),
      exportValue:
        read(this.api.FPDFAnnot_GetFormFieldExportValue) ||
        this.readWide((p, n) => this.api.EPDFAnnot_GetButtonExportValue(annot, p, n)) ||
        "Yes",
      options,
      selectedOption: options.findIndex((_, i) =>
        this.api.FPDFAnnot_IsOptionSelected(doc.form, annot, i)
      ),
      readOnly:
        Boolean(flags & 1) ||
        ![2, 3, 4, 5, 6].includes(type) ||
        Boolean(flags & ((1 << 21) | (1 << 24))),
    };
  }

  private fields(doc: Document, page: number): PDFFormField[] {
    const fields: PDFFormField[] = [];
    for (let i = 0; i < this.api.FPDFPage_GetAnnotCount(page); i++) {
      const annot = this.api.FPDFPage_GetAnnot(page, i);
      try {
        if (this.api.FPDFAnnot_GetSubtype(annot) === 20) {
          const rect = this.floats(4, (p) =>
            this.checked(this.api.FPDFAnnot_GetRect(annot, p), "Could not locate this form field.")
          );
          fields.push({
            ...this.field(doc, annot, i),
            bounds: this.normalizedBounds(page, [rect[0], rect[3], rect[2], rect[1]]),
          });
        }
      } finally {
        this.api.FPDFPage_CloseAnnot(annot);
      }
    }
    return fields;
  }

  private unrotatedSize(page: number) {
    const quarter = this.api.FPDFPage_GetRotation(page) % 2 !== 0;
    const width = this.api.FPDF_GetPageWidth(page),
      height = this.api.FPDF_GetPageHeight(page);
    return { width: quarter ? height : width, height: quarter ? width : height };
  }

  private normalizedBounds(page: number, rect: number[]): PDFBounds {
    const size = this.unrotatedSize(page);
    const rotate = (4 - this.api.FPDFPage_GetRotation(page)) % 4;
    const points = [
      [rect[0], rect[1]],
      [rect[2], rect[3]],
    ].map(([x, y]) =>
      this.memory(8, (p) => {
        this.checked(
          this.api.FPDF_PageToDevice(
            page,
            0,
            0,
            Math.round(size.width * 100),
            Math.round(size.height * 100),
            rotate,
            x,
            y,
            p,
            p + 4
          ),
          "Could not locate this page content."
        );
        return [this.heap.HEAP32[p / 4] / 100, this.heap.HEAP32[p / 4 + 1] / 100];
      })
    );
    return {
      x: Math.min(points[0][0], points[1][0]),
      y: Math.min(points[0][1], points[1][1]),
      width: Math.abs(points[1][0] - points[0][0]),
      height: Math.abs(points[1][1] - points[0][1]),
    };
  }

  private pagePoint(page: number, x: number, y: number): number[] {
    const size = this.unrotatedSize(page);
    // PDFium resolves CropBox offsets and intrinsic rotation, including nonzero page origins.
    const rotate = (4 - this.api.FPDFPage_GetRotation(page)) % 4;
    return this.memory(16, (p) => {
      this.checked(
        this.api.FPDF_DeviceToPage(
          page,
          0,
          0,
          Math.round(size.width * 100),
          Math.round(size.height * 100),
          rotate,
          Math.round(x * 100),
          Math.round((size.height - y) * 100),
          p,
          p + 8
        ),
        "Could not place text on this page."
      );
      const heap = this.api.pdfium as typeof this.api.pdfium & { HEAPF64: Float64Array };
      return [heap.HEAPF64[p / 8], heap.HEAPF64[p / 8 + 1]];
    });
  }

  content(id: number, number: number): PDFPageContent {
    const doc = this.document(id);
    return this.page(doc, number, (page) => {
      const textPage = this.checked(
        this.api.FPDFText_LoadPage(page),
        "Could not inspect page text."
      );
      try {
        const text: PDFTextRun[] = [];
        for (let i = 0; i < this.api.FPDFPage_CountObjects(page); i++) {
          const object = this.api.FPDFPage_GetObject(page, i);
          if (this.api.FPDFPageObj_GetType(object) === 1)
            text.push(this.textRun(object, textPage, i, page));
        }
        return {
          text,
          fields: this.fields(doc, page),
          ...this.unrotatedSize(page),
        };
      } finally {
        this.api.FPDFText_ClosePage(textPage);
      }
    });
  }

  private save(doc: Document): Uint8Array {
    const writer = this.checked(
      this.api.PDFiumExt_OpenFileWriter(),
      "Could not allocate PDF writer."
    );
    try {
      this.checked(this.api.FPDF_SaveAsCopy(doc.handle, writer, 2), "Could not save PDF.");
      const length = this.api.PDFiumExt_GetFileWriterSize(writer);
      return this.memory(length, (pointer) => {
        this.checked(
          this.api.PDFiumExt_GetFileWriterData(writer, pointer, length),
          "Could not read saved PDF."
        );
        return this.heap.HEAPU8.slice(pointer, pointer + length);
      });
    } finally {
      this.api.PDFiumExt_CloseFileWriter(writer);
    }
  }

  private clone(doc: Document): Document {
    return this.load(this.save(doc));
  }

  edit(id: number, number: number, edit: PDFContentEdit): void {
    // Stage edits in a copy. Native failures or overflow leave the working document intact.
    const original = this.document(id);
    const candidate = this.clone(original);
    let changedFieldId = 0;
    try {
      this.page(candidate, number, (page) => {
        if (edit.kind === "form") {
          const annot = this.checked(
            this.api.FPDFPage_GetAnnot(page, edit.index),
            "This form field is unavailable."
          );
          try {
            const field = this.field(candidate, annot, edit.index);
            if (field.readOnly)
              throw new Error("This field is read-only or uses an unsupported form type.");
            if ([2, 3].includes(field.type) && !["Off", field.exportValue].includes(edit.value))
              throw new Error("Choose a valid button value.");
            if (
              [4, 5].includes(field.type) &&
              !(field.flags & (1 << 18)) &&
              !field.options.includes(edit.value)
            )
              throw new Error("Choose one of this field's options.");
            changedFieldId = field.fieldId;
            if (edit.value.length > 10000) throw new Error("The form value is too long.");
            const optionIndex = [4, 5].includes(field.type)
              ? field.options.indexOf(edit.value)
              : -1;
            if (optionIndex >= 0) {
              this.checked(
                this.api.FORM_SetFocusedAnnot(candidate.form, annot),
                "Could not focus this choice field."
              );
              this.checked(
                this.api.FORM_SetIndexSelected(candidate.form, page, optionIndex, true),
                "Could not select this choice."
              );
              this.api.FORM_ForceToKillFocus(candidate.form);
              this.checked(
                this.api.FPDFAnnot_IsOptionSelected(candidate.form, annot, optionIndex),
                "Could not persist the selected choice."
              );
            } else
              this.wide(edit.value, (p) =>
                this.checked(
                  this.api.EPDFAnnot_SetFormFieldValue(candidate.form, annot, p),
                  "Could not fill this field."
                )
              );
            // Regenerate all widgets, including widgets sharing a field on other pages.
          } finally {
            this.api.FPDFPage_CloseAnnot(annot);
          }
        } else {
          if (!/^[\x20-\x7e]+$/.test(edit.text))
            throw new Error("This prototype uses Helvetica. Enter one line of basic Latin text.");
          if (edit.text.length > 1000) throw new Error("Keep text within 1000 characters.");
          let old = 0;
          let size: number;
          let matrix: number[];
          let maxWidth: number;
          let color = [0, 0, 0, 255];
          if (edit.kind === "replace") {
            old = this.checked(
              this.api.FPDFPage_GetObject(page, edit.index),
              "This text run is unavailable."
            );
            if (this.api.FPDFPageObj_GetType(old) !== 1)
              throw new Error("This object is not text.");
            const textPage = this.api.FPDFText_LoadPage(page);
            let run: PDFTextRun;
            try {
              run = this.textRun(old, textPage, edit.index);
            } finally {
              this.api.FPDFText_ClosePage(textPage);
            }
            if (!run.editable) throw new Error(run.reason);
            if (run.text !== edit.expectedText)
              throw new Error("The text has changed. Select it again.");
            size = run.fontSize;
            matrix = this.floats(6, (p) => this.api.FPDFPageObj_GetMatrix(old, p));
            const bounds = this.bounds(old);
            maxWidth = bounds[2] - bounds[0];
            color = this.memory(16, (p) => {
              this.api.FPDFPageObj_GetFillColor(old, p, p + 4, p + 8, p + 12);
              return Array.from(this.heap.HEAPU32.subarray(p / 4, p / 4 + 4));
            });
          } else {
            size = edit.fontSize;
            maxWidth = edit.width;
            if (
              ![edit.x, edit.y, size, maxWidth].every(Number.isFinite) ||
              size < 6 ||
              size > 144 ||
              edit.x < 0 ||
              edit.y < size ||
              maxWidth <= 0 ||
              edit.x + maxWidth > this.unrotatedSize(page).width ||
              edit.y > this.unrotatedSize(page).height
            )
              throw new Error(
                "Keep the text area inside the page. Font size must be 6 to 144 points."
              );
            matrix = [1, 0, 0, 1, ...this.pagePoint(page, edit.x, edit.y)];
          }
          const font = this.checked(
            this.api.FPDFText_LoadStandardFont(candidate.handle, "Helvetica"),
            "Could not load Helvetica."
          );
          const object = this.checked(
            this.api.FPDFPageObj_CreateTextObj(candidate.handle, font, size),
            "Could not create text."
          );
          let inserted = false;
          try {
            this.wide(edit.text, (p) =>
              this.checked(this.api.FPDFText_SetText(object, p), "Could not set text.")
            );
            this.memory(24, (p) => {
              this.heap.HEAPF32.set(matrix, p / 4);
              this.checked(this.api.FPDFPageObj_SetMatrix(object, p), "Could not place text.");
            });
            this.api.FPDFPageObj_SetFillColor(object, color[0], color[1], color[2], color[3]);
            const bounds = this.bounds(object);
            if (bounds[2] - bounds[0] > maxWidth + 0.05)
              throw new Error("The text is too wide for this area. Shorten it.");
            if (old)
              this.checked(
                this.api.FPDFPage_RemoveObject(page, old),
                "Could not remove original text."
              );
            if (old) this.api.FPDFPageObj_Destroy(old);
            if (edit.kind === "replace") {
              inserted = true;
              this.checked(
                this.api.FPDFPage_InsertObjectAtIndex(page, object, edit.index),
                "Could not replace text at its original layer."
              );
            } else this.api.FPDFPage_InsertObject(page, object);
            inserted = true;
            this.checked(this.api.FPDFPage_GenerateContent(page), "Could not update page content.");
          } finally {
            if (!inserted) this.api.FPDFPageObj_Destroy(object);
            this.api.FPDFFont_Close(font);
          }
        }
      });
      if (edit.kind === "form") {
        for (let i = 1; i <= this.api.FPDF_GetPageCount(candidate.handle); i++)
          this.page(candidate, i, (page) => {
            for (let index = 0; index < this.api.FPDFPage_GetAnnotCount(page); index++) {
              const annot = this.api.FPDFPage_GetAnnot(page, index);
              try {
                if (
                  this.api.FPDFAnnot_GetSubtype(annot) === 20 &&
                  this.api.EPDFAnnot_GetFormFieldObjectNumber(candidate.form, annot) ===
                    changedFieldId
                )
                  this.checked(
                    this.api.EPDFAnnot_GenerateFormFieldAP(annot),
                    "Could not update form appearance."
                  );
              } finally {
                this.api.FPDFPage_CloseAnnot(annot);
              }
            }
          });
      }
      this.documents.set(id, candidate);
      this.destroy(original);
    } catch (error) {
      this.destroy(candidate);
      throw error;
    }
  }

  private options(doc: Document, annot: number, values: string[]): void {
    const allocations: number[] = [];
    try {
      for (const value of values) {
        const p = this.checked(
          this.api.pdfium.wasmExports.malloc((value.length + 1) * 2),
          "Could not copy form options."
        );
        this.api.pdfium.stringToUTF16(value, p, (value.length + 1) * 2);
        allocations.push(p);
      }
      this.memory(allocations.length * 4, (p) => {
        this.heap.HEAPU32.set(allocations, p / 4);
        this.checked(
          this.api.EPDFAnnot_SetFormFieldOptions(doc.form, annot, p, allocations.length),
          "Could not copy form options."
        );
      });
    } finally {
      for (const p of allocations) this.api.pdfium.wasmExports.free(p);
    }
  }

  build(pages: PDFiumPageRef[]): Uint8Array {
    if (!pages.length) throw new Error("No pages to include in the PDF.");
    const source = this.document(pages[0].document);
    const sameSource =
      pages.every((p) => p.document === pages[0].document) &&
      new Set(pages.map((p) => p.page)).size === pages.length;
    const output = sameSource ? this.clone(source) : this.attach(this.api.FPDF_CreateNewDocument());
    const groups = new Map<string, { page: number; index: number; field: PDFFormField }[]>();
    try {
      if (sameSource) {
        const order = Array.from(
          { length: this.api.FPDF_GetPageCount(output.handle) },
          (_, i) => i + 1
        );
        for (const [index, ref] of pages.entries()) {
          const from = order.indexOf(ref.page);
          if (from !== index)
            this.memory(4, (p) => {
              this.heap.HEAP32[p / 4] = from;
              this.checked(
                this.api.FPDF_MovePages(output.handle, p, 1, index),
                "Could not reorder page."
              );
            });
          order.splice(index, 0, ...order.splice(from, 1));
        }
        while (this.api.FPDF_GetPageCount(output.handle) > pages.length)
          this.api.FPDFPage_Delete(output.handle, pages.length);
      } else {
        for (const [index, ref] of pages.entries()) {
          const src = this.document(ref.document);
          this.checked(
            this.api.FPDF_ImportPages(output.handle, src.handle, String(ref.page), index),
            "Could not copy PDF page."
          );
          // PDFium page import does not import the AcroForm catalog. Recreate supported widgets
          // after removing copied widgets, retaining editable values rather than orphan fields.
          this.page(src, ref.page, (sourcePage) =>
            this.page(output, index + 1, (outputPage) => {
              const fields = this.fields(src, sourcePage);
              if (
                fields.some(
                  (field) =>
                    [4, 5].includes(field.type) &&
                    field.selectedOption >= 0 &&
                    field.value !== field.options[field.selectedOption]
                )
              )
                throw new Error(
                  "This choice field uses export codes. Export this PDF separately to preserve its form data."
                );
              for (const field of [...fields].reverse())
                this.api.FPDFPage_RemoveAnnot(outputPage, field.index);
              for (const field of fields) {
                if (![2, 3, 4, 5, 6].includes(field.type))
                  throw new Error(
                    "Merging this document's unsupported form widgets would lose data. Export it separately."
                  );
                const sourceAnnot = this.api.FPDFPage_GetAnnot(sourcePage, field.index);
                const name = `source${ref.document}.field${field.fieldId}.${field.name}`;
                const annot = this.wide(name, (p) =>
                  this.checked(
                    this.api.EPDFPage_CreateFormField(outputPage, output.form, field.type, p),
                    "Could not copy form field."
                  )
                );
                try {
                  this.memory(16, (p) => {
                    this.api.FPDFAnnot_GetRect(sourceAnnot, p);
                    this.api.FPDFAnnot_SetRect(annot, p);
                  });
                  this.api.FPDFAnnot_SetFormFieldFlags(output.form, annot, field.flags);
                  if (field.options.length) this.options(output, annot, field.options);
                  this.api.EPDFAnnot_GenerateFormFieldAP(annot);
                  const exportValue =
                    this.readWide((p, n) => this.api.EPDFAnnot_GetButtonExportValue(annot, p, n)) ||
                    "Yes";
                  const value = [2, 3].includes(field.type)
                    ? field.checked
                      ? exportValue
                      : "Off"
                    : field.value;
                  this.wide(value, (p) =>
                    this.checked(
                      this.api.EPDFAnnot_SetFormFieldValue(output.form, annot, p),
                      "Could not copy form value."
                    )
                  );
                  this.api.EPDFAnnot_GenerateFormFieldAP(annot);
                  const key = `${ref.document}:${field.fieldId}`;
                  const group = groups.get(key) ?? [];
                  group.push({
                    page: index + 1,
                    index: this.api.FPDFPage_GetAnnotCount(outputPage) - 1,
                    field,
                  });
                  groups.set(key, group);
                } finally {
                  this.api.FPDFPage_CloseAnnot(sourceAnnot);
                  this.api.FPDFPage_CloseAnnot(annot);
                }
              }
            })
          );
        }
      }
      for (const group of groups.values()) {
        const first = group[0];
        this.page(output, first.page, (page) => {
          const annot = this.api.FPDFPage_GetAnnot(page, first.index);
          try {
            for (const other of group.slice(1))
              this.page(output, other.page, (otherPage) => {
                const otherAnnot = this.api.FPDFPage_GetAnnot(otherPage, other.index);
                try {
                  this.checked(
                    this.api.EPDFAnnot_ShareFormField(output.form, otherAnnot, annot),
                    "Could not preserve a shared form field."
                  );
                } finally {
                  this.api.FPDFPage_CloseAnnot(otherAnnot);
                }
              });
            if ([2, 3].includes(first.field.type)) {
              this.options(
                output,
                annot,
                group.map((widget) => widget.field.exportValue)
              );
              const selected = group.find((widget) => widget.field.checked);
              this.wide(selected?.field.exportValue ?? "Off", (p) =>
                this.checked(
                  this.api.EPDFAnnot_SetFormFieldValue(output.form, annot, p),
                  "Could not preserve button selection."
                )
              );
            } else {
              this.wide(first.field.value, (p) =>
                this.checked(
                  this.api.EPDFAnnot_SetFormFieldValue(output.form, annot, p),
                  "Could not preserve shared field value."
                )
              );
            }
          } finally {
            this.api.FPDFPage_CloseAnnot(annot);
          }
        });
      }
      for (const [index, ref] of pages.entries())
        this.page(output, index + 1, (page) => {
          const rotation =
            (((this.api.FPDFPage_GetRotation(page) * 90 + ref.rotation) % 360) + 360) % 360;
          this.api.FPDFPage_SetRotation(page, rotation / 90);
        });
      return this.save(output);
    } finally {
      this.destroy(output);
    }
  }

  images(images: PDFiumImage[]): Uint8Array {
    const output = this.attach(this.api.FPDF_CreateNewDocument());
    try {
      for (const [index, image] of images.entries()) {
        const page = this.api.FPDFPage_New(output.handle, index, 595.28, 841.89);
        const object = this.api.FPDFPageObj_NewImageObj(output.handle);
        let inserted = false;
        try {
          this.memory(image.bytes.length, (p) => {
            this.heap.HEAPU8.set(image.bytes, p);
            const embed =
              image.kind === "png" ? this.api.EPDFImageObj_SetPng : this.api.EPDFImageObj_SetJpeg;
            this.checked(embed(0, 0, object, p, image.bytes.length), "Could not embed image.");
          });
          const [width, height] = this.memory(32, (p) => {
            this.checked(
              this.api.FPDFImageObj_GetImageMetadata(object, page, p),
              "Could not inspect image."
            );
            return [this.heap.HEAPU32[p / 4], this.heap.HEAPU32[p / 4 + 1]];
          });
          const quarter = image.orientation >= 5;
          const orientedWidth = quarter ? height : width;
          const orientedHeight = quarter ? width : height;
          const pageWidth = orientedWidth > orientedHeight ? 841.89 : 595.28;
          const pageHeight = orientedWidth > orientedHeight ? 595.28 : 841.89;
          this.api.FPDFPage_SetMediaBox(page, 0, 0, pageWidth, pageHeight);
          const scale = Math.min(pageWidth / orientedWidth, pageHeight / orientedHeight);
          const w = width * scale,
            h = height * scale;
          const x = (pageWidth - orientedWidth * scale) / 2,
            y = (pageHeight - orientedHeight * scale) / 2;
          const matrices = [
            [w, 0, 0, h, x, y],
            [-w, 0, 0, h, x + w, y],
            [-w, 0, 0, -h, x + w, y + h],
            [w, 0, 0, -h, x, y + h],
            [0, w, h, 0, x, y],
            [0, -w, h, 0, x, y + w],
            [0, -w, -h, 0, x + h, y + w],
            [0, w, -h, 0, x + h, y],
          ];
          this.api.FPDFPageObj_Transform(
            object,
            ...(matrices[image.orientation - 1] as [number, number, number, number, number, number])
          );
          this.api.FPDFPage_InsertObject(page, object);
          inserted = true;
          this.checked(this.api.FPDFPage_GenerateContent(page), "Could not create image page.");
        } finally {
          if (!inserted) this.api.FPDFPageObj_Destroy(object);
          this.api.FPDF_ClosePage(page);
        }
      }
      return this.save(output);
    } finally {
      this.destroy(output);
    }
  }
}
