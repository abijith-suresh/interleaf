import { Effect } from "effect";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFRef,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import { hasPageAdditions } from "../../controllers/editor-additions-state";
import { answerField } from "../../controllers/editor-field-state";
import {
  copyOrganizationPages,
  emptyOrganizationHistory,
  recordOrganization,
  snapshotOrganization,
} from "../../controllers/editor-history";
import { createPageStates, duplicatePageState } from "../../controllers/editor-page-state";
import { applyFieldAnswers, inspectPDFFields } from "../pdf-fields";
import { PDFOperationsService } from "../pdf-operations-service";
import { exportCrossPageButtonFixture } from "./pdf-export-fixtures";
import { inspectExport } from "./pdf-export-inspection";
import { textFieldFixture } from "./pdf-field-fixtures";

const N = PDFName.of;
const file = (bytes: Uint8Array) =>
  new File([new Uint8Array(bytes)], "same.pdf", { type: "application/pdf" });
function terminal(doc: PDFDocument, ref: string) {
  return doc.context.lookup(PDFRef.of(Number(ref.split(" ")[0]), 0), PDFDict);
}

describe("embedded text field ownership and constraints", () => {
  it("maps exact widget refs to the terminal source ref and resolves null/inherited attributes", async () => {
    const fixture = await textFieldFixture();
    const doc = await PDFDocument.load(fixture.bytes);
    const fields = inspectPDFFields(doc);
    expect(fields.widgets).toHaveLength(6);
    const widgets = fields.widgets.filter((w) => w.fieldRef === fixture.fieldRef);
    expect(widgets).toHaveLength(3);
    expect(widgets.map((w) => w.widgetRef)).toEqual(fixture.widgetRefs);
    expect(widgets.map((w) => w.pageNumber)).toEqual([1, 1, 2]);
    for (const widget of widgets) {
      expect(widget.reason).toBeUndefined();
      expect(widget.value).toBe("INHERITED");
      expect(widget.maxLength).toBe(20);
    }
    expect(fields.widgets.filter((w) => w.reason)).toHaveLength(2);
  });
  it("maps a merged terminal/widget by its actual source reference", async () => {
    const doc = await PDFDocument.create(),
      page = doc.addPage([300, 400]);
    const field = doc.getForm().createTextField("merged");
    field.setText("Before");
    field.addToPage(page, { x: 20, y: 200, width: 200, height: 24 });
    doc.getForm().updateFieldAppearances();
    const widget = field.acroField.getWidgets()[0].dict;
    for (const [key, item] of widget.entries())
      if (key !== N("Parent")) field.acroField.dict.set(key, item);
    field.acroField.dict.delete(N("Kids"));
    page.node.set(N("Annots"), doc.context.obj([field.ref]));
    const reopened = await PDFDocument.load(await doc.save({ updateFieldAppearances: false }));
    const metadata = inspectPDFFields(reopened).widgets;
    expect(metadata).toHaveLength(1);
    expect(metadata[0].fieldRef).toBe(field.ref.toString());
    expect(metadata[0].widgetRef).toBe(field.ref.toString());
    expect(metadata[0].reason).toBeUndefined();
    await applyFieldAnswers(reopened, [{ fieldRef: field.ref.toString(), value: "After" }], [1]);
    expect(
      inspectPDFFields(
        await PDFDocument.load(await reopened.save({ updateFieldAppearances: false }))
      ).widgets[0].value
    ).toBe("After");
  });
  it("writes explicit empty terminal V and independently reopens it without exposing inherited V", async () => {
    const fixture = await textFieldFixture();
    const doc = await PDFDocument.load(fixture.bytes);
    await applyFieldAnswers(doc, [{ fieldRef: fixture.fieldRef, value: "" }], [1, 2]);
    const reopened = await PDFDocument.load(await doc.save({ updateFieldAppearances: false }));
    const field = terminal(reopened, fixture.fieldRef);
    expect(field.lookup(N("V"))).toBeInstanceOf(PDFHexString);
    expect((field.lookup(N("V")) as PDFHexString).decodeText()).toBe("");
    expect((field.lookup(N("Parent"), PDFDict).lookup(N("V")) as PDFHexString).decodeText()).toBe(
      "INHERITED"
    );
    expect(
      inspectPDFFields(reopened)
        .widgets.filter((w) => w.fieldRef === fixture.fieldRef)
        .map((w) => w.value)
    ).toEqual(["", "", ""]);
  });
  it("allows explicit clearing in a finite widget too short for nonempty fallback text", async () => {
    const fixture = await textFieldFixture();
    const doc = await PDFDocument.load(fixture.bytes);
    const widget = doc.context.lookup(
      terminal(doc, fixture.fieldRef).lookup(N("Kids"), PDFArray).get(0),
      PDFDict
    );
    widget.set(N("Rect"), doc.context.obj([10, 310, 250, 316]));
    await expect(
      applyFieldAnswers(doc, [{ fieldRef: fixture.fieldRef, value: "X" }], [1, 2])
    ).rejects.toThrow("too short for 12 pt");
    await applyFieldAnswers(doc, [{ fieldRef: fixture.fieldRef, value: "" }], [1, 2]);
    expect(
      inspectPDFFields(doc)
        .widgets.filter((widget) => widget.fieldRef === fixture.fieldRef)
        .map((widget) => widget.value)
    ).toEqual(["", "", ""]);
  });
  it("rejects inherited MaxLen and narrow linked overflow before changing any answer", async () => {
    const fixture = await textFieldFixture({ maxLength: 50, narrow: 70 });
    const doc = await PDFDocument.load(fixture.bytes);
    await expect(
      applyFieldAnswers(doc, [{ fieldRef: fixture.fieldRef, value: "M".repeat(51) }], [1, 2])
    ).rejects.toThrow("at most 50");
    await expect(
      applyFieldAnswers(doc, [{ fieldRef: fixture.fieldRef, value: "W".repeat(15) }], [1, 2])
    ).rejects.toThrow("does not fit");
    expect(
      inspectPDFFields(doc)
        .widgets.filter((w) => w.fieldRef === fixture.fieldRef)
        .map((w) => w.value)
    ).toEqual(["INHERITED", "INHERITED", "INHERITED"]);
    // A detached page has only its own linked widgets.
    await applyFieldAnswers(doc, [{ fieldRef: fixture.fieldRef, value: "W".repeat(15) }], [1]);
  });
  it("rejects a short linked widget before publishing any values or appearances", async () => {
    const fixture = await textFieldFixture();
    const doc = await PDFDocument.load(fixture.bytes);
    const field = terminal(doc, fixture.fieldRef);
    const widgets = field
      .lookup(N("Kids"), PDFArray)
      .asArray()
      .map((ref) => doc.context.lookup(ref, PDFDict));
    widgets[2].set(N("Rect"), doc.context.obj([10, 310, 120, 325.2]));
    const before = widgets.map((widget) => widget.lookup(N("AP"), PDFDict).get(N("N")));
    await expect(
      applyFieldAnswers(doc, [{ fieldRef: fixture.fieldRef, value: "gjpqyQ" }], [1, 2])
    ).rejects.toThrow("too short for 12 pt");
    expect(widgets.map((widget) => widget.lookup(N("AP"), PDFDict).get(N("N")))).toEqual(before);
    expect(
      inspectPDFFields(doc)
        .widgets.filter((widget) => widget.fieldRef === fixture.fieldRef)
        .map((widget) => widget.value)
    ).toEqual(["INHERITED", "INHERITED", "INHERITED"]);
  });
  it.each(["é", "two\nlines", "\t", "\x7f"])(
    "rejects unsupported input %j without normalization",
    async (value) => {
      const fixture = await textFieldFixture();
      const doc = await PDFDocument.load(fixture.bytes);
      await expect(
        applyFieldAnswers(doc, [{ fieldRef: fixture.fieldRef, value }], [1, 2])
      ).rejects.toThrow("basic Latin");
    }
  );
  it("rejects flags, malformed inherited limits, and cycles rather than modifying them", async () => {
    const fixture = await textFieldFixture();
    for (const flags of [1, 4096, 8192, 1048576, 16777216, 33554432, 8]) {
      const doc = await PDFDocument.load(fixture.bytes);
      terminal(doc, fixture.fieldRef).set(N("Ff"), PDFNumber.of(flags));
      expect(
        inspectPDFFields(doc)
          .widgets.filter((w) => w.fieldRef === fixture.fieldRef)
          .every((w) => !!w.reason)
      ).toBe(true);
    }
    const doc = await PDFDocument.load(fixture.bytes);
    const field = terminal(doc, fixture.fieldRef);
    field.set(N("MaxLen"), PDFNumber.of(-1));
    expect(
      inspectPDFFields(doc)
        .widgets.filter((w) => w.fieldRef === fixture.fieldRef)
        .every((w) => !!w.reason)
    ).toBe(true);
    field.set(N("MaxLen"), PDFNull);
    field.set(N("Parent"), doc.context.register(field));
    expect(() => inspectPDFFields(doc)).toThrow();
  });
});

describe("field answer state and exported bytes", () => {
  it("updates marked originals atomically, detaches duplicate-of-duplicate, and preserves same-named File identities and scalar history", async () => {
    const fixture = await textFieldFixture();
    const a = file(fixture.bytes),
      b = file(fixture.bytes);
    let pages = [...createPageStates(a, 2), ...createPageStates(b, 2)];
    pages[1].markedForDeletion = true;
    const before = snapshotOrganization(pages, new Set(), pages[0].id);
    pages = answerField(pages, pages[0].id, fixture.fieldRef, "");
    expect(pages.map((p) => p.fieldAnswers?.[0]?.value)).toEqual(["", "", undefined, undefined]);
    expect(pages[0].sourceFile).toBe(a);
    expect(pages[2].sourceFile).toBe(b);
    const duplicate = duplicatePageState(pages[0]);
    const again = duplicatePageState(duplicate);
    expect(new Set([pages[0].fieldGroupId, duplicate.fieldGroupId, again.fieldGroupId]).size).toBe(
      3
    );
    pages = answerField([...pages, duplicate, again], duplicate.id, fixture.fieldRef, "COPY");
    expect(pages.map((p) => p.fieldAnswers?.[0]?.value)).toEqual([
      "",
      "",
      undefined,
      undefined,
      "COPY",
      "",
    ]);
    const after = snapshotOrganization(pages, new Set(), pages[0].id);
    const history = recordOrganization(emptyOrganizationHistory(), "Fill field", before, after);
    expect(history.undo).toHaveLength(1);
    expect(history.undo[0].before.pages[0].fieldAnswers).toBeUndefined();
    const restored = copyOrganizationPages(history.undo[0].after.pages);
    expect(restored[0].sourceFile).toBe(a);
    expect(restored[0].fieldAnswers).not.toBe(pages[0].fieldAnswers);
    expect(hasPageAdditions(restored[0])).toBe(true);
    expect(hasPageAdditions(before.pages[0])).toBe(false);
    const removed = recordOrganization(history, "Remove file", after, {
      ...after,
      pages: after.pages.filter((p) => p.sourceFile !== a),
    });
    const sourceRestored = copyOrganizationPages(removed.undo.at(-1)!.before.pages);
    expect(sourceRestored[0].sourceFile).toBe(a);
    expect(sourceRestored[0].fieldAnswers?.[0].value).toBe("");
  });
  it("does not bypass inherited linked-choice rejection through null FT/Opt entries", async () => {
    const doc = await PDFDocument.load(await exportCrossPageButtonFixture());
    const radio = doc.getForm().getRadioGroup("cross-page");
    const opt = radio.acroField.dict.get(N("Opt"))!;
    const parent = doc.context.register(
      doc.context.obj({
        T: PDFHexString.fromText("parent"),
        FT: "Btn",
        Opt: opt,
        Kids: [radio.ref],
      })
    );
    radio.acroField.dict.set(N("Parent"), parent);
    radio.acroField.dict.set(N("FT"), PDFNull);
    radio.acroField.dict.set(N("Opt"), PDFNull);
    doc.getForm().acroForm.dict.set(N("Fields"), doc.context.obj([parent]));
    const source = file(await doc.save({ updateFieldAppearances: false }));
    const service = new PDFOperationsService({ renderPage: () => Effect.void });
    try {
      await expect(
        Effect.runPromise(service.buildPDF([createPageStates(source, 2)[0]]))
      ).rejects.toMatchObject({ message: expect.stringContaining("linked choice fields") });
    } finally {
      await Effect.runPromise(service.dispose());
    }
  });
  it("keeps simple navigation on first retained original pages across answer scopes", async () => {
    const fixture = await textFieldFixture();
    const doc = await PDFDocument.load(fixture.bytes);
    doc.getPage(0).node.addAnnot(
      doc.context.register(
        doc.context.obj({
          Type: "Annot",
          Subtype: "Link",
          Rect: [20, 40, 100, 60],
          Dest: [doc.getPage(1).ref, "Fit"],
        })
      )
    );
    const source = file(await doc.save({ updateFieldAppearances: false }));
    let original = createPageStates(source, 2);
    original = answerField(original, original[0].id, fixture.fieldRef, "FIRST");
    const duplicate = duplicatePageState(original[0]);
    const state = answerField([...original, duplicate], duplicate.id, fixture.fieldRef, "COPY");
    const service = new PDFOperationsService({ renderPage: () => Effect.void });
    try {
      const result = await Effect.runPromise(
        service.buildPDF(state, { selectedIndices: [2, 1, 0] })
      );
      const saved = await PDFDocument.load(result.data);
      for (const index of [0, 2]) {
        const annotations = saved.getPage(index).node.Annots()!;
        const link = annotations
          .asArray()
          .map((raw) => saved.context.lookup(raw, PDFDict))
          .find((dict) => dict.get(N("Subtype")) === N("Link"));
        expect(link).toBeDefined();
        expect(link?.lookup(N("Dest"), PDFArray).get(0)).toBe(saved.getPage(1).ref);
      }
    } finally {
      await Effect.runPromise(service.dispose());
    }
  });
  it("keeps independent values through reorder/extract/merge while pruning omitted payload and preserving unsupported baseline metadata", async () => {
    const fixture = await textFieldFixture();
    const second = await textFieldFixture({ value: "BOB" });
    const a = file(fixture.bytes),
      b = file(second.bytes);
    let originals = createPageStates(a, 2);
    originals = answerField(originals, originals[0].id, fixture.fieldRef, "FIRST");
    const duplicate = duplicatePageState(originals[0]);
    const again = duplicatePageState(duplicate);
    let pages = answerField(
      [...originals, duplicate, again, ...createPageStates(b, 2)],
      duplicate.id,
      fixture.fieldRef,
      "COPY"
    );
    pages = answerField(pages, again.id, fixture.fieldRef, "THIRD");
    const service = new PDFOperationsService({ renderPage: () => Effect.void });
    try {
      const output = await Effect.runPromise(
        service.buildPDF(pages, { selectedIndices: [1, 2, 3, 0, 4] })
      );
      const result = await inspectExport(output.data);
      expect(result.pageObjects).toBe(5);
      expect(result.widgetObjects).toBe(18);
      expect(result.orphanKids).toBe(false);
      expect(result.hasAcroForm).toBe(false);
      expect(
        result.pages.map((p) =>
          p.annotations.filter((a) => a.name === "person.answer").map((a) => a.value)
        )
      ).toEqual([
        ["FIRST"],
        ["COPY", "COPY"],
        ["THIRD", "THIRD"],
        ["FIRST", "FIRST"],
        ["BOB", "BOB"],
      ]);
      expect(result.pages.every((p) => p.annotations.every((a) => a.ownerCorrect))).toBe(true);
      const extracted = await inspectExport(
        (await Effect.runPromise(service.buildPDF([pages[0]]))).data
      );
      expect(extracted.pageObjects).toBe(1);
      expect(extracted.widgetObjects).toBe(4);
      expect(extracted.orphanKids).toBe(false);
      expect(extracted.serialized).not.toContain("OMITTED_FIELD_ANSWER");
      expect(extracted.serialized).not.toContain(
        PDFHexString.fromText("OMITTED_FIELD_ANSWER").toString()
      );
      const baseline = await inspectExport(
        (await Effect.runPromise(service.buildPDF(createPageStates(a, 2)))).data
      );
      const unsupported = (page: (typeof result.pages)[number]) =>
        page.annotations
          .filter((a) => ["locked", "accepted"].includes(a.name))
          .map(({ siblings, ...a }) => ({ ...a, siblingCount: siblings?.length }));
      expect(unsupported(result.pages[3])).toEqual(unsupported(baseline.pages[0]));
      expect(
        inspectPDFFields(await PDFDocument.load(await a.arrayBuffer()))
          .widgets.filter((w) => w.fieldRef === fixture.fieldRef)
          .map((w) => w.value)
      ).toEqual(["INHERITED", "INHERITED", "INHERITED"]);
    } finally {
      await Effect.runPromise(service.dispose());
    }
  });
});
