// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPdfBytes, formBytes, sharedFormBytes } from "./pdf-fixtures";
import { createTestEngine } from "./pdfium-test-engine";

describe("PDFium document checkpoints", () => {
  let native: Awaited<ReturnType<typeof createTestEngine>>;
  beforeEach(async () => {
    native = await createTestEngine();
  });
  afterEach(() => native.engine.dispose());

  it("undoes and redoes replacement, text, X marks, and native field values in one working document", () => {
    const originalBytes = formBytes(false, { rotation: 90, crop: [50, 70, 250, 370] });
    const originalCopy = originalBytes.slice();
    const doc = native.engine.open(originalBytes);
    const initial = native.engine.content(doc.id, 1);
    const initialCheckpoint = native.engine.editUndoable(doc.id, 1, {
      kind: "replace",
      index: initial.text[0].index,
      expectedText: initial.text[0].text,
      text: "New phrase",
    });
    native.engine.edit(doc.id, 1, { kind: "form", index: 0, value: "Alice" });
    native.engine.edit(doc.id, 1, { kind: "form", index: 1, value: "Accepted" });
    native.engine.edit(doc.id, 1, {
      kind: "add",
      text: "Answer",
      x: 70,
      y: 150,
      width: 80,
      fontSize: 12,
      rotation: 37,
    });
    const beforeMark = native.engine.editUndoable(doc.id, 1, {
      kind: "add",
      text: "X",
      x: 75,
      y: 200,
      width: 20,
      fontSize: 12,
    });
    const completed = native.engine.content(doc.id, 1);
    const marked = native.engine.restore(doc.id, beforeMark);
    expect(native.engine.content(doc.id, 1).text.map((run) => run.text)).not.toContain("X");
    native.engine.restore(doc.id, marked);
    expect(native.engine.content(doc.id, 1)).toEqual(completed);
    const redo = native.engine.restore(doc.id, initialCheckpoint);
    expect(native.engine.content(doc.id, 1)).toEqual(initial);
    native.engine.restore(doc.id, redo);
    expect(native.engine.content(doc.id, 1)).toEqual(completed);
    const reopened = native.engine.open(native.engine.snapshot(doc.id));
    expect(native.engine.content(reopened.id, 1)).toEqual(completed);
    expect(native.engine.info(doc.id, 1, 90)).toEqual({ width: 300, height: 200, rotation: 90 });
    expect(originalBytes).toEqual(originalCopy);
  });

  it("restores shared form widgets across pages and refreshes cached page sizes", () => {
    const doc = native.engine.open(sharedFormBytes());
    const baseline = native.engine.snapshot(doc.id);
    const before = native.engine.editUndoable(doc.id, 1, {
      kind: "form",
      index: 0,
      value: "Shared answer",
    });
    expect(native.engine.content(doc.id, 2).fields[0].value).toBe("Shared answer");
    const redo = native.engine.restore(doc.id, before);
    expect(native.engine.content(doc.id, 2).fields[0].value).toBe("Before");
    native.engine.restore(doc.id, redo);
    expect(native.engine.content(doc.id, 2).fields[0].value).toBe("Shared answer");
    expect(native.engine.info(doc.id, 1, 0).width).toBe(300);
    native.engine.restore(doc.id, formBytes(false, { crop: [50, 70, 250, 370] }));
    expect(native.engine.info(doc.id, 1, 0).width).toBe(200);
    expect(() => native.engine.content(doc.id, 2)).toThrow("Invalid PDF page");
    native.engine.restore(doc.id, baseline);
    expect(native.engine.content(doc.id, 2).fields[0].value).toBe("Before");
    expect(native.engine.info(doc.id, 1, 0).width).toBe(300);
  });

  it("leaves the document intact on failed edits and restores, freeing rejected native candidates", () => {
    const doc = native.engine.open(formBytes());
    const before = native.engine.content(doc.id, 1);
    const close = vi.spyOn(native.api, "FPDF_CloseDocument");
    expect(() =>
      native.engine.editUndoable(doc.id, 1, {
        kind: "replace",
        index: 0,
        expectedText: before.text[0].text,
        text: "W".repeat(100),
      })
    ).toThrow("too wide");
    expect(close).toHaveBeenCalledTimes(1);
    expect(native.engine.content(doc.id, 1)).toEqual(before);
    expect(() => native.engine.restore(doc.id, new Uint8Array([1, 2, 3]))).toThrow(
      "Could not open PDF"
    );
    const empty = createPdfBytes([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [] /Count 0 >>",
    ]);
    expect(() => native.engine.restore(doc.id, empty)).toThrow("no pages");
    expect(close).toHaveBeenCalledTimes(2);
    expect(native.engine.content(doc.id, 1)).toEqual(before);
    close.mockRestore();
  });

  it("keeps a duplicated page independent when undoing its source document edits", () => {
    const source = native.engine.open(formBytes());
    const copy = native.engine.open(
      native.engine.build([{ document: source.id, page: 1, rotation: 0 }])
    );
    const sourceBefore = native.engine.editUndoable(source.id, 1, {
      kind: "form",
      index: 0,
      value: "Source",
    });
    native.engine.edit(copy.id, 1, { kind: "form", index: 0, value: "Copy" });
    native.engine.restore(source.id, sourceBefore);
    expect(native.engine.content(source.id, 1).fields[0].value).toBe("Before");
    expect(native.engine.content(copy.id, 1).fields[0].value).toBe("Copy");
  });
});
