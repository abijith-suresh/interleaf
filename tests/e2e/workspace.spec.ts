import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { createJpegFile, createPngFile } from "../../src/services/__tests__/pdf-fixtures";

async function source(name: string, widths: number[]) {
  const pdf = await PDFDocument.create();
  for (const width of widths) pdf.addPage([width, 600]);
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) };
}

async function downloadPDF(page: Page) {
  const download = page.waitForEvent("download");
  await page.getByTestId("editor-download-button").click();
  const path = await (await download).path();
  if (!path) throw new Error("Missing PDF download");
  return PDFDocument.load(await readFile(path));
}

test("numbered short-landscape filmstrip identifies workspace pages in a noncontiguous selection", async ({
  page,
}) => {
  await page.setViewportSize({ width: 568, height: 320 });
  await page.goto("/app");
  await page
    .getByTestId("editor-upload-input")
    .setInputFiles(await source("subset.pdf", [400, 420, 440]));
  const tiles = page.getByTestId("editor-page-tile");
  await tiles.nth(0).click();
  await tiles.nth(2).click();
  await page.getByTestId("editor-document-view-button").click();

  const filmstrip = page.getByRole("navigation", { name: "Document pages" });
  const labels = filmstrip.getByRole("button").locator(":scope > span:last-child");
  await expect(labels).toHaveText(["1", "3"]);
  await expect(filmstrip.locator(".canvas-container").first()).toBeHidden();
  const thirdPage = filmstrip.getByRole("button", { name: "View page 3", exact: true });
  await expect(thirdPage).toHaveAttribute("title", "Page 3");
  await expect(thirdPage).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("editor-viewer-title")).toHaveText("Page 3");
  await expect(page.locator(".editor-review-position")).toHaveText("2 of 2");

  await filmstrip.getByRole("button", { name: "View page 1", exact: true }).click();
  await expect(page.getByTestId("editor-viewer-title")).toHaveText("Page 1");
  await expect(page.locator(".editor-review-position")).toHaveText("1 of 2");
  await thirdPage.click();
  await expect(page.getByTestId("editor-viewer-title")).toHaveText("Page 3");
  await expect(page.locator(".editor-review-position")).toHaveText("2 of 2");
});

test("Document preserves marked subset inspection, output eligibility and active page across views", async ({
  page,
}) => {
  await page.goto("/app");
  await page
    .getByTestId("editor-upload-input")
    .setInputFiles(await source("pages.pdf", [400, 420, 440]));
  const tiles = page.getByTestId("editor-page-tile");
  await tiles.nth(0).click();
  await tiles.nth(2).click();
  await page.getByRole("button", { name: "Mark page 3 for deletion", exact: true }).click();
  await page.getByTestId("editor-document-view-button").click();
  await expect(page.getByTestId("editor-viewer-title")).toHaveText("Page 3");
  await expect(
    page.getByRole("navigation", { name: "Document pages" }).getByRole("button")
  ).toHaveCount(2);
  await expect(page.locator(".editor-review-position")).toHaveText("2 of 2 · Marked for deletion");
  await expect(page.getByTestId("editor-selection-title")).toHaveText("2 selected · 1 exportable");
  await expect(page.getByTestId("editor-edit-menu-button")).toHaveCount(0);
  const selectedPDF = await downloadPDF(page);
  expect(selectedPDF.getPageCount()).toBe(1);
  expect(selectedPDF.getPage(0).getWidth()).toBe(400);
  await page.getByTestId("editor-pages-view-button").click();
  await expect(tiles.nth(0)).toHaveAttribute("aria-pressed", "true");
  await expect(tiles.nth(2)).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Restore page 3 from deletion", exact: true }).click();
  await page.getByTestId("editor-document-view-button").click();
  await expect(page.getByTestId("editor-viewer-title")).toHaveText("Page 3");
  const restoredPDF = await downloadPDF(page);
  expect(restoredPDF.getPages().map((p) => p.getWidth())).toEqual([400, 440]);
  await page.getByRole("button", { name: "Clear page selection", exact: true }).click();
  await expect(page.getByTestId("editor-download-options-button")).toBeFocused();
  await expect(page.getByTestId("editor-viewer-title")).toHaveText("Page 3");
  await expect(page.getByTestId("editor-selection-title")).toHaveText("All 3 exportable");
  const allPDF = await downloadPDF(page);
  expect(allPDF.getPages().map((p) => p.getWidth())).toEqual([400, 420, 440]);
});

test("source removal while reading remaps selection and replaces only the removed active page", async ({
  page,
}) => {
  await page.goto("/app");
  await page
    .getByTestId("editor-upload-input")
    .setInputFiles([await source("first.pdf", [400, 420]), await source("second.pdf", [500, 520])]);
  const tiles = page.getByTestId("editor-page-tile");
  await tiles.nth(2).click();
  await tiles.nth(0).click();
  await page.getByTestId("editor-document-view-button").click();
  await expect(page.getByTestId("editor-viewer-title")).toHaveText("Page 1");
  await page.getByTestId("editor-files-button").click();
  await page.getByRole("button", { name: /^Remove first.pdf/ }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("editor-files-button")).toBeFocused();
  await expect(page.getByTestId("editor-viewer-title")).toHaveText("Page 1");
  await expect(page.getByTestId("editor-selection-title")).toHaveText("1 selected");
  await expect(page.locator(".editor-review-stage")).toHaveAttribute("data-render-state", "ready");
  const pdf = await downloadPDF(page);
  expect(pdf.getPages().map((p) => p.getWidth())).toEqual([500]);
  await page.getByTestId("editor-files-button").click();
  await page.getByRole("button", { name: /^Remove second.pdf/ }).click();
  await expect(page.getByTestId("editor-upload-input")).toBeAttached();
  await expect(page.getByTestId("editor-page-viewer")).toHaveCount(0);
  await expect(page.locator("[inert], [aria-modal='true']")).toHaveCount(0);
});

test("workspace focus survives view switches, ordinary Tab order and responsive rail changes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/app");
  await page
    .getByTestId("editor-upload-input")
    .setInputFiles(await source("focus.pdf", [400, 420]));
  const documentButton = page.getByTestId("editor-document-view-button");
  await documentButton.focus();
  await page.keyboard.press("Enter");
  await expect(documentButton).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("editor-add-pdf-button")).toBeFocused();
  await page.locator(".editor-sidebar .editor-brand").focus();
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(documentButton).toBeFocused();
  await page.getByRole("button", { name: "Fit page", exact: true }).focus();
  await page.setViewportSize({ width: 568, height: 320 });
  await expect(page.getByRole("button", { name: "Fit page", exact: true })).toBeFocused();
  await page.getByTestId("editor-page-viewer-next").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("editor-download-button")).toBeFocused();
  await page.getByTestId("editor-pages-view-button").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("editor-pages-view-button")).toBeFocused();
  await expect(page.getByTestId("editor-page-grid")).toBeVisible();
});

test("Document keeps untouched compression and password dialogs available without page mutations", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app");
  await page
    .getByTestId("editor-upload-input")
    .setInputFiles(await source("untouched.pdf", [400, 420]));
  await page.getByTestId("editor-document-view-button").click();
  await page.getByTestId("editor-download-options-button").click();
  const compress = page.getByTestId("editor-compress-button");
  await expect(compress).toHaveAttribute("aria-disabled", "false");
  const download = page.waitForEvent("download");
  await compress.click();
  const path = await (await download).path();
  if (!path) throw new Error("Missing compressed PDF");
  const compressed = await PDFDocument.load(await readFile(path));
  expect(compressed.getPages().map((p) => p.getWidth())).toEqual([400, 420]);
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("editor-add-pdf-button").click();
  const encrypted = Buffer.from(
    await readFile("tools/qpdf-wasm/fixtures/encrypted-40-bit-r3.b64", "utf8"),
    "base64"
  );
  await (await chooser).setFiles({
    name: "protected.pdf",
    mimeType: "application/pdf",
    buffer: encrypted,
  });
  const password = page.getByLabel("PDF password", { exact: true });
  await expect(password).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Unlock", exact: true })).toBeFocused();
  await password.fill("wrong");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(page.getByText("Incorrect password. Try again.")).toBeVisible();
  await password.fill("623");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(page.locator(".password-modal")).toHaveCount(0);
  await expect(page.getByTestId("editor-root")).toHaveAttribute("aria-busy", "false");
  await expect(page.getByTestId("editor-document-view-button")).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await page.getByTestId("editor-download-options-button").click();
  await expect(compress).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("editor-download-options-button")).toBeFocused();
  await page.getByTestId("editor-files-button").click();
  await expect(page.getByTestId("editor-file-item")).toHaveCount(2);
  await page.getByRole("button", { name: /^Remove protected.pdf/ }).click();
  await page.keyboard.press("Escape");
  await page.getByTestId("editor-download-options-button").click();
  await expect(compress).toHaveAttribute("aria-disabled", "false");
});

test("mixed image opening and additions retain EXIF orientation through both workspace views", async ({
  page,
}) => {
  const png = createPngFile();
  const jpeg = createJpegFile("portrait.jpg", true);
  const imageInput = async (file: File) => ({
    name: file.name,
    mimeType: file.type,
    buffer: Buffer.from(await file.arrayBuffer()),
  });
  await page.goto("/app");
  await page
    .getByTestId("editor-upload-input")
    .setInputFiles([
      await source("mixed.pdf", [400]),
      await imageInput(png),
      await imageInput(jpeg),
    ]);
  await expect(page.getByTestId("editor-page-tile")).toHaveCount(3);
  await page.getByTestId("editor-document-view-button").click();
  const opened = await downloadPDF(page);
  expect(opened.getPages().map((p) => p.getSize())).toEqual([
    { width: 400, height: 600 },
    { width: 841.89, height: 595.28 },
    { width: 841.89, height: 595.28 },
  ]);
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("editor-add-pdf-button").click();
  await (await chooser).setFiles([await source("added.pdf", [500]), await imageInput(jpeg)]);
  await expect(page.getByTestId("editor-root")).toHaveAttribute("aria-busy", "false");
  await expect(page.getByTestId("editor-document-view-button")).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  const added = await downloadPDF(page);
  expect(added.getPages().map((p) => p.getSize())).toEqual([
    { width: 400, height: 600 },
    { width: 841.89, height: 595.28 },
    { width: 841.89, height: 595.28 },
    { width: 500, height: 600 },
    { width: 841.89, height: 595.28 },
  ]);
});
