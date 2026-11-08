import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { createJpegFile, createPngFile } from "../../src/services/__tests__/pdf-fixtures";
import { clickAddFiles, openFiles, revealPageZoom } from "./toolbar";

async function source(name: string, widths: number[]) {
  const pdf = await PDFDocument.create();
  for (const width of widths) pdf.addPage([width, 600]);
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) };
}

async function downloadPDF(page: Page) {
  const download = page.waitForEvent("download");
  await page.getByTestId("editor-download-menu-button").click();
  await page.getByTestId("editor-download-button").click();
  const path = await (await download).path();
  if (!path) throw new Error("Missing PDF download");
  return PDFDocument.load(await readFile(path));
}

async function extractPDF(page: Page) {
  const download = page.waitForEvent("download");
  await page.getByTestId("editor-extract-button").click();
  const path = await (await download).path();
  if (!path) throw new Error("Missing extracted PDF");
  return PDFDocument.load(await readFile(path));
}

test("numbered short-landscape filmstrip shows every workspace page while some are selected", async ({
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
  await expect(filmstrip.locator(".editor-review-filmstrip-number")).toHaveText(["1", "2", "3"]);
  await expect(filmstrip.locator(".canvas-container").first()).toBeHidden();
  const thirdPage = filmstrip.getByRole("button", { name: "View page 3", exact: true });
  await expect(thirdPage).toHaveAttribute("title", "Page 3");
  await expect(thirdPage).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("editor-viewer-title")).toHaveText("Page 3");

  await filmstrip.getByRole("button", { name: "View page 2", exact: true }).click();
  await expect(page.getByTestId("editor-viewer-title")).toHaveText("Page 2");
  await page.getByTestId("editor-page-viewer-next").click();
  await expect(page.getByTestId("editor-viewer-title")).toHaveText("Page 3");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("Download exports the whole document; Extract and Escape act on the selection in both views", async ({
  page,
}) => {
  await page.goto("/app");
  await page
    .getByTestId("editor-upload-input")
    .setInputFiles(await source("pages.pdf", [400, 420, 440]));
  const tiles = page.getByTestId("editor-page-tile");
  const bar = page.getByRole("toolbar", { name: "Selected pages" });
  await expect(bar).toHaveCount(0);
  await tiles.nth(0).click();
  await tiles.nth(2).click();
  await expect(bar).toBeVisible();
  await expect(page.getByTestId("editor-selection-status")).toHaveText("2 pages selected.");
  await page.getByRole("button", { name: "Mark page 3 for deletion", exact: true }).click();
  await expect(page.getByTestId("editor-page-count")).toHaveText("2 of 3 pages exportable");

  await page.getByTestId("editor-document-view-button").click();
  await expect(page.getByTestId("editor-viewer-title")).toHaveText("Page 3");
  // A selection never narrows the Document view.
  await expect(
    page.getByRole("navigation", { name: "Document pages" }).getByRole("button")
  ).toHaveCount(3);
  await expect(page.getByLabel("Document preview")).toContainText("Marked for deletion");
  await expect(page.getByTestId("editor-selection-title")).toHaveText("2 selected · 1 exportable");
  const whole = await downloadPDF(page);
  expect(whole.getPages().map((p) => p.getWidth())).toEqual([400, 420]);
  const extracted = await extractPDF(page);
  expect(extracted.getPages().map((p) => p.getWidth())).toEqual([400]);

  await page.locator(".editor-review-stage").focus();
  await page.keyboard.press("Escape");
  await expect(bar).toHaveCount(0);
  await expect(page.getByTestId("editor-selection-status")).toHaveText("");
  await expect(page.getByTestId("editor-viewer-title")).toHaveText("Page 3");
  await page.getByRole("button", { name: "Restore page 3", exact: true }).click();
  await expect(page.getByTestId("editor-page-count")).toHaveText("3 pages");
  const restored = await downloadPDF(page);
  expect(restored.getPages().map((p) => p.getWidth())).toEqual([400, 420, 440]);

  await page.getByTestId("editor-pages-view-button").click();
  await tiles.nth(1).click();
  await page.getByRole("button", { name: "Clear page selection", exact: true }).click();
  await expect(bar).toHaveCount(0);
  await expect(tiles.nth(1)).toBeFocused();
  await tiles.nth(1).press("Space");
  await expect(bar).toBeVisible();
  await page.getByTestId("editor-pages-view-button").focus();
  await page.keyboard.press("Escape");
  await expect(bar).toHaveCount(0);
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
  await openFiles(page);
  await page.getByRole("button", { name: /^Remove first.pdf/ }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("editor-files-button")).toBeFocused();
  await expect(page.getByTestId("editor-viewer-title")).toHaveText("Page 1");
  await expect(page.getByTestId("editor-selection-title")).toHaveText("1 selected");
  await expect(page.locator(".editor-review-stage")).toHaveAttribute("data-render-state", "ready");
  const extracted = await extractPDF(page);
  expect(extracted.getPages().map((p) => p.getWidth())).toEqual([500]);
  const pdf = await downloadPDF(page);
  expect(pdf.getPages().map((p) => p.getWidth())).toEqual([500, 520]);
  await openFiles(page);
  await page.getByRole("button", { name: /^Remove second.pdf/ }).click();
  await expect(page.getByTestId("editor-upload-input")).toBeAttached();
  await expect(page.getByTestId("editor-page-viewer")).toHaveCount(0);
  await expect(page.locator("[inert], [aria-modal='true']")).toHaveCount(0);
});

test("workspace focus survives view switches, toolbar arrow keys and responsive changes", async ({
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
  // The toolbar is one Tab stop; arrow keys move inside it.
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("editor-add-pdf-button")).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByTestId("editor-download-menu-button")).toBeFocused();
  await page.keyboard.press("Home");
  const exit = page.getByTestId("editor-exit-link");
  await expect(exit).toBeFocused();
  // The narrowest layout moves Exit into the overflow list.
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(documentButton).toBeFocused();
  await revealPageZoom(page);
  await page.getByRole("button", { name: "Fit page", exact: true }).focus();
  await page.setViewportSize({ width: 568, height: 320 });
  await expect(page.getByRole("button", { name: "Fit page", exact: true })).toBeFocused();
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
  await page.getByTestId("editor-download-menu-button").click();
  const compress = page.getByTestId("editor-compress-button");
  await expect(compress).toHaveAttribute("aria-disabled", "false");
  const download = page.waitForEvent("download");
  await compress.click();
  const path = await (await download).path();
  if (!path) throw new Error("Missing compressed PDF");
  const compressed = await PDFDocument.load(await readFile(path));
  expect(compressed.getPages().map((p) => p.getWidth())).toEqual([400, 420]);
  const chooser = page.waitForEvent("filechooser");
  await clickAddFiles(page);
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
  await expect(page.getByRole("dialog", { name: "Password required" })).toBeVisible();
  expect(
    await page
      .getByRole("dialog", { name: "Password required" })
      .evaluate((node) => (node as HTMLDialogElement).matches(":modal"))
  ).toBe(true);
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
  await page.getByTestId("editor-download-menu-button").click();
  await expect(compress).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("editor-download-menu-button")).toBeFocused();
  await openFiles(page);
  await expect(page.getByTestId("editor-file-item")).toHaveCount(2);
  await page.getByRole("button", { name: /^Remove protected.pdf/ }).click();
  await page.keyboard.press("Escape");
  await page.getByTestId("editor-download-menu-button").click();
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
  await clickAddFiles(page);
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

for (const width of [1280, 375]) {
  test(`Document header acts on the active page and exports it as PNG at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/app");
    await page
      .getByTestId("editor-upload-input")
      .setInputFiles(await source("header.pdf", [400, 420, 440]));
    await page.getByTestId("editor-document-view-button").click();
    await page.getByRole("button", { name: "View page 2", exact: true }).click();
    await expect(page.getByTestId("editor-viewer-title")).toHaveText("Page 2");
    const actions = page.getByTestId("editor-page-actions-button");
    const action = async (name: string) => {
      if (await actions.isVisible()) await actions.click();
      await page.getByRole("button", { name, exact: true }).click();
    };
    await action("Rotate page 2 90 degrees");
    await action("Duplicate page 2");
    await expect(page.getByTestId("editor-viewer-title")).toHaveText("Page 3");
    await expect(
      page.getByRole("navigation", { name: "Document pages" }).getByRole("button")
    ).toHaveCount(4);
    await action("Mark page 3 for deletion");
    await expect(page.getByLabel("Document preview")).toContainText("Marked for deletion");
    if (await actions.isVisible()) await actions.click();
    await expect(
      page.getByRole("button", { name: "Restore page 3 to export it as a PNG image" })
    ).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");
    await action("Mark page 3 for deletion");
    // With nothing selected, the active page is the PNG target.
    const png = page.waitForEvent("download");
    await action("Export page 3 as a PNG image");
    const zip = await (await png).path();
    if (!zip) throw new Error("Missing PNG export");
    const { unzipSync } = await import("fflate");
    expect(Object.keys(unzipSync(await readFile(zip)))).toHaveLength(1);
    const pdf = await downloadPDF(page);
    expect(pdf.getPages().map((p) => [p.getWidth(), p.getRotation().angle])).toEqual([
      [400, 0],
      [420, 90],
      [420, 90],
      [440, 0],
    ]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
  });
}
