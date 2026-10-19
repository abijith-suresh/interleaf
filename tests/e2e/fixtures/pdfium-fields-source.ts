import { PDFDocument, rgb } from "pdf-lib";

export interface FieldPage {
  readonly source: number;
  readonly page: number;
}
export const fieldScenarios: { readonly name: string; readonly pages: readonly FieldPage[] }[] = [
  {
    name: "full",
    pages: [
      { source: 0, page: 1 },
      { source: 0, page: 2 },
    ],
  },
  { name: "extract-second", pages: [{ source: 0, page: 2 }] },
  {
    name: "reorder",
    pages: [
      { source: 0, page: 2 },
      { source: 0, page: 1 },
    ],
  },
  {
    name: "merge-two",
    pages: [
      { source: 0, page: 1 },
      { source: 0, page: 2 },
      { source: 1, page: 1 },
      { source: 1, page: 2 },
    ],
  },
  // Diagnostic only: the current editor does not promise page duplication.
  {
    name: "repeat-import",
    pages: [
      { source: 0, page: 1 },
      { source: 0, page: 1 },
    ],
  },
];

// Generated through the independent oracle, not copied from the prototype.
// Both fields have two sibling widgets with inherited /FT, /T and /V and real /AP.
export async function sharedFieldSource(label: "First" | "Second") {
  const pdf = await PDFDocument.create();
  const pages = [pdf.addPage([300, 400]), pdf.addPage([300, 400])];
  const form = pdf.getForm();
  const text = form.createTextField("Shared");
  text.setText(label);
  const radio = form.createRadioGroup("Choice");
  for (const [index, page] of pages.entries()) {
    page.drawRectangle({
      x: 255,
      y: 30 + index * 30,
      width: 20,
      height: 20,
      color: rgb(0.1, 0.3, 0.7),
    });
    text.addToPage(page, { x: 20, y: 200, width: 200, height: 25 });
    radio.addOptionToPage(index === 0 ? "A" : "B", page, { x: 20, y: 150, width: 20, height: 20 });
  }
  radio.select(label === "First" ? "A" : "B");
  return new Uint8Array(await pdf.save());
}
