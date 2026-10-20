import { Effect } from "effect";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
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
  exportPageIndexFixture,
  INDEX_PAGE_TEXT,
  OMITTED_ANSWER,
  OMITTED_CONTENT,
} from "./pdf-export-fixtures";
import { inspectExport, retainedMetadata } from "./pdf-export-inspection";
import { createPageState } from "./pdf-fixtures";

const N = PDFName.of;
function file(bytes: Uint8Array, name = "same.pdf") {
  return new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
}
async function build(pages: PageState[], selectedIndices?: number[]) {
  const service = new PDFOperationsService({ renderPage: () => Effect.void });
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
      if (options?.ignoreEncryption)
        cache.push({
          doc,
          objects: doc.context.enumerateIndirectObjects().map(([, o]) => o.toString()),
        });
      return doc;
    });
    const service = new PDFOperationsService({ renderPage: () => Effect.void });
    try {
      await Effect.runPromise(service.buildPDF([createPageState(source, 1)]));
      await Effect.runPromise(service.buildPDF([createPageState(source, 2)]));
      expect(cache).toHaveLength(1);
      expect(cache[0].doc.context.enumerateIndirectObjects().map(([, o]) => o.toString())).toEqual(
        cache[0].objects
      );
      expect(new Uint8Array(await source.arrayBuffer())).toEqual(bytes);
    } finally {
      spy.mockRestore();
      await Effect.runPromise(service.dispose());
    }
  });
  it.each([[2], [1, 2], [2, 1], [1, 2, 1, 2]])(
    "rejects positional button Opt pruning for layout %j",
    async (...layout) => {
      const source = file(await exportCrossPageButtonFixture());
      await expect(build(layout.map((n) => createPageState(source, n)))).rejects.toMatchObject({
        operation: "reconcile-export",
        file: source,
        message: "This PDF has linked choice fields that cannot be preserved in this export.",
      });
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
    out.addPage(await helper.copy(f, 1));
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
      const loadSpy = vi
        .spyOn(PDFDocument, "load")
        .mockImplementation((data, options) =>
          data instanceof ArrayBuffer &&
          data.byteLength === bytes.byteLength &&
          options?.ignoreEncryption
            ? Promise.resolve(cached)
            : load(data, options)
        );
      const copy = vi.spyOn(PDFDocument.prototype, "copyPages");
      const service = new PDFOperationsService({ renderPage: () => Effect.void });
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
  it("rejects inconsistent encrypted preparation before rendering or indexed geometry", async () => {
    const bytes = await exportPageIndexFixture(true),
      source = file(bytes),
      cached = await PDFDocument.load(bytes);
    Object.defineProperty(cached, "isEncrypted", { value: true });
    const load = vi.spyOn(PDFDocument, "load").mockResolvedValueOnce(cached);
    const renderPage = vi.fn(() => Effect.void),
      getPageGeometry = vi.fn();
    const getPage = vi.spyOn(cached, "getPage"),
      service = new PDFOperationsService({ renderPage, getPageGeometry });
    try {
      await expect(
        Effect.runPromise(service.buildPDF([createPageState(source, 2, { rotation: 90 })]))
      ).rejects.toMatchObject({ operation: "reconcile-export", file: source });
      expect(getPage).not.toHaveBeenCalled();
      expect(getPageGeometry).not.toHaveBeenCalled();
      expect(renderPage).not.toHaveBeenCalled();
    } finally {
      load.mockRestore();
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
        let branch = doc.context.obj({ Type: "Pages", Kids: [p2.ref] });
        for (let i = 0; i < 33; i++) branch = doc.context.obj({ Type: "Pages", Kids: [branch] });
        kids.set(1, branch);
      }
      const source = file(new Uint8Array());
      expect(() => validatePDFSourcePages(doc, source)).toThrowError(
        "This PDF's page order cannot be safely copied."
      );
    }
  );
});
