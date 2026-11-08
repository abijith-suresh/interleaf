import type { Page } from "@playwright/test";
import { degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { inspectPDF } from "./duplication";
export async function inspect(reader: Page, bytes: number[]) {
  return reader.evaluate(async (bytes): Promise<Awaited<ReturnType<typeof inspectPDF>>> => {
    const path = "/tests/e2e/fixtures/duplication.ts";
    return (await import(path)).inspectPDF(bytes);
  }, bytes);
}
export async function source(form = false) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const [index, width] of [200, 240].entries()) {
    const page = pdf.addPage([width, 300]);
    page.drawText(`Source ${index + 1}`, { x: 20, y: 240, font, size: 20 });
    page.drawRectangle({
      x: 20,
      y: 30,
      width: 70,
      height: 80,
      color: rgb(index ? 0 : 1, 0, index ? 1 : 0),
    });
    if (!index) {
      page.setRotation(degrees(90));
      if (form) {
        const field = pdf.getForm().createTextField("name");
        field.setText("Current form baseline");
        field.addToPage(page, { x: 15, y: 150, width: 170, height: 30, font });
      }
    }
  }
  return { name: "source.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) };
}
