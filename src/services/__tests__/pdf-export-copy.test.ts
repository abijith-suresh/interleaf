import { Effect } from "effect";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFInvalidObject,
  PDFName,
  PDFNull,
  PDFNumber,
  type PDFObject,
  PDFRef,
  PDFString,
} from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import type { PageState } from "../../types/interfaces";
import { PDFExportCopy, validatePDFSourcePages } from "../pdf-export-copy";
import { PDFOperationsService } from "../pdf-operations-service";
import {
  type DestinationKind,
  exportCrossPageButtonFixture,
  exportFormFixture,
  exportLinkFixture,
  exportOptionalActionFixture,
  exportPageCountFixture,
  exportPageIndexFixture,
  exportResourceNameFixture,
  INDEX_PAGE_TEXT,
  OMITTED_ANSWER,
  OMITTED_CONTENT,
  type OptionalActionContext,
  type OptionalActionKind,
} from "./pdf-export-fixtures";
import { inspectExport, retainedMetadata } from "./pdf-export-inspection";
import { createPageState } from "./pdf-fixtures";

const N = PDFName.of;
function file(bytes: Uint8Array, name = "same.pdf") {
  return new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
}
async function build(pages: PageState[], selectedIndices?: number[]) {
  const service = new PDFOperationsService({});
  try {
    return (await Effect.runPromise(service.buildPDF(pages, { selectedIndices }))).data;
  } finally {
    await Effect.runPromise(service.dispose());
  }
}
async function baseline(pages: PageState[]) {
  const out = await PDFDocument.create();
  for (const page of pages) {
    const source = await PDFDocument.load(await page.sourceFile.arrayBuffer());
    const [copy] = await out.copyPages(source, [page.sourcePageNumber - 1]);
    out.addPage(copy);
  }
  return out.save();
}
function expectAbsent(serialized: string, text: string) {
  expect(serialized).not.toContain(text);
  expect(serialized).not.toContain(PDFHexString.fromText(text).toString().slice(1, -1));
  expect(serialized).not.toContain(
    Array.from(new TextEncoder().encode(text), (byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

describe("PDF export ownership", () => {
  it("records the main saved-byte leak, then removes omitted branches and orphan content", async () => {
    const source = file(await exportFormFixture());
    const pages = [createPageState(source, 1)];
    const before = await inspectExport(await baseline(pages));
    expect(before.pageObjects).toBe(3);
    expect(before.widgetObjects).toBe(10);
    expect(before.orphanKids).toBe(true);
    expect(before.serialized).toContain(PDFHexString.fromText(OMITTED_ANSWER).toString());
    const after = await inspectExport(await build(pages));
    expect(after.pageObjects).toBe(1);
    expect(after.widgetObjects).toBe(4);
    expect(after.orphanKids).toBe(false);
    expectAbsent(after.serialized, OMITTED_ANSWER);
    expectAbsent(after.serialized, OMITTED_CONTENT);
    expectAbsent(after.serialized, "InterleafExportPage");
    expect(after.serialized).not.toContain("1000000000000");
    expect(retainedMetadata(after)).toEqual(retainedMetadata(before));
    expect(after.pages[0].annotations.map((a) => a.siblings)).toEqual([[0, 1], [0, 1], [2], [3]]);
    expect(after.pages[0].annotations.every((a) => a.ownerCorrect)).toBe(true);
    expect(after.hasAcroForm).toBe(false);
  });
  it.each([[2], [1, 2], [2, 1], [1, 1, 2, 2]])(
    "preserves retained values/AP/geometry for layout %j",
    async (...layout) => {
      const source = file(await exportFormFixture());
      const pages = layout.map((number, index) =>
        createPageState(source, number, { id: String(index) })
      );
      const before = await inspectExport(await baseline(pages)),
        after = await inspectExport(await build(pages));
      expect(retainedMetadata(after)).toEqual(retainedMetadata(before));
      expect(after.pageObjects).toBe(layout.length);
      expect(after.orphanKids).toBe(false);
      expect(after.pages.every((p) => p.annotations.every((a) => a.ownerCorrect))).toBe(true);
      expect(after.serialized).toContain(PDFHexString.fromText(OMITTED_ANSWER).toString());
    }
  );
  it("uses the actual selection/deletion scope and restores full content on a later export", async () => {
    const source = file(await exportFormFixture());
    const pages = [
      createPageState(source, 1),
      createPageState(source, 2, { markedForDeletion: true }),
    ];
    const marked = await inspectExport(await build(pages));
    expect(marked.pageObjects).toBe(1);
    expectAbsent(marked.serialized, OMITTED_ANSWER);
    pages[1].markedForDeletion = false;
    const selected = await inspectExport(await build(pages, [0]));
    expectAbsent(selected.serialized, OMITTED_ANSWER);
    const restored = await inspectExport(await build(pages));
    expect(restored.pageObjects).toBe(2);
    expect(restored.serialized).toContain(PDFHexString.fromText(OMITTED_ANSWER).toString());
  });
  it("keeps equal-filename Files and edited duplicate sources independent", async () => {
    const a = file(await exportFormFixture("Alice")),
      b = file(await exportFormFixture("Bob")),
      duplicate = file(await exportFormFixture("Detached"));
    const pages = [
      createPageState(a, 1),
      createPageState(duplicate, 1),
      createPageState(a, 2),
      createPageState(b, 1),
    ];
    const after = await inspectExport(await build(pages));
    expect(
      after.pages.map((p) =>
        p.annotations.filter((a) => a.name === "person.name").map((a) => a.value)
      )
    ).toEqual([["Alice", "Alice"], ["Detached", "Detached"], ["Alice"], ["Bob", "Bob"]]);
    expect(after.pageObjects).toBe(4);
    expect(after.orphanKids).toBe(false);
  });
  it("does not mutate source bytes or cached documents across repeated exports", async () => {
    const bytes = await exportFormFixture(),
      source = file(bytes);
    const originalLoad = PDFDocument.load.bind(PDFDocument);
    const cache: { doc: PDFDocument; objects: string[] }[] = [];
    const spy = vi.spyOn(PDFDocument, "load").mockImplementation(async (data, options) => {
      const doc = await originalLoad(data, options);
      cache.push({
        doc,
        objects: doc.context.enumerateIndirectObjects().map(([, o]) => o.toString()),
      });
      return doc;
    });
    const service = new PDFOperationsService({});
    try {
      await Effect.runPromise(service.buildPDF([createPageState(source, 1)]));
      await Effect.runPromise(service.buildPDF([createPageState(source, 2)]));
      // One cached source, then one private document per export.
      expect(cache).toHaveLength(3);
      expect(cache[0].doc.context.enumerateIndirectObjects().map(([, o]) => o.toString())).toEqual(
        cache[0].objects
      );
      expect(new Uint8Array(await source.arrayBuffer())).toEqual(bytes);
    } finally {
      spy.mockRestore();
      await Effect.runPromise(service.dispose());
    }
  });
  it("rejects positional button Opt pruning", async () => {
    const source = file(await exportCrossPageButtonFixture());
    await expect(build([createPageState(source, 2)])).rejects.toMatchObject({
      operation: "reconcile-export",
      file: source,
      message: "This PDF has linked choice fields that cannot be preserved in this export.",
    });
  });
  // Every widget is retained, so Kids and Opt stay positionally aligned.
  it.each([[[1, 2]], [[2, 1]], [[1, 2, 1, 2]]])(
    "keeps a cross-page button group whole for layout %j",
    async (layout) => {
      const source = file(await exportCrossPageButtonFixture());
      const saved = await PDFDocument.load(
        await build(layout.map((n) => createPageState(source, n)))
      );
      for (const page of saved.getPages()) {
        const field = page.node
          .lookup(N("Annots"), PDFArray)
          .lookup(0, PDFDict)
          .lookup(N("Parent"), PDFDict);
        expect(field.lookup(N("Kids"), PDFArray).size()).toBe(2);
        expect(field.lookup(N("Opt"), PDFArray).size()).toBe(2);
      }
    }
  );
  it("handles merged widget/terminal dictionaries without inventing field trees", async () => {
    const doc = await PDFDocument.create(),
      page = doc.addPage();
    page.node.addAnnot(
      doc.context.register(
        doc.context.obj({
          Type: "Annot",
          Subtype: "Widget",
          FT: "Tx",
          T: PDFString.of("merged"),
          V: PDFString.of("Kept"),
          Rect: [10, 10, 110, 30],
          P: page.ref,
        })
      )
    );
    const out = await inspectExport(await build([createPageState(file(await doc.save()), 1)]));
    expect(out.pageObjects).toBe(1);
    expect(out.pages[0].annotations[0]).toMatchObject({
      name: "merged",
      type: "/Tx",
      value: "Kept",
      ownerCorrect: true,
    });
  });
  it.each(["cycle", "missing-child", "wrong-kid-type"])(
    "fails clearly on malformed field graph: %s",
    async (kind) => {
      const doc = await PDFDocument.load(await exportFormFixture());
      const widget = doc.getPage(0).node.lookup(N("Annots"), PDFArray).lookup(0, PDFDict);
      const parent = widget.lookup(N("Parent"), PDFDict);
      if (kind === "cycle") parent.set(N("Parent"), doc.context.register(parent));
      if (kind === "missing-child") parent.set(N("Kids"), doc.context.obj([]));
      if (kind === "wrong-kid-type")
        parent.set(
          N("Kids"),
          doc.context.obj([
            PDFNumber.of(3),
            doc.getPage(0).node.lookup(N("Annots"), PDFArray).get(0),
          ])
        );
      await expect(
        build([createPageState(file(await doc.save({ updateFieldAppearances: false })), 1)])
      ).rejects.toMatchObject({ operation: "reconcile-export" });
    }
  );
  it("collision-checks provenance even in direct dictionaries and removes every injected key/value", async () => {
    const doc = await PDFDocument.create(),
      page = doc.addPage();
    page.node.set(
      N("Custom"),
      doc.context.obj({ InterleafExportPage0: PDFString.of("Original custom data") })
    );
    const f = file(await doc.save()),
      privateDoc = await PDFDocument.load(await f.arrayBuffer()),
      out = await PDFDocument.create();
    const helper = new PDFExportCopy(out, [{ file: f, doc: privateDoc }]);
    out.addPage((await helper.copyPages([{ file: f, pageNumber: 1 }]))[0]);
    await helper.finish();
    const result = await inspectExport(await out.save());
    expect(result.serialized).toContain("/InterleafExportPage0 (Original custom data)");
    expect(result.serialized).not.toContain("InterleafExportPage1");
    expect(result.serialized).not.toContain("1000000000000");
  });
});

for (const kind of ["direct", "goto", "legacy", "names"] as DestinationKind[]) {
  describe(`internal destinations: ${kind}`, () => {
    it.each([[1], [2], [1, 2], [2, 1], [1, 2, 1, 2]])(
      "maps retained first occurrences and inactivates omitted targets for %j",
      async (...layout) => {
        const source = file(await exportLinkFixture(kind));
        const bytes = await build(layout.map((n) => createPageState(source, n)));
        const out = await PDFDocument.load(bytes);
        expect((await inspectExport(bytes)).pageObjects).toBe(layout.length);
        for (const [index, number] of layout.entries())
          if (number === 1) {
            const annots = out.getPage(index).node.lookup(N("Annots"), PDFArray),
              link = annots.lookup(0, PDFDict);
            expect(link.lookup(N("Contents"), PDFString).decodeText()).toBe("Go to page two");
            const dest =
              kind === "goto"
                ? link.lookupMaybe(N("A"), PDFDict)?.lookupMaybe(N("D"), PDFArray)
                : link.lookupMaybe(N("Dest"), PDFArray);
            const target = layout.indexOf(2);
            if (target === -1) {
              expect(dest).toBeUndefined();
              if (kind === "goto") expect(link.has(N("A"))).toBe(false);
              expectAbsent((await inspectExport(bytes)).serialized, OMITTED_CONTENT);
            } else expect(dest?.get(0)).toBe(out.getPage(target).ref);
            expect(
              annots
                .lookup(1, PDFDict)
                .lookup(N("A"), PDFDict)
                .lookup(N("URI"), PDFString)
                .decodeText()
            ).toBe("https://example.com/");
            expect(annots.lookup(2, PDFDict).lookup(N("A"), PDFDict).get(N("S"))).toBe(N("GoToR"));
          }
      }
    );
  });
}
it("never aliases destinations from distinct same-name Files", async () => {
  const a = file(await exportLinkFixture("direct")),
    b = file(await exportLinkFixture("names"));
  const bytes = await build([
    createPageState(a, 1),
    createPageState(b, 1),
    createPageState(b, 2),
    createPageState(a, 2),
  ]);
  const out = await PDFDocument.load(bytes);
  expect(
    out
      .getPage(0)
      .node.lookup(N("Annots"), PDFArray)
      .lookup(0, PDFDict)
      .lookup(N("Dest"), PDFArray)
      .get(0)
  ).toBe(out.getPage(3).ref);
  expect(
    out
      .getPage(1)
      .node.lookup(N("Annots"), PDFArray)
      .lookup(0, PDFDict)
      .lookup(N("Dest"), PDFArray)
      .get(0)
  ).toBe(out.getPage(2).ref);
});
it("fails instead of emitting an orphan Page through an unhandled annotation reference", async () => {
  const doc = await PDFDocument.create(),
    p1 = doc.addPage(),
    p2 = doc.addPage();
  p1.node.addAnnot(
    doc.context.register(
      doc.context.obj({ Subtype: "Text", Rect: [0, 0, 10, 10], CustomPage: p2.ref })
    )
  );
  const source = file(await doc.save());
  await expect(build([createPageState(source, 1)])).rejects.toMatchObject({
    operation: "reconcile-export",
    message: "Unsupported omitted Page reference at /CustomPage",
  });
});

it("preserves retained script and unsigned-signature metadata and the existing XFA baseline", async () => {
  const doc = await PDFDocument.load(await exportFormFixture());
  const page = doc.getPage(1),
    annots = page.node.lookup(N("Annots"), PDFArray);
  const script = doc.context.obj({
    S: "JavaScript",
    JS: PDFString.of("app.alert('retained script');"),
  });
  annots.lookup(0, PDFDict).set(N("AA"), doc.context.obj({ K: script }));
  doc.getForm().acroForm.dict.set(N("XFA"), PDFString.of("Original XFA catalog payload"));
  const source = file(await doc.save({ updateFieldAppearances: false })),
    pages = [createPageState(source, 2)];
  const before = await inspectExport(await baseline(pages)),
    after = await inspectExport(await build(pages));
  expect(retainedMetadata(after)).toEqual(retainedMetadata(before));
  expect(after.serialized).toContain("app.alert('retained script');");
  expect(after.pages[0].annotations.find((a) => a.name === "signature")?.type).toBe("/Sig");
  // Root AcroForm/XFA already is not copied by the existing export. No new support claim.
  expect(before.serialized).not.toContain("Original XFA catalog payload");
  expect(after.serialized).not.toContain("Original XFA catalog payload");
});
it("keeps same-page popup/markup references attached to the actual copied annotations", async () => {
  const doc = await PDFDocument.create(),
    page = doc.addPage();
  const parent = doc.context.register(
    doc.context.obj({
      Type: "Annot",
      Subtype: "Text",
      Rect: [10, 10, 30, 30],
      P: page.ref,
      Contents: PDFString.of("Retained note"),
    })
  );
  const popup = doc.context.register(
    doc.context.obj({
      Type: "Annot",
      Subtype: "Popup",
      Rect: [40, 40, 100, 100],
      P: page.ref,
      Parent: parent,
    })
  );
  doc.context.lookup(parent, PDFDict).set(N("Popup"), popup);
  page.node.addAnnot(parent);
  page.node.addAnnot(popup);
  const source = file(await doc.save()),
    out = await PDFDocument.load(
      await build([createPageState(source, 1), createPageState(source, 1)])
    );
  for (const copied of out.getPages()) {
    const annotations = copied.node.lookup(N("Annots"), PDFArray);
    expect(annotations.lookup(0, PDFDict).get(N("Popup"))).toBe(annotations.get(1));
    expect(annotations.lookup(1, PDFDict).get(N("Parent"))).toBe(annotations.get(0));
  }
  expect(out.getPage(0).node.lookup(N("Annots"), PDFArray).get(0)).not.toBe(
    out.getPage(1).node.lookup(N("Annots"), PDFArray).get(0)
  );
});
it("rejects cyclic named destinations and omitted-target GoTo action chains without dropping unrelated actions", async () => {
  for (const kind of ["names", "next"]) {
    const doc = await PDFDocument.load(
      await exportLinkFixture(kind === "names" ? "names" : "goto")
    );
    const link = doc.getPage(0).node.lookup(N("Annots"), PDFArray).lookup(0, PDFDict);
    if (kind === "names") {
      const tree = doc.catalog.lookup(N("Names"), PDFDict).lookup(N("Dests"), PDFDict);
      tree.set(N("Kids"), doc.context.obj([doc.context.register(tree)]));
    } else
      link
        .lookup(N("A"), PDFDict)
        .set(
          N("Next"),
          doc.context.obj({ S: "URI", URI: PDFString.of("https://example.com/next") })
        );
    await expect(build([createPageState(file(await doc.save()), 1)])).rejects.toMatchObject({
      operation: "reconcile-export",
      message:
        kind === "names"
          ? "Cyclic destination name tree"
          : "Omitted-target GoTo with Next actions is unsupported",
    });
  }
});
it("attributes a merged linked-choice rejection to its actual source File", async () => {
  const first = file(await exportFormFixture()),
    choices = file(await exportCrossPageButtonFixture());
  await expect(
    build([createPageState(first, 1), createPageState(choices, 2)])
  ).rejects.toMatchObject({ operation: "reconcile-export", file: choices });
});
it.each(["absent", "wrong"])(
  "derives widget ownership from actual Annots when source P is %s",
  async (kind) => {
    const doc = await PDFDocument.load(await exportFormFixture());
    for (const page of doc.getPages())
      for (const raw of page.node.lookup(N("Annots"), PDFArray).asArray()) {
        const annotation = doc.context.lookup(raw, PDFDict);
        if (kind === "absent") annotation.delete(N("P"));
        else annotation.set(N("P"), doc.getPage(1).ref);
      }
    const source = file(await doc.save({ updateFieldAppearances: false }));
    const result = await inspectExport(await build([createPageState(source, 1)]));
    expect(result.pageObjects).toBe(1);
    expect(result.widgetObjects).toBe(4);
    expect(result.orphanKids).toBe(false);
    expect(result.pages[0].annotations.every((a) => a.ownerCorrect)).toBe(true);
    expectAbsent(result.serialized, OMITTED_ANSWER);
    expectAbsent(result.serialized, OMITTED_CONTENT);
  }
);

describe("resolved PDF role names", () => {
  it.each([false, true])(
    "prunes nested omitted answers with P absent and indirect Subtype=%s",
    async (indirect) => {
      const doc = await PDFDocument.create(),
        p1 = doc.addPage(),
        p2 = doc.addPage();
      const keep = doc.getForm().createTextField("group.keep"),
        omit = doc.getForm().createTextField("group.omit");
      keep.setText("Retained answer");
      keep.addToPage(p1, { x: 10, y: 20, width: 150, height: 30 });
      omit.setText("INDEPENDENT_OMITTED_ANSWER_83ec532");
      omit.addToPage(p2, { x: 10, y: 20, width: 300, height: 30 });
      doc.getForm().updateFieldAppearances();
      for (const p of [p1, p2])
        for (const raw of p.node.lookup(N("Annots"), PDFArray).asArray()) {
          const widget = doc.context.lookup(raw, PDFDict);
          widget.delete(N("P"));
          if (indirect) widget.set(N("Subtype"), doc.context.register(N("Widget")));
        }
      const output = await build([
        createPageState(file(await doc.save({ updateFieldAppearances: false })), 1),
      ]);
      const saved = await inspectExport(output);
      expectAbsent(saved.serialized, "INDEPENDENT_OMITTED_ANSWER_83ec532");
      expect(saved.pages[0].annotations).toHaveLength(1);
      expect(saved.pages[0].annotations[0]).toMatchObject({
        name: "group.keep",
        value: "Retained answer",
        ownerCorrect: true,
      });
      expect(saved.pageObjects).toBe(1);
      expect(saved.widgetObjects).toBe(1);
      expect(saved.orphanKids).toBe(false);
    }
  );
  it.each([false, true])(
    "rejects an omitted CustomPage with an untagged indirect Type=%s",
    async (indirect) => {
      const doc = await PDFDocument.create(),
        p1 = doc.addPage(),
        p2 = doc.addPage();
      p1.drawText("Retained page");
      p2.drawText("INDEPENDENT_OMITTED_PAGE_7cd6532");
      p1.node.set(N("CustomPage"), p2.ref);
      doc.removePage(1);
      if (indirect) p2.node.set(N("Type"), doc.context.register(N("Page")));
      const source = file(await doc.save());
      await expect(build([createPageState(source, 1)])).rejects.toMatchObject({
        operation: "reconcile-export",
        file: source,
        message: "Unsupported omitted Page reference at /CustomPage",
      });
    }
  );
  it.each([[1], [1, 2], [2, 1]])(
    "resolves indirect GoTo S with named destination for %j",
    async (...layout) => {
      const doc = await PDFDocument.load(await exportLinkFixture("names"));
      const link = doc.getPage(0).node.lookup(N("Annots"), PDFArray).lookup(0, PDFDict);
      link.delete(N("Dest"));
      link.set(
        N("A"),
        doc.context.obj({ S: doc.context.register(N("GoTo")), D: PDFString.of("target") })
      );
      const source = file(await doc.save()),
        saved = await PDFDocument.load(await build(layout.map((n) => createPageState(source, n))));
      const action = saved
        .getPage(layout.indexOf(1))
        .node.lookup(N("Annots"), PDFArray)
        .lookup(0, PDFDict)
        .lookupMaybe(N("A"), PDFDict);
      if (layout.includes(2))
        expect(action?.lookup(N("D"), PDFArray).get(0)).toBe(saved.getPage(layout.indexOf(2)).ref);
      else expect(action).toBeUndefined();
    }
  );
  it("retains the Opt rejection for an inherited indirect FT name", async () => {
    const doc = await PDFDocument.load(await exportCrossPageButtonFixture());
    const field = doc
      .getPage(1)
      .node.lookup(N("Annots"), PDFArray)
      .lookup(0, PDFDict)
      .lookup(N("Parent"), PDFDict);
    field.set(N("FT"), doc.context.register(N("Btn")));
    const source = file(await doc.save({ updateFieldAppearances: false }));
    await expect(build([createPageState(source, 2)])).rejects.toMatchObject({
      operation: "reconcile-export",
      file: source,
      message: "This PDF has linked choice fields that cannot be preserved in this export.",
    });
  });
  for (const role of ["Subtype", "Type", "S", "FT"]) {
    it.each(["wrong-type", "cycle", "missing"])(
      `rejects ${role} role with %s name instead of bypassing reconciliation`,
      async (malformed) => {
        const doc = await PDFDocument.load(await exportFormFixture());
        const widget = doc.getPage(0).node.lookup(N("Annots"), PDFArray).lookup(0, PDFDict);
        let target = widget;
        if (role === "Type") {
          target = doc.getPage(1).node;
          doc.getPage(0).node.set(N("CustomPage"), doc.getPage(1).ref);
        }
        if (role === "S") {
          target = doc.context.obj({ D: doc.context.obj([doc.getPage(1).ref, "Fit"]) });
          widget.set(N("A"), target);
        }
        if (role === "FT") target = widget.lookup(N("Parent"), PDFDict);
        if (malformed === "wrong-type")
          target.set(
            N(role),
            PDFString.of(
              role === "Type"
                ? "Page"
                : role === "Subtype"
                  ? "Widget"
                  : role === "S"
                    ? "GoTo"
                    : "Btn"
            )
          );
        else {
          const ref = doc.context.nextRef();
          if (malformed === "cycle") doc.context.assign(ref, ref);
          target.set(N(role), ref);
        }
        const source = file(await doc.save({ updateFieldAppearances: false }));
        await expect(build([createPageState(source, 1)])).rejects.toMatchObject({
          _tag: "PDFProcessingError",
        });
      }
    );
  }
  it("rejects missing required annotation Subtype", async () => {
    const doc = await PDFDocument.load(await exportFormFixture());
    doc.getPage(0).node.lookup(N("Annots"), PDFArray).lookup(0, PDFDict).delete(N("Subtype"));
    await expect(
      build([createPageState(file(await doc.save({ updateFieldAppearances: false })), 1)])
    ).rejects.toMatchObject({
      operation: "reconcile-export",
      message: "Missing PDF name /Subtype",
    });
  });
});

describe("source page indexing boundary", () => {
  it("records the saved-byte wrong-page baseline for an indirect Page role", async () => {
    const bytes = await exportPageIndexFixture(true),
      source = file(bytes);
    const library = await PDFDocument.load(bytes);
    expect(library.getPages()).toHaveLength(2);
    const before = await inspectExport(await baseline([createPageState(source, 2)]));
    expect(before.serialized).toContain(
      Array.from(new TextEncoder().encode(INDEX_PAGE_TEXT[2]), (b) =>
        b.toString(16).padStart(2, "0")
      )
        .join("")
        .toUpperCase()
    );
    expectAbsent(before.serialized, INDEX_PAGE_TEXT[1]);
    await expect(build([createPageState(source, 2)])).rejects.toMatchObject({
      operation: "reconcile-export",
      file: source,
      message: "This PDF's page order cannot be safely copied.",
    });
  });
  it.each([[1], [2], [1, 2, 3]])(
    "rejects inconsistent source indexing before any copy for %j",
    async (...layout) => {
      const bytes = await exportPageIndexFixture(true),
        source = file(bytes, "inconsistent.pdf");
      const safe = file(await exportFormFixture(), "safe.pdf");
      const cached = await PDFDocument.load(bytes),
        objects = cached.context.enumerateIndirectObjects().map(([, o]) => o.toString());
      const load = PDFDocument.load.bind(PDFDocument);
      let served = false;
      // The first load of these bytes is the cached source; later loads are private.
      const loadSpy = vi.spyOn(PDFDocument, "load").mockImplementation((data, options) => {
        if (served || !(data instanceof ArrayBuffer) || data.byteLength !== bytes.byteLength)
          return load(data, options);
        served = true;
        return Promise.resolve(cached);
      });
      const copy = vi.spyOn(PDFDocument.prototype, "copyPages");
      const service = new PDFOperationsService({});
      try {
        await expect(
          Effect.runPromise(
            service.buildPDF([
              createPageState(safe, 1),
              ...layout.map((n) => createPageState(source, n)),
            ])
          )
        ).rejects.toMatchObject({
          operation: "reconcile-export",
          file: source,
          message: "This PDF's page order cannot be safely copied.",
        });
        expect(copy).not.toHaveBeenCalled();
        expect(new Uint8Array(await source.arrayBuffer())).toEqual(bytes);
        expect(cached.context.enumerateIndirectObjects().map(([, o]) => o.toString())).toEqual(
          objects
        );
      } finally {
        loadSpy.mockRestore();
        copy.mockRestore();
        await Effect.runPromise(service.dispose());
      }
    }
  );
  it("rejects an inconsistent decrypted export source before indexed geometry", async () => {
    const source = file(new Uint8Array([1]), "protected.pdf"),
      decrypted = file(await exportPageIndexFixture(true), "protected.pdf");
    const getPageGeometry = vi.fn(),
      getPage = vi.spyOn(PDFDocument.prototype, "getPage"),
      service = new PDFOperationsService({
        getExportSource: () => Effect.succeed(decrypted),
        getPageGeometry,
      });
    try {
      await expect(
        Effect.runPromise(service.buildPDF([createPageState(source, 2, { rotation: 90 })]))
      ).rejects.toMatchObject({ operation: "reconcile-export", file: source });
      expect(getPage).not.toHaveBeenCalled();
      expect(getPageGeometry).not.toHaveBeenCalled();
    } finally {
      getPage.mockRestore();
      await Effect.runPromise(service.dispose());
    }
  });
  it.each([[2], [1], [3, 2, 1], [1, 2, 3]])(
    "preserves direct Page source indexing for %j",
    async (...layout) => {
      const bytes = await exportPageIndexFixture(false),
        source = file(bytes);
      const output = await inspectExport(
        await build(layout.map((n) => createPageState(source, n)))
      );
      expect(output.pages.map((p) => p.media.width)).toEqual(layout.map((n) => 390 + n * 10));
      expect(new Uint8Array(await source.arrayBuffer())).toEqual(bytes);
    }
  );
  it.each(["cycle", "missing-role", "direct-page", "wrong-role", "order", "count", "deep"])(
    "rejects unsupported native page-tree %s",
    async (kind) => {
      const doc = await PDFDocument.create(),
        p1 = doc.addPage(),
        p2 = doc.addPage();
      const root = doc.catalog.lookup(N("Pages"), PDFDict),
        kids = root.lookup(N("Kids"), PDFArray);
      if (kind === "cycle") kids.push(doc.catalog.get(N("Pages"))!);
      if (kind === "missing-role") p2.node.delete(N("Type"));
      if (kind === "direct-page") kids.set(1, p2.node);
      if (kind === "wrong-role") p2.node.set(N("Type"), N("Other"));
      if (kind === "order") vi.spyOn(doc, "getPages").mockReturnValue([p2, p1]);
      if (kind === "count") vi.spyOn(doc, "getPages").mockReturnValue([p1]);
      if (kind === "deep") {
        let branch = doc.context.obj({ Type: "Pages", Count: 1, Kids: [p2.ref] });
        for (let i = 0; i < 33; i++)
          branch = doc.context.obj({ Type: "Pages", Count: 1, Kids: [branch] });
        kids.set(1, branch);
      }
      const source = file(new Uint8Array());
      expect(() => validatePDFSourcePages(doc, source)).toThrowError(
        "This PDF's page order cannot be safely copied."
      );
    }
  );
});

describe("source subtree Counts", () => {
  for (const indirect of [false, true]) {
    it.each([[2], [1], [1, 2, 3, 4], [4, 2, 1]])(
      `rejects compensating indirect=${indirect} Counts before any indexed copy for %j`,
      async (...layout) => {
        const bytes = await exportPageCountFixture(indirect, false),
          source = file(bytes);
        const loaded = await PDFDocument.load(bytes);
        expect(loaded.getPages()).toHaveLength(4);
        // Old copyPages indexes the native second leaf, hidden in PDF.js's workspace.
        const before = await inspectExport(await baseline([createPageState(source, 2)]));
        expect(before.serialized).toContain(
          "48494444454E5F4E41544956455F504147455F54574F5F35316164"
        );
        const copy = vi.spyOn(PDFDocument.prototype, "copyPages");
        try {
          await expect(build(layout.map((n) => createPageState(source, n)))).rejects.toMatchObject({
            operation: "reconcile-export",
            file: source,
            message: "This PDF's page order cannot be safely copied.",
          });
          expect(copy).not.toHaveBeenCalled();
          expect(new Uint8Array(await source.arrayBuffer())).toEqual(bytes);
        } finally {
          copy.mockRestore();
        }
      }
    );
    it(`preserves valid indirect=${indirect} root/subtree Count controls`, async () => {
      const bytes = await exportPageCountFixture(indirect, true),
        source = file(bytes),
        doc = await PDFDocument.load(bytes);
      const objects = doc.context.enumerateIndirectObjects().map(([, o]) => o.toString());
      validatePDFSourcePages(doc, source);
      expect(doc.context.enumerateIndirectObjects().map(([, o]) => o.toString())).toEqual(objects);
      const output = await PDFDocument.load(
        await build([4, 2, 1].map((n) => createPageState(source, n)))
      );
      expect(output.getPages().map((p) => p.getWidth())).toEqual([430, 410, 400]);
    });
  }
  for (const root of [false, true])
    it.each([
      "missing",
      "wrong-type",
      "negative",
      "fractional",
      "unsafe",
      "cycle",
      "missing-ref",
      "excessive",
      "mismatch",
    ])(`rejects root=${root} Count %s before getPages`, async (kind) => {
      const doc = await PDFDocument.load(await exportPageCountFixture(false, true));
      const pages = doc.catalog.lookup(N("Pages"), PDFDict),
        target = root ? pages : pages.lookup(N("Kids"), PDFArray).lookup(0, PDFDict);
      if (kind === "missing") target.delete(N("Count"));
      else if (kind === "wrong-type") target.set(N("Count"), PDFString.of("2"));
      else if (kind === "cycle" || kind === "missing-ref") {
        const ref = doc.context.nextRef();
        if (kind === "cycle") doc.context.assign(ref, ref);
        target.set(N("Count"), ref);
      } else if (kind === "excessive") {
        let raw = doc.context.register(PDFNumber.of(2));
        for (let i = 0; i < 32; i++) raw = doc.context.register(raw);
        target.set(N("Count"), raw);
      } else
        target.set(
          N("Count"),
          PDFNumber.of(
            kind === "negative" ? -1 : kind === "fractional" ? 1.5 : kind === "unsafe" ? 2 ** 53 : 0
          )
        );
      const indexed = vi.spyOn(doc, "getPages"),
        objects = doc.context.enumerateIndirectObjects().map(([, o]) => o.toString());
      expect(() => validatePDFSourcePages(doc, file(new Uint8Array()))).toThrowError(
        "This PDF's page order cannot be safely copied."
      );
      expect(indexed).not.toHaveBeenCalled();
      expect(doc.context.enumerateIndirectObjects().map(([, o]) => o.toString())).toEqual(objects);
    });
  it("rejects bad Count in a decrypted export source before rotation or geometry", async () => {
    const source = file(new Uint8Array([1]), "protected.pdf"),
      decrypted = file(await exportPageCountFixture(true, false), "protected.pdf");
    const getPageGeometry = vi.fn(),
      indexed = vi.spyOn(PDFDocument.prototype, "getPage"),
      service = new PDFOperationsService({
        getExportSource: () => Effect.succeed(decrypted),
        getPageGeometry,
      });
    try {
      await expect(
        Effect.runPromise(service.buildPDF([createPageState(source, 2, { rotation: 90 })]))
      ).rejects.toMatchObject({ operation: "reconcile-export", file: source });
      expect(indexed).not.toHaveBeenCalled();
      expect(getPageGeometry).not.toHaveBeenCalled();
    } finally {
      indexed.mockRestore();
      await Effect.runPromise(service.dispose());
    }
  });
});
describe("resource and appearance lookup names are not roles", () => {
  for (const checkbox of [false, true])
    it.each(["S", "Type", "Control"])(
      `preserves checkbox=${checkbox} lookup key %s`,
      async (key) => {
        const bytes = await exportResourceNameFixture(key, checkbox),
          source = file(bytes),
          pages = [createPageState(source, 1)];
        const before = await inspectExport(await baseline(pages)),
          output = await build(pages),
          after = await inspectExport(output);
        expect(retainedMetadata(after)).toEqual(retainedMetadata(before));
        expect(after.pageObjects).toBe(1);
        expect(after.orphanKids).toBe(false);
        const doc = await PDFDocument.load(output),
          page = doc.getPage(0);
        if (checkbox) {
          const widget = page.node.lookup(N("Annots"), PDFArray).lookup(0, PDFDict);
          expect(widget.lookup(N("AS"))).toBe(N(key));
          expect(widget.lookup(N("Parent"), PDFDict).lookup(N("V"))).toBe(N(key));
          expect(widget.lookup(N("AP"), PDFDict).lookup(N("N"), PDFDict).has(N(key))).toBe(true);
        } else
          expect(
            page.node
              .lookup(N("Resources"), PDFDict)
              .lookup(N("Font"), PDFDict)
              .lookup(N(key), PDFDict)
              .lookup(N("Type"))
          ).toBe(N("Font"));
        expect(new Uint8Array(await source.arrayBuffer())).toEqual(bytes);
      }
    );
  it("keeps strict malformed action names in field AA and Next contexts", async () => {
    for (const context of ["AA", "Next"]) {
      const doc = await PDFDocument.load(await exportFormFixture()),
        widget = doc.getPage(0).node.lookup(N("Annots"), PDFArray).lookup(0, PDFDict),
        action = doc.context.obj({ S: PDFString.of("GoTo") });
      if (context === "AA")
        widget.lookup(N("Parent"), PDFDict).set(N("AA"), doc.context.obj({ K: action }));
      else
        widget.set(
          N("A"),
          doc.context.obj({ S: "URI", URI: PDFString.of("https://example.com/"), Next: [action] })
        );
      await expect(
        build([createPageState(file(await doc.save({ updateFieldAppearances: false })), 1)])
      ).rejects.toMatchObject({ operation: "reconcile-export", message: "Invalid PDF name /S" });
    }
  });
});

it("preserves and remaps known Next/additional actions without changing URI/remote/JS behavior", async () => {
  const doc = await PDFDocument.load(await exportLinkFixture("goto")),
    link = doc.getPage(0).node.lookup(N("Annots"), PDFArray).lookup(0, PDFDict);
  link.lookup(N("A"), PDFDict).set(
    N("Next"),
    doc.context.obj([
      { S: "URI", URI: PDFString.of("https://example.com/next") },
      { S: "GoToR", F: PDFString.of("remote.pdf"), D: PDFString.of("remote-target") },
      { S: "JavaScript", JS: PDFString.of("app.alert('keep');") },
      { S: doc.context.register(N("GoTo")), D: [doc.getPage(1).ref, "Fit"] },
    ])
  );
  link.set(N("AA"), doc.context.obj({ E: { S: "GoTo", D: [doc.getPage(0).ref, "Fit"] } }));
  const source = file(await doc.save()),
    output = await PDFDocument.load(await build([2, 1, 2].map((n) => createPageState(source, n))));
  const saved = output.getPage(1).node.lookup(N("Annots"), PDFArray).lookup(0, PDFDict),
    action = saved.lookup(N("A"), PDFDict),
    next = action.lookup(N("Next"), PDFArray);
  expect(action.lookup(N("D"), PDFArray).get(0)).toBe(output.getPage(0).ref);
  expect(next.lookup(0, PDFDict).lookup(N("URI"), PDFString).decodeText()).toBe(
    "https://example.com/next"
  );
  expect(next.lookup(1, PDFDict).lookup(N("D"), PDFString).decodeText()).toBe("remote-target");
  expect(next.lookup(2, PDFDict).lookup(N("JS"), PDFString).decodeText()).toBe(
    "app.alert('keep');"
  );
  expect(next.lookup(3, PDFDict).lookup(N("D"), PDFArray).get(0)).toBe(output.getPage(0).ref);
  expect(
    saved.lookup(N("AA"), PDFDict).lookup(N("E"), PDFDict).lookup(N("D"), PDFArray).get(0)
  ).toBe(output.getPage(1).ref);
});

describe("optional action null means absence", () => {
  const cases: [OptionalActionContext, OptionalActionKind][] = [];
  for (const context of ["page", "annotation", "field"] as const)
    for (const kind of [
      "null",
      "indirect-null",
      "chain-null",
      "aa-null",
      "aa-indirect-null",
      "empty",
      "absent",
      "valid",
    ] as const)
      cases.push([context, kind]);
  for (const context of ["A", "Next"] as const)
    for (const kind of ["null", "indirect-null", "chain-null", "absent", "valid"] as const)
      cases.push([context, kind]);
  cases.push(["Next", "empty"]);
  it.each(cases)("preserves text/value/AP for %s %s", async (context, kind) => {
    const bytes = await exportOptionalActionFixture(context, kind),
      source = file(bytes),
      pages = [createPageState(source, 1)];
    const before = await inspectExport(await baseline(pages)),
      after = await inspectExport(await build(pages));
    expect(retainedMetadata(after)).toEqual(retainedMetadata(before));
    expect(after.pageObjects).toBe(1);
    expect(after.widgetObjects).toBe(1);
    expect(after.orphanKids).toBe(false);
    expect(after.pages[0].annotations[0]).toMatchObject({
      name: "retained",
      value: "Retained answer",
      ownerCorrect: true,
    });
    expect(new Uint8Array(await source.arrayBuffer())).toEqual(bytes);
  });
  it.each([false, true])(
    "deactivates an omitted GoTo target with indirect Next null=%s without orphan payload",
    async (indirect) => {
      const doc = await PDFDocument.load(await exportLinkFixture("goto")),
        action = doc
          .getPage(0)
          .node.lookup(N("Annots"), PDFArray)
          .lookup(0, PDFDict)
          .lookup(N("A"), PDFDict);
      action.set(N("Next"), indirect ? doc.context.register(PDFNull) : PDFNull);
      const after = await inspectExport(await build([createPageState(file(await doc.save()), 1)]));
      expect(after.pageObjects).toBe(1);
      expectAbsent(after.serialized, OMITTED_CONTENT);
      const saved = await PDFDocument.load(
        await build([createPageState(file(await doc.save()), 1)])
      );
      expect(
        saved.getPage(0).node.lookup(N("Annots"), PDFArray).lookup(0, PDFDict).has(N("A"))
      ).toBe(false);
    }
  );
  for (const slot of ["AA", "event", "A", "Next"] as const)
    it.each(["number", "string", "cycle", "excessive"])(
      `rejects non-null malformed optional ${slot} %s`,
      async (kind) => {
        const doc = await PDFDocument.load(await exportOptionalActionFixture("page", "absent")),
          page = doc.getPage(0),
          widget = page.node.lookup(N("Annots"), PDFArray).lookup(0, PDFDict);
        const raw = kind === "number" ? PDFNumber.of(3) : PDFString.of("invalid");
        let value: PDFObject = raw;
        if (kind === "cycle") {
          const ref = doc.context.nextRef();
          doc.context.assign(ref, ref);
          value = ref;
        }
        if (kind === "excessive") {
          value = PDFNull;
          for (let i = 0; i < 33; i++) value = doc.context.register(value);
        }
        if (slot === "AA") page.node.set(N("AA"), value);
        else if (slot === "event") page.node.set(N("AA"), doc.context.obj({ O: value }));
        else if (slot === "A") widget.set(N("A"), value);
        else
          widget.set(
            N("A"),
            doc.context.obj({ S: "URI", URI: PDFString.of("https://example.com/"), Next: value })
          );
        await expect(
          build([createPageState(file(await doc.save({ updateFieldAppearances: false })), 1)])
        ).rejects.toMatchObject(
          kind === "cycle" || kind === "excessive"
            ? {
                operation: "reconcile-export",
                message: "Cyclic or excessive PDF action references",
              }
            : { _tag: "PDFProcessingError" }
        );
      }
    );
  for (const role of ["Type", "Count", "Subtype", "S"] as const)
    it.each([false, true])(
      `keeps ${role} null invalid in required semantic context, indirect=%s`,
      async (indirect) => {
        const doc = await PDFDocument.load(await exportOptionalActionFixture("page", "absent")),
          page = doc.getPage(0),
          widget = page.node.lookup(N("Annots"), PDFArray).lookup(0, PDFDict);
        const value = indirect ? doc.context.register(PDFNull) : PDFNull;
        if (role === "Count") doc.catalog.lookup(N("Pages"), PDFDict).set(N("Count"), value);
        else if (role === "Type") page.node.set(N("Type"), value);
        else if (role === "Subtype") widget.set(N("Subtype"), value);
        else widget.set(N("A"), doc.context.obj({ S: value }));
        await expect(
          build([createPageState(file(await doc.save({ updateFieldAppearances: false })), 1)])
        ).rejects.toMatchObject({ operation: "reconcile-export" });
      }
    );
});

it("keeps valid Next actions alongside direct and indirect null action slots", async () => {
  const doc = await PDFDocument.load(await exportOptionalActionFixture("Next", "valid")),
    widget = doc.getPage(0).node.lookup(N("Annots"), PDFArray).lookup(0, PDFDict),
    action = widget.lookup(N("A"), PDFDict);
  action.set(
    N("Next"),
    doc.context.obj([
      PDFNull,
      doc.context.register(PDFNull),
      { S: "URI", URI: PDFString.of("https://example.com/next") },
    ])
  );
  const saved = await PDFDocument.load(
    await build([createPageState(file(await doc.save({ updateFieldAppearances: false })), 1)])
  );
  const next = saved
    .getPage(0)
    .node.lookup(N("Annots"), PDFArray)
    .lookup(0, PDFDict)
    .lookup(N("A"), PDFDict)
    .lookup(N("Next"), PDFArray);
  expect(next.size()).toBe(3);
  expect(saved.context.lookup(next.get(0))).toBe(PDFNull);
  expect(saved.context.lookup(next.get(1))).toBe(PDFNull);
  expect(next.lookup(2, PDFDict).lookup(N("URI"), PDFString).decodeText()).toBe(
    "https://example.com/next"
  );
});

describe("missing references are null", () => {
  const missing = (doc: PDFDocument, n: number) => PDFRef.of(doc.context.largestObjectNumber + n);
  const info = (doc: PDFDocument) => doc.context.lookup(doc.context.trailerInfo.Info, PDFDict);
  it("exports a file whose unused Info dictionary has a dangling reference", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.addPage();
    info(doc).set(N("Foo"), missing(doc, 100));
    const saved = await PDFDocument.load(await build([createPageState(file(await doc.save()), 2)]));
    expect(saved.getPageCount()).toBe(1);
  });

  it("exports pages whose annotation and resources hold dangling references", async () => {
    const doc = await PDFDocument.create(),
      page = doc.addPage(),
      gone = missing(doc, 100);
    page.node.addAnnot(
      doc.context.register(doc.context.obj({ Subtype: "Text", Rect: [0, 0, 10, 10], Popup: gone }))
    );
    page.node.normalizedEntries().Resources.set(N("XObject"), doc.context.obj({ Gone: gone }));
    const saved = await PDFDocument.load(await build([createPageState(file(await doc.save()), 1)]));
    const node = saved.getPage(0).node;
    const popup = node.lookup(N("Annots"), PDFArray).lookup(0, PDFDict).get(N("Popup"));
    expect(popup).toBeInstanceOf(PDFRef);
    expect(saved.context.lookup(popup)).toBeUndefined();
    const xobject = node
      .lookup(N("Resources"), PDFDict)
      .lookup(N("XObject"), PDFDict)
      .get(N("Gone"));
    expect(xobject).toBeInstanceOf(PDFRef);
    expect(saved.context.lookup(xobject)).toBeUndefined();
  });

  it("drops missing /Annots entries and keeps the rest", async () => {
    const doc = await PDFDocument.create(),
      page = doc.addPage();
    page.node.set(
      N("Annots"),
      doc.context.obj([
        missing(doc, 100),
        doc.context.register(doc.context.obj({ Subtype: "Text", Rect: [0, 0, 10, 10] })),
      ])
    );
    const saved = await PDFDocument.load(await build([createPageState(file(await doc.save()), 1)]));
    const annots = saved.getPage(0).node.lookup(N("Annots"), PDFArray);
    expect(annots.size()).toBe(1);
    expect(annots.lookup(0, PDFDict).lookup(N("Subtype"))).toBe(N("Text"));
  });

  // Retained widgets share one copied field whose Kids keep the missing (null)
  // kid in place.
  it.each([[[1]], [[1, 2]]])(
    "keeps a missing field kid in place when exporting pages %j",
    async (pages) => {
      const doc = await PDFDocument.create(),
        p1 = doc.addPage(),
        p2 = doc.addPage(),
        field = doc.getForm().createTextField("answer");
      field.addToPage(p1);
      field.addToPage(p2);
      const gone = missing(doc, 100);
      field.acroField.dict.lookup(N("Kids"), PDFArray).push(gone);
      const bytes = await doc.save({ updateFieldAppearances: false }),
        source = file(bytes);
      const saved = await PDFDocument.load(
        await build(pages.map((n) => createPageState(source, n)))
      );
      const kids = saved
        .getPage(0)
        .node.lookup(N("Annots"), PDFArray)
        .lookup(0, PDFDict)
        .lookup(N("Parent"), PDFDict)
        .lookup(N("Kids"), PDFArray);
      expect(kids.size()).toBe(pages.length + 1);
      expect(saved.context.lookup(kids.get(pages.length))).toBeUndefined();
      expect(kids.asArray().filter((kid) => saved.context.lookup(kid))).toHaveLength(pages.length);
    }
  );

  it("treats missing link and page actions as absent", async () => {
    const doc = await PDFDocument.create(),
      page = doc.addPage();
    page.node.set(N("AA"), missing(doc, 100));
    page.node.addAnnot(
      doc.context.register(
        doc.context.obj({ Subtype: "Link", Rect: [0, 0, 10, 10], A: missing(doc, 101) })
      )
    );
    const saved = await PDFDocument.load(await build([createPageState(file(await doc.save()), 1)]));
    const node = saved.getPage(0).node;
    expect(saved.context.lookup(node.get(N("AA")))).toBeUndefined();
    const link = node.lookup(N("Annots"), PDFArray).lookup(0, PDFDict);
    expect(saved.context.lookup(link.get(N("A")))).toBeUndefined();
  });

  it.each(["Dest", "GoTo", "Page"] as const)(
    "drops a link destination whose %s target is missing",
    async (kind) => {
      const doc = await PDFDocument.create(),
        page = doc.addPage(),
        gone = missing(doc, 100);
      const link =
        kind === "Dest"
          ? { Dest: gone }
          : kind === "GoTo"
            ? { A: { S: "GoTo", D: gone } }
            : { Dest: [gone, "Fit"] };
      page.node.addAnnot(
        doc.context.register(doc.context.obj({ Subtype: "Link", Rect: [0, 0, 10, 10], ...link }))
      );
      const saved = await PDFDocument.load(
        await build([createPageState(file(await doc.save()), 1)])
      );
      const annot = saved.getPage(0).node.lookup(N("Annots"), PDFArray).lookup(0, PDFDict);
      expect(annot.has(N("Dest"))).toBe(false);
      expect(annot.has(N("A"))).toBe(false);
    }
  );

  it("walks arrays too large to spread into a call", async () => {
    const doc = await PDFDocument.create(),
      big = doc.context.register(doc.context.obj(Array.from({ length: 200_000 }, () => 0)));
    doc.addPage().node.set(N("Big"), big);
    info(doc).set(N("Big"), big);
    const out = await PDFDocument.create(),
      f = file(new Uint8Array()),
      copy = new PDFExportCopy(out, [{ file: f, doc }]);
    out.addPage((await copy.copyPages([{ file: f, pageNumber: 1 }]))[0]);
    await copy.finish();
    expect(out.getPage(0).node.lookup(N("Big"), PDFArray).size()).toBe(200_000);
  }, 30_000);

  it("reads a reachable dictionary with a missing /Type target as not a Page", async () => {
    const doc = await PDFDocument.create();
    doc.addPage().node.set(N("Custom"), doc.context.obj({ Type: missing(doc, 100), Kept: 1 }));
    const saved = await PDFDocument.load(await build([createPageState(file(await doc.save()), 1)]));
    expect(saved.getPage(0).node.lookup(N("Custom"), PDFDict).get(N("Kept"))).toEqual(
      PDFNumber.of(1)
    );
  });

  it("reads a missing destination operand as null", async () => {
    const doc = await PDFDocument.create(),
      p1 = doc.addPage(),
      p2 = doc.addPage();
    p1.node.addAnnot(
      doc.context.register(
        doc.context.obj({
          Subtype: "Link",
          Rect: [0, 0, 10, 10],
          Dest: [p2.ref, "XYZ", missing(doc, 100), 0, 0],
        })
      )
    );
    const source = file(await doc.save());
    const saved = await PDFDocument.load(
      await build([createPageState(source, 1), createPageState(source, 2)])
    );
    const dest = saved
      .getPage(0)
      .node.lookup(N("Annots"), PDFArray)
      .lookup(0, PDFDict)
      .lookup(N("Dest"), PDFArray);
    expect(dest.get(0)).toBe(saved.getPage(1).ref);
    expect(dest.get(2)).toBe(PDFNull);
  });

  it("drops /Annots entries that point to a null object", async () => {
    const doc = await PDFDocument.create(),
      page = doc.addPage(),
      empty = doc.context.nextRef();
    doc.context.assign(empty, PDFNull);
    page.node.set(
      N("Annots"),
      doc.context.obj([
        empty,
        PDFNull,
        doc.context.register(doc.context.obj({ Subtype: "Text", Rect: [0, 0, 10, 10] })),
      ])
    );
    const saved = await PDFDocument.load(await build([createPageState(file(await doc.save()), 1)]));
    const annots = saved.getPage(0).node.lookup(N("Annots"), PDFArray);
    expect(annots.size()).toBe(1);
    expect(annots.lookup(0, PDFDict).lookup(N("Subtype"))).toBe(N("Text"));
  });
});

describe("opaque invalid objects", () => {
  const opaque = (doc: PDFDocument) =>
    doc.context.register(PDFInvalidObject.of(new TextEncoder().encode("<< /P 3 0 R")));
  it("ignores an unreachable opaque object in the source", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    opaque(doc);
    const out = await PDFDocument.create(),
      f = file(new Uint8Array()),
      copy = new PDFExportCopy(out, [{ file: f, doc }]);
    out.addPage((await copy.copyPages([{ file: f, pageNumber: 1 }]))[0]);
    await copy.finish();
    expect(out.getPageCount()).toBe(1);
  });

  it("still rejects an opaque object reachable from a copied page", async () => {
    const doc = await PDFDocument.create();
    doc.addPage().node.set(N("Opaque"), opaque(doc));
    const out = await PDFDocument.create(),
      f = file(new Uint8Array());
    await expect(
      (async () =>
        new PDFExportCopy(out, [{ file: f, doc }]).copyPages([{ file: f, pageNumber: 1 }]))()
    ).rejects.toThrow("Opaque invalid PDF object cannot be reconciled");
  });
});

describe("batched export copies", () => {
  const count = (doc: PDFDocument) => doc.context.enumerateIndirectObjects().length;
  const all = (source: File, n: number) =>
    Array.from({ length: n }, (_, index) => createPageState(source, index + 1));

  it("copies a resource shared by every page once", async () => {
    const doc = await PDFDocument.create(),
      shared = doc.context.register(
        doc.context.flateStream(
          Uint8Array.from({ length: 50_000 }, (_, i) => (i * 2654435761) >>> 24)
        )
      );
    for (let i = 0; i < 50; i++) {
      const page = doc.addPage();
      page.node.setXObject(N("Shared"), shared);
      page.drawText(`page ${i}`);
    }
    const bytes = await doc.save(),
      out = await build(all(file(bytes), 50));
    expect(out.length).toBeLessThan(bytes.length * 1.2);
    const saved = await PDFDocument.load(out);
    expect(count(saved)).toBeLessThanOrEqual(count(await PDFDocument.load(bytes)) + 5);
  });

  it("keeps table-of-contents links from copying linked pages again", async () => {
    const doc = await PDFDocument.create(),
      pages = Array.from({ length: 60 }, (_, i) => {
        const page = doc.addPage();
        page.drawText(`content ${i}`);
        return page;
      });
    for (const [i, page] of pages.entries())
      for (const target of i === 0 ? pages : [pages[0]])
        page.node.addAnnot(
          doc.context.register(
            doc.context.obj({ Subtype: "Link", Rect: [0, 0, 10, 10], Dest: [target.ref, "Fit"] })
          )
        );
    const source = await PDFDocument.load(await doc.save()),
      out = await PDFDocument.create(),
      f = file(new Uint8Array()),
      copy = new PDFExportCopy(out, [{ file: f, doc: source }]);
    for (const page of await copy.copyPages(
      pages.map((_, index) => ({ file: f, pageNumber: index + 1 }))
    ))
      out.addPage(page);
    // Copying page by page allocated every linked page again for each page.
    expect(out.context.largestObjectNumber).toBeLessThan(count(source) * 2);
    await copy.finish();
    expect(count(out)).toBeLessThanOrEqual(count(source) + 5);
    const toc = out.getPage(0).node.lookup(N("Annots"), PDFArray);
    for (let i = 0; i < 60; i++)
      expect(toc.lookup(i, PDFDict).lookup(N("Dest"), PDFArray).get(0)).toBe(out.getPage(i).ref);
  });

  it("copies one linked text field across pages once", async () => {
    const doc = await PDFDocument.create(),
      field = doc.getForm().createTextField("name");
    for (let i = 0; i < 50; i++)
      field.addToPage(doc.addPage(), { x: 10, y: 10, width: 100, height: 20 });
    const bytes = await doc.save(),
      saved = await PDFDocument.load(await build(all(file(bytes), 50)));
    expect(count(saved)).toBeLessThanOrEqual(count(await PDFDocument.load(bytes)) + 5);
    const parents = new Set(
      saved
        .getPages()
        .map((page) =>
          page.node.lookup(N("Annots"), PDFArray).lookup(0, PDFDict).lookup(N("Parent"), PDFDict)
        )
    );
    expect(parents.size).toBe(1);
    expect([...parents][0].lookup(N("Kids"), PDFArray).size()).toBe(50);
  });

  it("gives a duplicated page its own widgets without recopying other pages", async () => {
    const doc = await PDFDocument.create(),
      field = doc.getForm().createTextField("name");
    for (let i = 0; i < 20; i++) {
      const page = doc.addPage();
      page.drawText(`content ${i}`);
      field.addToPage(page, { x: 10, y: 10, width: 100, height: 20 });
    }
    const bytes = await doc.save(),
      source = file(bytes),
      layout = [...all(source, 20), createPageState(source, 1)];
    const saved = await PDFDocument.load(await build(layout));
    // The duplicate's field tree is copied once more; its omitted siblings are pruned.
    expect(count(saved)).toBeLessThanOrEqual(count(await PDFDocument.load(bytes)) + 10);
    const widget = (index: number) =>
      saved.getPage(index).node.lookup(N("Annots"), PDFArray).lookup(0, PDFDict);
    expect(widget(20)).not.toBe(widget(0));
    expect(widget(20).get(N("P"))).toBe(saved.getPage(20).ref);
    expect(widget(0).get(N("P"))).toBe(saved.getPage(0).ref);
    expect(widget(20).lookup(N("Parent"), PDFDict)).not.toBe(
      widget(0).lookup(N("Parent"), PDFDict)
    );
    expect(widget(20).lookup(N("Parent"), PDFDict).lookup(N("Kids"), PDFArray).size()).toBe(1);
  });

  it("copies pages that share an annotation independently", async () => {
    const doc = await PDFDocument.create(),
      note = doc.context.register(doc.context.obj({ Subtype: "Text", Rect: [0, 0, 10, 10] }));
    for (let i = 0; i < 2; i++) doc.addPage().node.set(N("Annots"), doc.context.obj([note]));
    const saved = await PDFDocument.load(await build(all(file(await doc.save()), 2)));
    const annot = (index: number) =>
      saved.getPage(index).node.lookup(N("Annots"), PDFArray).lookup(0, PDFDict);
    expect(annot(0)).not.toBe(annot(1));
    expect(annot(0).get(N("P"))).toBe(saved.getPage(0).ref);
    expect(annot(1).get(N("P"))).toBe(saved.getPage(1).ref);
  });

  it("keeps drawing on an editable page out of shared contents and resources", async () => {
    const doc = await PDFDocument.create();
    const resources = doc.context.register(doc.context.obj({ Font: {} }));
    const contents = doc.context.register(
      doc.context.obj([doc.context.register(doc.context.flateStream("0 0 m"))])
    );
    for (let i = 0; i < 2; i++) {
      const page = doc.addPage();
      page.node.set(N("Resources"), resources);
      page.node.set(N("Contents"), contents);
    }
    const out = await PDFDocument.create(),
      f = file(new Uint8Array()),
      copy = new PDFExportCopy(out, [{ file: f, doc }]);
    const [edited, plain] = await copy.copyPages([
      { file: f, pageNumber: 1, editable: true },
      { file: f, pageNumber: 2 },
    ]);
    for (const page of [edited, plain]) out.addPage(page);
    edited.drawText("added");
    await copy.finish();
    expect(plain.node.Resources()?.lookup(N("Font"), PDFDict).keys()).toHaveLength(0);
    expect(plain.node.Contents()).toBeInstanceOf(PDFArray);
    expect((plain.node.Contents() as PDFArray).size()).toBe(1);
    expect(edited.node.Resources()?.lookup(N("Font"), PDFDict).keys()).toHaveLength(1);
  });
});
