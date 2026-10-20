import {
  degrees,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  type PDFObject,
  PDFString,
  StandardFonts,
} from "pdf-lib";

export const OMITTED_ANSWER = "OMITTED_PAGE_2_ANSWER_7341e1f_71b8fa";
export const OMITTED_CONTENT = "OMITTED_PAGE_2_CONTENT_7341e1f_f892c7";

export async function exportFormFixture(sharedAnswer = "Alice") {
  const doc = await PDFDocument.create();
  const pages = [doc.addPage([400, 500]), doc.addPage([400, 500])];
  pages.forEach((page, index) => {
    page.drawText(index ? OMITTED_CONTENT : "Retained page one", { x: 20, y: 470, size: 10 });
    page.setCropBox(10, 10, 380, 480);
    page.node.set(PDFName.of("UserUnit"), PDFNumber.of(1.5));
    page.setRotation(degrees(index ? 90 : 0));
  });
  const form = doc.getForm();
  const shared = form.createTextField("person.name");
  shared.setText(sharedAnswer);
  for (const [index, y] of [
    [0, 400],
    [0, 350],
    [1, 400],
  ])
    shared.addToPage(pages[index], { x: 20, y, width: 200, height: 24 });
  const omitted = form.createTextField("person.private.answer");
  omitted.setText(OMITTED_ANSWER);
  omitted.addToPage(pages[1], { x: 20, y: 350, width: 300, height: 24 });
  const readonly = form.createTextField("locked");
  readonly.setText("Read only");
  readonly.enableReadOnly();
  readonly.addToPage(pages[0], { x: 20, y: 300, width: 200, height: 24 });
  const check = form.createCheckBox("accepted");
  check.addToPage(pages[0], { x: 20, y: 250, width: 20, height: 20 });
  check.check();
  const radio = form.createRadioGroup("choice");
  radio.addOptionToPage("Yes", pages[1], { x: 20, y: 250, width: 20, height: 20 });
  radio.addOptionToPage("No", pages[1], { x: 60, y: 250, width: 20, height: 20 });
  radio.select("Yes");
  const dropdown = form.createDropdown("country");
  dropdown.addOptions(["UK", "US"]);
  dropdown.select("UK");
  dropdown.addToPage(pages[1], { x: 20, y: 200, width: 160, height: 24 });
  // Unsigned only. This fixture makes no cryptographic signature preservation claim.
  const sig = doc.context.register(doc.context.obj({ FT: "Sig", T: PDFString.of("signature") }));
  const widget = doc.context.register(
    doc.context.obj({
      Type: "Annot",
      Subtype: "Widget",
      Rect: [20, 150, 200, 174],
      Parent: sig,
      P: pages[1].ref,
      F: 4,
    })
  );
  doc.context.lookup(sig, PDFDict).set(PDFName.of("Kids"), doc.context.obj([widget]));
  form.acroForm.addField(sig);
  pages[1].node.addAnnot(widget);
  form.updateFieldAppearances(await doc.embedFont(StandardFonts.Helvetica));
  // Exercise type/default appearance inheritance through multiple field ancestors.
  const parent = omitted.acroField.getParent();
  if (!parent) throw Error("Fixture field has no parent");
  for (const key of ["FT", "DA"]) {
    const name = PDFName.of(key);
    const value = omitted.acroField.dict.get(name);
    if (value) {
      parent.dict.set(name, value);
      omitted.acroField.dict.delete(name);
    }
  }
  return doc.save({ updateFieldAppearances: false });
}

export type DestinationKind = "direct" | "goto" | "legacy" | "names";
export async function exportLinkFixture(kind: DestinationKind) {
  const doc = await PDFDocument.create();
  const p1 = doc.addPage([400, 500]),
    p2 = doc.addPage([400, 500]);
  p1.drawText("Retained page one");
  p2.drawText(OMITTED_CONTENT);
  const destination = doc.context.obj([p2.ref, "Fit"]);
  let target: PDFObject = destination;
  if (kind === "legacy") {
    doc.catalog.set(PDFName.of("Dests"), doc.context.obj({ target: destination }));
    target = PDFName.of("target");
  } else if (kind === "names") {
    doc.catalog.set(
      PDFName.of("Names"),
      doc.context.obj({
        Dests: {
          Kids: [
            doc.context.register(
              doc.context.obj({ Names: [PDFString.of("target"), { D: destination }] })
            ),
          ],
        },
      })
    );
    target = PDFString.of("target");
  }
  p1.node.addAnnot(
    doc.context.register(
      doc.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [20, 20, 100, 40],
        Contents: PDFString.of("Go to page two"),
        ...(kind === "goto" ? { A: { S: "GoTo", D: target } } : { Dest: target }),
      })
    )
  );
  p1.node.addAnnot(
    doc.context.register(
      doc.context.obj({
        Subtype: "Link",
        Rect: [20, 50, 100, 70],
        A: { S: "URI", URI: PDFString.of("https://example.com/") },
      })
    )
  );
  p1.node.addAnnot(
    doc.context.register(
      doc.context.obj({
        Subtype: "Link",
        Rect: [20, 80, 100, 100],
        A: { S: "GoToR", F: PDFString.of("other.pdf"), D: [0, "Fit"] },
      })
    )
  );
  return doc.save();
}

export async function exportCrossPageButtonFixture() {
  const doc = await PDFDocument.create();
  const pages = [doc.addPage([400, 500]), doc.addPage([400, 500])];
  const radio = doc.getForm().createRadioGroup("cross-page");
  radio.addOptionToPage("First", pages[0], { x: 20, y: 20, width: 20, height: 20 });
  radio.addOptionToPage("Second", pages[1], { x: 20, y: 20, width: 20, height: 20 });
  radio.select("Second");
  return doc.save();
}

export const INDIRECT_OMITTED_ANSWER = "INDEPENDENT_OMITTED_ANSWER_83ec532";
export const INDIRECT_OMITTED_CONTENT = "INDEPENDENT_OMITTED_PAGE_7cd6532";
export async function exportIndirectWidgetFixture(indirect: boolean) {
  const doc = await PDFDocument.create(),
    p1 = doc.addPage(),
    p2 = doc.addPage();
  p1.drawText("Retained page");
  p2.drawText("Omitted page");
  const keep = doc.getForm().createTextField("group.keep"),
    omit = doc.getForm().createTextField("group.omit");
  keep.setText("Retained answer");
  keep.addToPage(p1, { x: 10, y: 20, width: 150, height: 30 });
  omit.setText(INDIRECT_OMITTED_ANSWER);
  omit.addToPage(p2, { x: 10, y: 20, width: 300, height: 30 });
  doc.getForm().updateFieldAppearances();
  for (const p of [p1, p2])
    for (const raw of p.node.Annots()?.asArray() ?? []) {
      const widget = doc.context.lookup(raw, PDFDict);
      widget.delete(PDFName.of("P"));
      if (indirect) widget.set(PDFName.of("Subtype"), doc.context.register(PDFName.of("Widget")));
    }
  return doc.save({ updateFieldAppearances: false });
}
export async function exportIndirectPageFixture(indirect: boolean, orphan = false) {
  const doc = await PDFDocument.create(),
    p1 = doc.addPage(),
    p2 = doc.addPage();
  p1.drawText("Retained page");
  p2.drawText(INDIRECT_OMITTED_CONTENT);
  p1.node.set(PDFName.of("CustomPage"), p2.ref);
  if (orphan) doc.removePage(1);
  if (indirect) p2.node.set(PDFName.of("Type"), doc.context.register(PDFName.of("Page")));
  return doc.save();
}

export const INDEX_PAGE_TEXT = ["ONE", "REQUESTED_PAGE_TWO_37e2", "OMITTED_PAGE_THREE_912ab"];
export async function exportPageIndexFixture(indirect: boolean) {
  const doc = await PDFDocument.create();
  for (const [index, text] of INDEX_PAGE_TEXT.entries())
    doc.addPage([400 + index * 10, 500]).drawText(text);
  if (indirect)
    doc.getPage(1).node.set(PDFName.of("Type"), doc.context.register(PDFName.of("Page")));
  return doc.save();
}

export const COUNT_PAGE_TEXT = [
  "ONE",
  "HIDDEN_NATIVE_PAGE_TWO_51ad",
  "VISIBLE_REQUESTED_PAGE_THREE_51ad",
  "LAST_PAGE_FOUR_51ad",
];
export async function exportPageCountFixture(indirect: boolean, correct: boolean) {
  const doc = await PDFDocument.create(),
    N = PDFName.of;
  const pages = COUNT_PAGE_TEXT.map((text, index) => {
    const page = doc.addPage([400 + index * 10, 500]);
    page.drawText(text, { size: 10, x: 10, y: 30 });
    return page;
  });
  const root = doc.catalog.lookup(N("Pages"), PDFDict),
    rootRef = doc.catalog.get(N("Pages"));
  const number = (value: number) =>
    indirect ? doc.context.register(PDFNumber.of(value)) : PDFNumber.of(value);
  const branch = (indices: number[], count: number) => {
    const node = doc.context.obj({
      Type: "Pages",
      Parent: rootRef,
      Count: number(count),
      Kids: indices.map((i) => pages[i].ref),
    });
    const ref = doc.context.register(node);
    for (const index of indices) pages[index].node.set(N("Parent"), ref);
    return ref;
  };
  root.set(
    N("Kids"),
    doc.context.obj([branch([0, 1], correct ? 2 : 1), branch([2], correct ? 1 : 2), pages[3].ref])
  );
  root.set(N("Count"), number(4));
  return doc.save({ updateFieldAppearances: false });
}
export async function exportResourceNameFixture(key: string, checkbox: boolean) {
  const doc = await PDFDocument.create(),
    N = PDFName.of;
  const page = doc.addPage([320, 180]);
  if (checkbox) {
    page.drawText("Retained checked box", { x: 20, y: 120, size: 12 });
    const field = doc.getForm().createCheckBox("accepted");
    field.addToPage(page, { x: 20, y: 50, width: 24, height: 24 });
    field.check();
    doc.getForm().updateFieldAppearances();
    const widget = page.node.lookup(N("Annots"), PDFArray).lookup(0, PDFDict),
      ap = widget.lookup(N("AP"), PDFDict);
    for (const kind of ["N", "D"]) {
      const states = ap.lookupMaybe(N(kind), PDFDict);
      if (states?.has(N("Yes"))) {
        states.set(N(key), states.get(N("Yes"))!);
        states.delete(N("Yes"));
      }
    }
    widget.set(N("AS"), N(key));
    widget.lookup(N("Parent"), PDFDict).set(N("V"), N(key));
  } else {
    const font = await doc.embedFont(StandardFonts.Helvetica),
      fonts = doc.context.obj({});
    fonts.set(N(key), font.ref);
    page.node.set(N("Resources"), doc.context.obj({ Font: fonts }));
    page.node.set(
      N("Contents"),
      doc.context.register(
        doc.context.flateStream(`BT /${key} 18 Tf 20 100 Td (Valid font resource ${key}) Tj ET`)
      )
    );
  }
  return doc.save({ updateFieldAppearances: false });
}
