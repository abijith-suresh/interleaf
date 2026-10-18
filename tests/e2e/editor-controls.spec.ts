import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

async function report() {
  const pdf = await PDFDocument.create();
  for (const width of [400, 420, 440]) pdf.addPage([width, 600]);
  return { name: "report.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) };
}

const image = {
  name: "image.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  ),
};

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
  { width: 568, height: 320 },
]) {
  test(`editor actions, keyboard focus and export at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/app");
    await page.getByTestId("editor-upload-input").setInputFiles([await report(), image]);
    const tiles = page.getByTestId("editor-page-tile");
    await expect(tiles).toHaveCount(4);
    await expect(page.getByTestId("editor-root")).toHaveAttribute("aria-busy", "false");

    // Icon-only actions keep their hit targets and remain inside the viewport.
    for (const id of [
      "editor-review-button",
      "editor-add-pdf-button",
      "editor-files-button",
      "editor-edit-menu-button",
      "editor-download-button",
      "editor-download-options-button",
    ]) {
      const box = await page.getByTestId(id).boundingBox();
      if (!box) throw new Error(`${id} is not visible`);
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    }
    const review = page.getByTestId("editor-review-button");
    await page.getByRole("link", { name: "Return to Interleaf home" }).focus();
    await page.keyboard.press("Tab");
    await expect(review).toBeFocused();
    await expect(review).toHaveCSS("outline-color", "rgb(36, 36, 33)");
    await expect(review).toHaveCSS("outline-style", "solid");
    await expect(review).toHaveCSS("outline-width", "2px");
    await expect(review.locator("svg")).toHaveCSS("width", "18px");
    await expect(review.locator("svg")).toHaveAttribute("stroke-width", "1.75");

    const edit = page.getByTestId("editor-edit-menu-button");
    await edit.focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("editor-select-all-button")).toBeFocused();
    await page.keyboard.press("End");
    const deleteSelected = page.getByTestId("editor-delete-button");
    await expect(deleteSelected).toBeFocused();
    await expect(deleteSelected).toHaveAttribute("aria-disabled", "true");
    await expect(deleteSelected).toHaveCSS("outline-color", "rgb(36, 36, 33)");
    await expect(deleteSelected).toHaveCSS("opacity", "1");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("editor-edit-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(edit).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(deleteSelected).toBeFocused();
    await page.keyboard.press("Home");
    await expect(page.getByTestId("editor-select-all-button")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("editor-download-button")).toBeFocused();
    await expect(page.getByRole("menu")).toHaveCount(0);

    // Selection, keyboard reordering and rotation still act on the same source page.
    await tiles.first().click();
    await page.keyboard.press("Alt+ArrowRight");
    await expect(tiles.nth(1)).toHaveAttribute("data-source-page", "1");
    await expect(tiles.nth(1)).toHaveAttribute("aria-pressed", "true");
    await edit.click();
    await page.getByTestId("editor-rotate-button").click();
    const movedPage = page.locator(".editor-page-grid > li").nth(1);
    await expect(movedPage.getByTestId("editor-page-canvas")).toHaveCSS("--page-rotation", "90deg");
    await edit.click();
    await deleteSelected.click();
    await expect(page.getByTestId("editor-download-button")).toBeDisabled();
    const restore = movedPage.getByTestId("editor-page-delete-button");
    await expect(restore).toHaveAttribute("aria-pressed", "true");
    await expect(restore).toHaveClass(/is-marked/);
    await restore.click();
    await expect(restore).toHaveAttribute("aria-pressed", "false");
    await expect(restore).not.toHaveClass(/is-marked/);
    await expect(tiles.nth(1)).toHaveAttribute("aria-pressed", "true");

    const download = page.waitForEvent("download");
    await page.getByTestId("editor-download-button").click();
    const path = await (await download).path();
    if (!path) throw new Error("PDF download failed");
    const exported = await PDFDocument.load(await readFile(path));
    expect(exported.getPageCount()).toBe(1);
    expect(exported.getPage(0).getWidth()).toBe(400);
    expect(exported.getPage(0).getRotation().angle).toBe(90);

    await tiles.nth(1).focus();
    await page.keyboard.press("Escape");
    await review.click();
    await expect(page.getByTestId("editor-page-viewer-close-button")).toBeFocused();
    await page.getByTestId("editor-page-viewer-next").click();
    await expect(page.getByTestId("editor-viewer-title")).toHaveText("Page 3");
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("editor-viewer-title")).toHaveText("Page 2");
    await page.keyboard.press("Escape");
    await expect(review).toBeFocused();

    const chooser = page.waitForEvent("filechooser");
    await page.getByTestId("editor-add-pdf-button").click();
    await (await chooser).setFiles({ ...(await report()), name: "additional.pdf" });
    await expect(tiles).toHaveCount(7);
    const files = page.getByTestId("editor-files-button");
    await files.click();
    const dialog = page.getByTestId("editor-files-dialog");
    await expect(page.getByTestId("editor-files-close-button")).toBeFocused();
    await dialog.getByRole("button", { name: "Remove additional.pdf", exact: false }).click();
    await expect(tiles).toHaveCount(4);
    await expect(dialog.getByTestId("editor-file-item").last()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(files).toBeFocused();
    expect(errors).toEqual([]);
  });
}

test("touch taps release transient styles while selected states remain visible", async ({
  browser,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 320, height: 568 },
  });
  const page = await context.newPage();
  await page.goto("/app");
  await page.getByTestId("editor-upload-input").setInputFiles(await report());
  const remove = page.getByTestId("editor-page-delete-button").first();
  const rotate = page.getByTestId("editor-page-rotate-button").first();
  await expect(rotate).toBeVisible();
  expect(await page.evaluate(() => matchMedia("(hover: hover) and (pointer: fine)").matches)).toBe(
    false
  );
  await rotate.tap();
  await expect(rotate).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await remove.tap();
  await expect(remove).toHaveCSS("background-color", "rgb(255, 241, 238)");
  await expect(remove).toHaveAttribute("aria-pressed", "true");
  await remove.tap();
  await expect(remove).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const options = page.getByTestId("editor-download-options-button");
  await options.tap();
  await expect(options).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("heading", { name: "Pages", exact: true }).tap();
  await expect(options).toHaveAttribute("aria-expanded", "false");
  await expect(options).toHaveCSS("background-color", "rgb(201, 55, 48)");
  await expect(options).toHaveCSS("transform", "none");
  await context.close();
});
