// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PDFiumPasswordError } from "../pdfium/engine";
import { createPdfFile, formBytes, sharedFormBytes } from "./pdf-fixtures";
import { createTestEngine } from "./pdfium-test-engine";

describe("PDFium WASM", () => {
  let native: Awaited<ReturnType<typeof createTestEngine>>;
  beforeEach(async () => {
    native = await createTestEngine();
  });
  afterEach(() => native.engine.dispose());

  it("opens independent PDF fixtures and respects source and absolute preview rotation", async () => {
    const file = await createPdfFile("rotated.pdf", [{ width: 200, height: 300, rotation: 90 }]);
    const doc = native.engine.open(new Uint8Array(await file.arrayBuffer()));
    expect(native.engine.info(doc.id, 1, 90)).toEqual({ width: 300, height: 200, rotation: 90 });
    expect(native.engine.info(doc.id, 1, 0)).toEqual({ width: 200, height: 300, rotation: 90 });
    expect(() => native.engine.info(doc.id, 2, 0)).toThrow("Invalid PDF page");
  });

  it("replaces original text physically and retains searchable text through save and reopen", () => {
    const doc = native.engine.open(formBytes());
    const old = native.engine.content(doc.id, 1).text[0];
    native.engine.edit(doc.id, 1, {
      kind: "replace",
      index: old.index,
      text: "New phrase",
      expectedText: old.text,
    });
    const saved = native.engine.build([{ document: doc.id, page: 1, rotation: 0 }]);
    const reopened = native.engine.open(saved);
    expect(native.engine.content(reopened.id, 1).text.map((t) => t.text)).toEqual(["New phrase"]);
    expect(new TextDecoder().decode(saved)).not.toContain("Original phrase");
  });

  it("rejects overflow and unsupported characters without changing any source content", () => {
    const doc = native.engine.open(formBytes());
    const before = native.engine.content(doc.id, 1);
    const edit = { kind: "replace" as const, index: 0, expectedText: before.text[0].text };
    expect(() => native.engine.edit(doc.id, 1, { ...edit, text: "W".repeat(100) })).toThrow(
      "too wide"
    );
    expect(() => native.engine.edit(doc.id, 1, { ...edit, text: "こんにちは" })).toThrow(
      "basic Latin"
    );
    expect(() =>
      native.engine.edit(doc.id, 1, { ...edit, expectedText: "stale", text: "New" })
    ).toThrow("changed");
    expect(native.engine.content(doc.id, 1)).toEqual(before);
  });

  it("adds searchable text and refuses invalid placement", () => {
    const doc = native.engine.open(formBytes());
    native.engine.edit(doc.id, 1, {
      kind: "add",
      text: "Added line",
      x: 20,
      y: 300,
      width: 200,
      fontSize: 12,
    });
    expect(native.engine.content(doc.id, 1).text.map((t) => t.text)).toContain("Added line");
    expect(() =>
      native.engine.edit(doc.id, 1, {
        kind: "add",
        text: "Off page",
        x: 300,
        y: 300,
        width: 200,
        fontSize: 12,
      })
    ).toThrow("inside the page");
  });

  it("fills text, checkbox, and choice widgets, persists values, and refuses read-only fields", () => {
    const doc = native.engine.open(formBytes());
    expect(native.engine.content(doc.id, 1).fields.map((f) => f.name)).toEqual([
      "Name",
      "Agree",
      "Color",
      "ReadOnly",
    ]);
    native.engine.edit(doc.id, 1, { kind: "form", index: 0, value: "Alice" });
    native.engine.edit(doc.id, 1, { kind: "form", index: 1, value: "Accepted" });
    native.engine.edit(doc.id, 1, { kind: "form", index: 2, value: "Blue" });
    expect(() =>
      native.engine.edit(doc.id, 1, { kind: "form", index: 3, value: "Changed" })
    ).toThrow("read-only");
    const reopened = native.engine.open(
      native.engine.build([{ document: doc.id, page: 1, rotation: 0 }])
    );
    const fields = native.engine.content(reopened.id, 1).fields;
    expect(fields[0].value).toBe("Alice");
    expect(fields[1].checked).toBe(true);
    expect(fields[2].value).toBe("Blue");
    expect(fields[3].value).toBe("Fixed");
  });

  it("renders real pixels including form appearances and rejects excessive allocations", () => {
    const doc = native.engine.open(formBytes());
    const before = native.engine.render(doc.id, 1, 0, 1);
    expect(before.pixels.some((p) => p !== 255)).toBe(true);
    native.engine.edit(doc.id, 1, { kind: "form", index: 0, value: "Visible" });
    const after = native.engine.render(doc.id, 1, 0, 1);
    expect(after.pixels).not.toEqual(before.pixels);
    expect(() => native.engine.render(doc.id, 1, 0, 100)).toThrow("pixel limit");
  });

  it("unlocks encrypted PDFs and exports actual text objects without a password", () => {
    const api = native.api;
    const bytes = formBytes();
    const p = api.pdfium.wasmExports.malloc(bytes.length);
    (api.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8.set(bytes, p);
    const doc = api.FPDF_LoadMemDocument(p, bytes.length, "");
    expect(api.EPDF_SetEncryption(doc, "secret", "owner", -4)).toBe(true);
    const writer = api.PDFiumExt_OpenFileWriter();
    expect(api.FPDF_SaveAsCopy(doc, writer, 0)).toBe(true);
    const size = api.PDFiumExt_GetFileWriterSize(writer);
    const buffer = api.pdfium.wasmExports.malloc(size);
    api.PDFiumExt_GetFileWriterData(writer, buffer, size);
    const encrypted = (api.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8.slice(
      buffer,
      buffer + size
    );
    api.pdfium.wasmExports.free(buffer);
    api.PDFiumExt_CloseFileWriter(writer);
    api.FPDF_CloseDocument(doc);
    api.pdfium.wasmExports.free(p);
    expect(() => native.engine.open(encrypted)).toThrow(PDFiumPasswordError);
    expect(() => native.engine.open(encrypted, "wrong")).toThrow(PDFiumPasswordError);
    const unlocked = native.engine.open(encrypted, "secret");
    const reopened = native.engine.open(
      native.engine.build([{ document: unlocked.id, page: 1, rotation: 0 }])
    );
    expect(native.engine.content(reopened.id, 1).text[0].text).toBe("Original phrase");
  });

  it("merges forms from separate sources with independent names and retained values", async () => {
    const a = native.engine.open(formBytes());
    native.engine.edit(a.id, 1, { kind: "form", index: 0, value: "Alice" });
    const b = native.engine.open(formBytes());
    native.engine.edit(b.id, 1, { kind: "form", index: 0, value: "Bob" });
    const output = native.engine.open(
      native.engine.build([
        { document: a.id, page: 1, rotation: 0 },
        { document: b.id, page: 1, rotation: 0 },
      ])
    );
    const first = native.engine.content(output.id, 1).fields;
    const second = native.engine.content(output.id, 2).fields;
    expect(first[0].value).toBe("Alice");
    expect(second[0].value).toBe("Bob");
    expect(first[0].name).not.toBe(second[0].name);
    native.engine.edit(output.id, 2, { kind: "form", index: second[0].index, value: "Carol" });
    expect(native.engine.content(output.id, 1).fields[0].value).toBe("Alice");
  });
  it("retains shared fields and mutually exclusive radio widgets after merging sources", async () => {
    const source = native.engine.open(sharedFormBytes());
    const other = native.engine.open(formBytes());
    native.engine.edit(source.id, 2, { kind: "form", index: 1, value: "B" });
    const merged = native.engine.open(
      native.engine.build([
        { document: source.id, page: 1, rotation: 0 },
        { document: source.id, page: 2, rotation: 0 },
        { document: other.id, page: 1, rotation: 0 },
      ])
    );
    const first = native.engine.content(merged.id, 1).fields;
    const second = native.engine.content(merged.id, 2).fields;
    expect(first[1].checked).toBe(false);
    expect(second[1].checked).toBe(true);
    expect(first[1].exportValue).toBe("A");
    expect(second[1].exportValue).toBe("B");
    native.engine.edit(merged.id, 1, { kind: "form", index: first[0].index, value: "Everywhere" });
    expect(native.engine.content(merged.id, 2).fields[0].value).toBe("Everywhere");
    native.engine.edit(merged.id, 1, { kind: "form", index: first[1].index, value: "A" });
    expect(native.engine.content(merged.id, 1).fields[1].checked).toBe(true);
    expect(native.engine.content(merged.id, 2).fields[1].checked).toBe(false);
  });

  it.each([0, 90, 180, 270])(
    "places text relative to the unrotated cropped page at rotation %i",
    async (rotation) => {
      const file = await createPdfFile("crop.pdf", [{ width: 300, height: 400, rotation }]);
      const doc = native.engine.open(new Uint8Array(await file.arrayBuffer()));
      expect(native.engine.content(doc.id, 1)).toMatchObject({ width: 300, height: 400 });
      native.engine.edit(doc.id, 1, {
        kind: "add",
        text: "Position",
        x: 20,
        y: 300,
        width: 200,
        fontSize: 12,
      });
      const rendered = native.engine.render(doc.id, 1, 0, 1);
      expect(rendered.width).toBe(300);
      expect(rendered.height).toBe(400);
      const pixels = rendered.pixels;
      const inkY = [];
      for (let y = 0; y < 400; y++)
        if (pixels.subarray(y * 300 * 4, (y + 1) * 300 * 4).some((p) => p !== 255)) inkY.push(y);
      expect(Math.min(...inkY)).toBeGreaterThan(85);
      expect(Math.max(...inkY)).toBeLessThan(105);
    }
  );
  it("selects choices whose export codes differ from their labels", () => {
    const doc = native.engine.open(formBytes(true));
    expect(native.engine.content(doc.id, 1).fields[2]).toMatchObject({
      value: "r",
      selectedOption: 0,
    });
    native.engine.edit(doc.id, 1, { kind: "form", index: 2, value: "Blue" });
    const saved = native.engine.open(
      native.engine.build([{ document: doc.id, page: 1, rotation: 0 }])
    );
    expect(native.engine.content(saved.id, 1).fields[2]).toMatchObject({
      value: "b",
      selectedOption: 1,
    });
  });
  it("refuses to silently change coded choice values when merging form catalogs", () => {
    const coded = native.engine.open(formBytes(true)),
      other = native.engine.open(formBytes());
    expect(() =>
      native.engine.build([
        { document: coded.id, page: 1, rotation: 0 },
        { document: other.id, page: 1, rotation: 0 },
      ])
    ).toThrow("Export this PDF separately");
    expect(native.engine.content(coded.id, 1).fields[2].value).toBe("r");
  });
});
