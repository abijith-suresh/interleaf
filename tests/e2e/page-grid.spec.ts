import { expect, type Page, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { captureDownload } from "./fixtures/download";
import { blankPdf } from "./fixtures/files";
import { downloadDocument } from "./fixtures/toolbar";

async function source(name: string, pageCount: number, width = 400) {
  return blankPdf(
    name,
    Array.from({ length: pageCount }, (_, index) => ({ width: width + index, height: 600 }))
  );
}

async function downloadPDF(page: Page) {
  const { bytes: pdfBytes } = await captureDownload(page, () => downloadDocument(page));
  return PDFDocument.load(pdfBytes);
}

test("duplicating a page keeps the selection, so the next download covers every page", async ({
  page,
}) => {
  await page.goto("/app");
  await page.getByTestId("editor-upload-input").setInputFiles(await source("three.pdf", 3));
  const tiles = page.getByTestId("editor-page-tile");

  await page.getByRole("button", { name: "Duplicate page 2", exact: true }).click();
  await expect(tiles).toHaveCount(4);
  await expect(tiles.nth(2)).toBeFocused();
  await expect(page.locator('[data-testid="editor-page-tile"][aria-pressed="true"]')).toHaveCount(
    0
  );
  await expect(page.getByTestId("editor-status-message")).toHaveText(
    "Duplicated page 2 as page 3."
  );
  expect((await downloadPDF(page)).getPageCount()).toBe(4);

  // An existing selection stays on the same pages.
  await tiles.nth(0).click();
  await page.getByRole("button", { name: "Duplicate page 1", exact: true }).click();
  await expect(tiles).toHaveCount(5);
  await expect(tiles.nth(0)).toHaveAttribute("aria-pressed", "true");
  await expect(tiles.nth(1)).toHaveAttribute("aria-pressed", "false");
  expect((await downloadPDF(page)).getPageCount()).toBe(5);
});

test("the page grid is one tab stop with arrow, Home, End, Space, R and Delete keys", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/app");
  await page.getByTestId("editor-upload-input").setInputFiles(await source("twelve.pdf", 12));
  const tiles = page.getByTestId("editor-page-tile");
  await expect(tiles).toHaveCount(12);
  const columns = await page
    .getByTestId("editor-page-grid")
    .evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length);
  expect(columns).toBe(5);

  // Tab enters the grid once, reaches only that page's actions, then leaves.
  // An explicit next focus target avoids relying on browser-chrome Tab cycling.
  await page.getByTestId("editor-page-grid").evaluate((grid) => {
    const next = document.createElement("button");
    next.id = "grid-tab-end";
    next.textContent = "After grid";
    grid.after(next);
  });
  await page.getByTestId("editor-pages-view-button").focus();
  const order: string[] = [];
  for (let step = 0; step < 30; step++) {
    await page.keyboard.press("Tab");
    if (await page.locator("#grid-tab-end").evaluate((end) => end === document.activeElement))
      break;
    const name = await page.evaluate(
      () =>
        document.activeElement?.getAttribute("aria-label") ??
        document.activeElement?.getAttribute("data-testid") ??
        ""
    );
    order.push(name);
  }
  await expect(page.locator("#grid-tab-end")).toBeFocused();
  await page.locator("#grid-tab-end").evaluate((end) => end.remove());
  // Read one pass from where the grid starts.
  const start = order.indexOf("Page 1");
  expect(start).toBeGreaterThanOrEqual(0);
  const next = order.indexOf("Page 1", start + 1);
  const pass = order.slice(start, next === -1 ? undefined : next);
  expect(pass.filter((name) => /page \d+/i.test(name))).toEqual([
    "Page 1",
    "Duplicate page 1",
    "Mark page 1 for deletion",
    "Rotate page 1 90 degrees",
  ]);
  await expect(tiles.first()).toHaveAccessibleDescription(
    /arrow keys.*Space to select a page, R to rotate it, or Delete to mark it for deletion.*Tab/
  );

  await tiles.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(tiles.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(tiles.nth(1 + columns)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(tiles.nth(1 + 2 * columns)).toBeFocused();
  // The last row is shorter, so Down from a full row lands on the last page.
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(tiles.nth(9)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(tiles.nth(11)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(tiles.nth(0)).toBeFocused();
  await page.keyboard.press("End");
  await expect(tiles.nth(11)).toBeFocused();
  await expect(tiles.nth(11)).toHaveAttribute("tabindex", "0");
  await expect(tiles.nth(0)).toHaveAttribute("tabindex", "-1");
  await expect(page.locator('[data-testid="editor-page-tile"][aria-pressed="true"]')).toHaveCount(
    0
  );

  // Shift+Tab from outside returns to the last focused page.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Duplicate page 12", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(tiles.nth(11)).toBeFocused();

  await page.keyboard.press("Space");
  await expect(tiles.nth(11)).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Space");
  await expect(tiles.nth(11)).toHaveAttribute("aria-pressed", "false");

  const canvas = page.locator(".editor-page-grid > li").nth(11).getByTestId("editor-page-canvas");
  await page.keyboard.press("r");
  await expect(canvas).toHaveCSS("--page-rotation", "90deg");
  await page.keyboard.press("Delete");
  await expect(tiles.nth(11)).toHaveAttribute("data-marked-for-deletion", "true");
  await expect(page.getByRole("button", { name: "Restore page 12", exact: true })).toBeVisible();
  await page.keyboard.press("Backspace");
  await expect(tiles.nth(11)).toHaveAttribute("data-marked-for-deletion", "false");
  await expect(tiles.nth(11)).toBeFocused();

  // Keyboard reorder still works, and focus follows the moved page.
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(tiles.nth(10)).toBeFocused();
  await expect(tiles.nth(10)).toHaveAttribute("data-source-page", "12");
  const exported = await downloadPDF(page);
  expect(exported.getPage(10).getRotation().angle).toBe(90);
  expect(exported.getPage(10).getWidth()).toBe(411);
});

test("drag and drop still reorders pages with a roving tab stop", async ({ page }) => {
  await page.goto("/app");
  await page.getByTestId("editor-upload-input").setInputFiles(await source("three.pdf", 3));
  const rows = page.locator(".editor-page-grid > li");
  await rows.nth(0).dragTo(rows.nth(2));
  await expect(page.getByTestId("editor-page-tile").nth(2)).toHaveAttribute(
    "data-source-page",
    "1"
  );
});

test("undo and redo work inside the open Files dialog and keep its list in sync", async ({
  page,
}) => {
  await page.goto("/app");
  await page
    .getByTestId("editor-upload-input")
    .setInputFiles([await source("first.pdf", 2), await source("second.pdf", 3)]);
  const tiles = page.getByTestId("editor-page-tile");
  await expect(tiles).toHaveCount(5);
  await page.getByTestId("editor-files-button").click();
  const dialog = page.getByTestId("editor-files-dialog");
  const items = dialog.getByTestId("editor-file-item");
  await expect(items).toHaveCount(2);

  await dialog.getByRole("button", { name: /Remove first\.pdf/ }).click();
  await expect(tiles).toHaveCount(3);
  await expect(items).toHaveCount(1);
  await expect(page.getByTestId("editor-files-notice")).toHaveText(
    "Removed first.pdf and 2 pages. Press Ctrl/Cmd+Z to undo."
  );
  await expect(items.first()).toBeFocused();

  await page.keyboard.press("Control+z");
  await expect(tiles).toHaveCount(5);
  await expect(items).toHaveCount(2);
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("editor-files-notice")).toHaveText("Undid source removal.");
  await expect(dialog.locator(":focus")).toHaveCount(1);

  await page.keyboard.press("Control+Shift+z");
  await expect(tiles).toHaveCount(3);
  await expect(items).toHaveCount(1);
  await expect(page.getByTestId("editor-files-notice")).toHaveText("Redid source removal.");
  await expect(dialog.locator(":focus")).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.getByTestId("editor-files-button")).toBeFocused();
});
