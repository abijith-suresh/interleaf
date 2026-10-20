import {
  degrees,
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
