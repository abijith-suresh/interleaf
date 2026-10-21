import { degrees, PDFDocument, PDFHexString, PDFName, PDFNull, PDFNumber } from "pdf-lib";

export async function textFieldFixture(
  options: {
    value?: string;
    unit?: number;
    rotation?: number;
    narrow?: number;
    maxLength?: number;
    nullAttributes?: boolean;
  } = {}
) {
  const doc = await PDFDocument.create();
  const pages = [doc.addPage([340, 460]), doc.addPage([340, 460])];
  for (const page of pages) {
    page.setMediaBox(-30, -40, 340, 460);
    page.setCropBox(-20, -25, 310, 410);
    page.setRotation(degrees(options.rotation ?? 0));
    page.node.set(PDFName.of("UserUnit"), PDFNumber.of(options.unit ?? 1));
    page.drawText("Keep original page content", { x: 10, y: 380, size: 10 });
  }
  const form = doc.getForm();
  const field = form.createTextField("person.answer");
  field.setText(options.value ?? "INHERITED");
  field.addToPage(pages[0], { x: 10, y: 310, width: 240, height: 26 });
  field.addToPage(pages[0], { x: 10, y: 260, width: 190, height: 26 });
  field.addToPage(pages[1], { x: 10, y: 310, width: options.narrow ?? 110, height: 26 });
  const other = form.createTextField("person.other");
  other.setText("OMITTED_FIELD_ANSWER");
  other.addToPage(pages[1], { x: 10, y: 220, width: 240, height: 26 });
  const readonly = form.createTextField("locked");
  readonly.setText("Read only");
  readonly.enableReadOnly();
  readonly.addToPage(pages[0], { x: 10, y: 180, width: 200, height: 26 });
  const checkbox = form.createCheckBox("accepted");
  checkbox.addToPage(pages[0], { x: 10, y: 120, width: 20, height: 20 });
  checkbox.check();
  form.updateFieldAppearances();
  const parent = field.acroField.getParent()!;
  for (const key of ["FT", "DA", "V"]) {
    const n = PDFName.of(key);
    parent.dict.set(n, field.acroField.dict.get(n)!);
    if (options.nullAttributes === false) field.acroField.dict.delete(n);
    else field.acroField.dict.set(n, PDFNull);
  }
  parent.dict.set(PDFName.of("MaxLen"), PDFNumber.of(options.maxLength ?? 20));
  field.acroField.dict.set(PDFName.of("MaxLen"), PDFNull);
  // A terminal empty V must shadow this inherited value, without removing it.
  parent.dict.set(PDFName.of("V"), PDFHexString.fromText(options.value ?? "INHERITED"));
  return {
    bytes: await doc.save({ updateFieldAppearances: false }),
    fieldRef: field.ref.toString(),
    widgetRefs: field.acroField
      .Kids()!
      .asArray()
      .map((ref) => ref.toString()),
    otherRef: other.ref.toString(),
  };
}
