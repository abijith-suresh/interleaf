import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";

const broken = {
  name: "broken.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("not a PDF at all"),
};

async function source(name: string, pageCount: number) {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pageCount; index++) pdf.addPage([400, 600]);
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) };
}

async function locked() {
  const buffer = Buffer.from(
    await readFile("tools/qpdf-wasm/fixtures/encrypted-40-bit-r3.b64", "utf8"),
    "base64"
  );
  const pageCount = (await PDFDocument.load(buffer, { ignoreEncryption: true })).getPageCount();
  return { file: { name: "protected.pdf", mimeType: "application/pdf", buffer }, pageCount };
}

// Uncompressed, repetitive content that lossless optimization can shrink.
async function compressible(name: string) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < 4; index++) {
    const page = pdf.addPage([400, 600]);
    for (let line = 0; line < 40; line++)
      page.drawText(`Line ${line} repeats the same words`, { x: 20, y: 580 - line * 14, font });
  }
  const buffer = Buffer.from(await pdf.save({ useObjectStreams: false }));
  return { name, mimeType: "application/pdf", buffer };
}

async function compress(page: Page) {
  const pending = page.waitForEvent("download");
  await page.getByTestId("editor-download-menu-button").click();
  await page.getByTestId("editor-compress-button").click();
  const download = await pending;
  const path = test.info().outputPath(download.suggestedFilename());
  await download.saveAs(path);
  return { name: download.suggestedFilename(), buffer: await readFile(path) };
}

test("opening a batch unlocks the protected file, skips the broken one, and opens the rest", async ({
  page,
}) => {
  const protectedSource = await locked();
  await page.goto("/app");
  await page
    .getByTestId("editor-upload-input")
    .setInputFiles([protectedSource.file, broken, await source("report-6p.pdf", 2)]);

  await page.getByLabel("PDF password", { exact: true }).fill("623");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();

  const message = "Opened 2 of 3 files. broken.pdf isn't a valid PDF.";
  await expect(page.getByTestId("editor-page-tile")).toHaveCount(protectedSource.pageCount + 2);
  await expect(page.getByTestId("editor-toast").last()).toHaveText(message);
  await expect(page.getByTestId("editor-status-message")).toHaveText(message);

  await page.getByTestId("editor-download-menu-button").click();
  await expect(page.getByTestId("editor-compress-button")).toHaveAccessibleName(
    "Compress works on one untouched PDF"
  );
  await page.keyboard.press("Escape");

  const pending = page.waitForEvent("download");
  await page.getByTestId("editor-download-menu-button").click();
  await page.getByTestId("editor-download-button").click();
  expect((await pending).suggestedFilename()).toBe("protected-edited.pdf");
});

test("adding files to a workspace skips the broken one and adds the rest", async ({ page }) => {
  await page.goto("/app");
  await page.getByTestId("editor-upload-input").setInputFiles(await source("report-6p.pdf", 2));
  await expect(page.getByTestId("editor-page-tile")).toHaveCount(2);

  await page
    .getByTestId("editor-add-pdf-input")
    .setInputFiles([broken, await source("appendix.pdf", 3)]);

  const message = "Added 1 of 2 files. broken.pdf isn't a valid PDF.";
  await expect(page.getByTestId("editor-page-tile")).toHaveCount(5);
  await expect(page.getByTestId("editor-toast").last()).toHaveText(message);
  await expect(page.getByTestId("editor-status-message")).toHaveText(message);

  const pending = page.waitForEvent("download");
  await page.getByTestId("editor-download-menu-button").click();
  await page.getByTestId("editor-download-button").click();
  expect((await pending).suggestedFilename()).toBe("report-6p-edited.pdf");
});

test("a batch where every file fails stays on the uploader with the error", async ({ page }) => {
  await page.goto("/app");
  await page
    .getByTestId("editor-upload-input")
    .setInputFiles([broken, { ...broken, name: "also-broken.pdf" }]);

  await expect(page.getByTestId("editor-toast").last()).toHaveText(
    "Could not open 2 files. broken.pdf isn't a valid PDF. also-broken.pdf isn't a valid PDF."
  );
  await expect(page.getByTestId("editor-upload-input")).toBeAttached();
  await expect(page.getByTestId("editor-page-tile")).toHaveCount(0);
});

test("compression reports the saving, and an already optimal file keeps its name", async ({
  page,
}) => {
  await page.goto("/app");
  await page.getByTestId("editor-upload-input").setInputFiles(await compressible("letter.pdf"));
  await expect(page.getByTestId("editor-page-tile")).toHaveCount(4);

  const compressed = await compress(page);
  expect(compressed.name).toBe("letter-compressed.pdf");
  await expect(page.getByTestId("editor-toast").last()).toHaveText(
    /^Saved \d+% \(\d+ KB → \d+ KB\)\.$/
  );
  await expect(page.getByTestId("editor-status-message")).toHaveText(/^Export started\. Saved /);

  await page.goto("/app");
  await page.getByTestId("editor-upload-input").setInputFiles({
    name: "letter-compressed.pdf",
    mimeType: "application/pdf",
    buffer: compressed.buffer,
  });
  await expect(page.getByTestId("editor-page-tile")).toHaveCount(4);

  const again = await compress(page);
  expect(again.name).toBe("letter-compressed.pdf");
  expect(again.buffer.equals(compressed.buffer)).toBe(true);
  await expect(page.getByTestId("editor-toast").last()).toHaveText(
    "Already optimal. Exported the original."
  );
  await expect(page.getByTestId("editor-status-message")).toHaveText(
    "Export started. Already optimal. Exported the original."
  );
});

test("Extract names the PDF after its first exported source", async ({ page }) => {
  await page.goto("/app");
  await page
    .getByTestId("editor-upload-input")
    .setInputFiles([await source("report.pdf", 1), await source("appendix.pdf", 1)]);
  await page.getByTestId("editor-page-tile").nth(1).click();
  const pending = page.waitForEvent("download");
  await page.getByTestId("editor-extract-button").click();
  expect((await pending).suggestedFilename()).toBe("appendix-edited.pdf");
});
