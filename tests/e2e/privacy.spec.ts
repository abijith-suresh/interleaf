import { readFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";
import { unzipSync } from "fflate";
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream } from "pdf-lib";
import { createJpegFile, createPngFile } from "../../src/services/__tests__/pdf-fixtures";
import { test } from "./fixtures/privacy";

async function source() {
  const pdf = await PDFDocument.create();
  for (const width of [400, 420]) {
    const sheet = pdf.addPage([width, 600]);
    sheet.drawText("Private source", { x: 30, y: 500, size: 18 });
  }
  // An uncompressed fixture makes the real qpdf reduction observable.
  return {
    name: "private.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await pdf.save({ useObjectStreams: false })),
  };
}

async function image(file: File) {
  return { name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) };
}

async function saveDownload(page: Page, id: string, filename: string) {
  const pending = page.waitForEvent("download");
  await page.getByTestId(id).click();
  const download = await pending;
  expect(download.url()).toMatch(/^(blob:|data:)/);
  const path = test.info().outputPath(filename);
  await download.saveAs(path);
  expect(await download.failure()).toBeNull();
  return readFile(path);
}

async function ready(page: Page) {
  await expect(page.locator(".editor-review-stage")).toHaveAttribute("data-render-state", "ready");
}

async function exportPNG(page: Page, filename: string) {
  await page.getByTestId("editor-download-options-button").click();
  const zip = await saveDownload(page, "editor-export-images-button", filename);
  const entries = Object.entries(unzipSync(zip));
  expect(entries).toHaveLength(1);
  const [name, png] = entries[0];
  expect(name).toMatch(/^page-\d+\.png$/);
  expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  // Decode the saved PNG, rather than accepting a download event or a ZIP header alone.
  return page.evaluate(async (bytes) => {
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Missing PNG context");
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i] < 240 || pixels[i + 1] < 240 || pixels[i + 2] < 240) ink++;
      return { width: canvas.width, height: canvas.height, ink };
    } finally {
      URL.revokeObjectURL(url);
    }
  }, Array.from(png));
}

test("mixed files, organization, saved text/checkmarks and PDF/PNG downloads stay in the browser", async ({
  page,
  privacy,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.goto("/app");
  await page
    .getByTestId("editor-upload-input")
    .setInputFiles([await source(), await image(createPngFile())]);
  const tiles = page.getByTestId("editor-page-tile");
  await expect(tiles).toHaveCount(3);
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("editor-add-pdf-button").click();
  await (await chooser).setFiles(await image(createJpegFile()));
  await expect(tiles).toHaveCount(4);
  await page.getByRole("button", { name: "Duplicate page 1", exact: true }).click();
  await expect(tiles).toHaveCount(5);
  await expect(tiles.nth(1)).toBeFocused();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(tiles.nth(2)).toBeFocused();
  await page.getByRole("button", { name: "Rotate page 3 90 degrees", exact: true }).click();
  await page.getByRole("button", { name: "Mark page 2 for deletion", exact: true }).click();
  await page.getByTestId("editor-undo-button").click();
  await page.getByTestId("editor-redo-button").click();
  await expect(tiles.nth(1)).toHaveAttribute("data-marked-for-deletion", "true");
  await page.getByTestId("editor-document-view-button").click();
  await ready(page);
  await page.getByRole("button", { name: "Add text", exact: true }).click();
  await expect(page.locator(".editor-text-layer")).toHaveAttribute("data-geometry-ready", "true");
  await page.locator(".editor-review-stage").press("Enter");
  await page.getByLabel("Added text", { exact: true }).fill("Private draft");
  await page.getByRole("button", { name: "Save text", exact: true }).click();
  await ready(page);
  await page.getByRole("button", { name: "Checkmark", exact: true }).click();
  await page.locator(".editor-review-stage").press("Enter");
  await page.getByRole("button", { name: "Save checkmark", exact: true }).click();
  await ready(page);
  await expect(page.getByRole("button", { name: "Edit added text: Private draft" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit added checkmark", exact: true })
  ).toBeVisible();

  const pdf = await PDFDocument.load(
    await saveDownload(page, "editor-download-button", "edited.pdf")
  );
  expect(pdf.getPageCount()).toBe(1);
  expect(pdf.getPage(0).getSize()).toEqual({ width: 400, height: 600 });
  expect(pdf.getPage(0).getRotation().angle).toBe(90);
  const contents = pdf.getPage(0).node.Contents();
  if (!(contents instanceof PDFArray)) throw new Error("Missing saved PDF content");
  let operators = "";
  for (let index = 0; index < contents.size(); index++)
    operators += new TextDecoder().decode(
      decodePDFRawStream(contents.lookup(index, PDFRawStream)).decode()
    );
  expect(operators).toContain(Buffer.from("Private draft").toString("hex").toUpperCase());
  expect(operators.match(/\nS\n/g)?.length).toBeGreaterThanOrEqual(2);
  const png = await exportPNG(page, "edited-images.zip");
  expect(png).toMatchObject({ width: 1200, height: 800 });
  expect(png.ink).toBeGreaterThan(100);
  expect(privacy.requests.some((request) => request.url().includes("pdf.worker"))).toBe(true);
});

test("password opening and native PDF/PNG exports stay in the browser", async ({ page }) => {
  await page.goto("/app");
  await page.getByTestId("editor-upload-input").setInputFiles({
    name: "private-protected.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(
      await readFile("tools/qpdf-wasm/fixtures/encrypted-40-bit-r3.b64", "utf8"),
      "base64"
    ),
  });
  const password = page.getByLabel("PDF password", { exact: true });
  await password.fill("wrong");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(page.getByText("Incorrect password. Try again.")).toBeVisible();
  await password.fill("623");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(page.locator(".password-modal")).toHaveCount(0);
  await page.getByTestId("editor-document-view-button").click();
  await ready(page);
  const pdf = await PDFDocument.load(
    await saveDownload(page, "editor-download-button", "unlocked.pdf")
  );
  expect(pdf.isEncrypted).toBe(false);
  expect(pdf.getPageCount()).toBe(1);
  expect((await exportPNG(page, "unlocked-images.zip")).ink).toBeGreaterThan(100);
});

test("untouched PDF compression uses the local qpdf worker and saves a readable PDF", async ({
  page,
  privacy,
}) => {
  const input = await source();
  await page.goto("/app");
  await page.getByTestId("editor-upload-input").setInputFiles(input);
  await expect(page.getByTestId("editor-page-tile")).toHaveCount(2);
  await page.getByTestId("editor-download-options-button").click();
  await expect(page.getByTestId("editor-compress-button")).toHaveAttribute(
    "aria-disabled",
    "false"
  );
  const bytes = await saveDownload(page, "editor-compress-button", "compressed.pdf");
  expect(bytes.byteLength).toBeLessThan(input.buffer.byteLength);
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPages().map((sheet) => sheet.getWidth())).toEqual([400, 420]);
  for (const path of ["/qpdf/qpdf-worker.js", "/qpdf/qpdf.mjs", "/qpdf/qpdf.wasm"])
    expect(privacy.requests.some((request) => new URL(request.url()).pathname === path)).toBe(true);
});
