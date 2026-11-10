import { expect, type Page, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { captureDownload } from "./fixtures/download";
import { clickAddFiles, clickSelectionAction, downloadDocument } from "./fixtures/toolbar";

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

async function savePDF(page: Page, action: () => Promise<unknown>) {
  const { bytes: pdfBytes } = await captureDownload(page, action);
  return PDFDocument.load(pdfBytes);
}

for (const width of [1280, 390]) {
  test(`keyboard reorder retains logical page focus at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/app");
    await page.getByTestId("editor-upload-input").setInputFiles(await report());
    const tiles = page.getByTestId("editor-page-tile");
    await tiles.nth(2).focus();
    for (const [key, index] of [
      ["ArrowLeft", 1],
      ["ArrowLeft", 0],
      ["ArrowLeft", 0],
      ["ArrowRight", 1],
      ["ArrowRight", 2],
      ["ArrowRight", 2],
      ["ArrowLeft", 1],
    ] as const) {
      await page.keyboard.press(`Alt+${key}`);
      await expect(tiles.nth(index)).toBeFocused();
      await expect(tiles.nth(index)).toHaveAttribute("data-source-page", "3");
      await expect(tiles.nth(index)).toHaveAttribute("aria-pressed", "false");
    }
    await page.keyboard.press("Space");
    await expect(tiles.nth(1)).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Duplicate page 2", exact: true }).click();
    await expect(tiles.nth(2)).toBeFocused();
    // The copy is focused but not selected; the selection stays on its source.
    await expect(tiles.nth(2)).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Alt+ArrowLeft");
    await expect(tiles.nth(1)).toBeFocused();
    await expect(tiles.nth(1)).toHaveAttribute("aria-pressed", "false");
    await expect(tiles.nth(2)).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Alt+ArrowRight");
    await expect(tiles.nth(2)).toBeFocused();
    await expect(tiles.nth(1)).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("editor-document-view-button").click();
    await expect(page.getByTestId("editor-viewer-title")).toHaveText("Page 2");
    const extracted = await savePDF(page, () =>
      clickSelectionAction(page, "editor-extract-button")
    );
    expect(extracted.getPages().map((p) => p.getWidth())).toEqual([440]);
    const whole = await savePDF(page, () => downloadDocument(page));
    expect(whole.getPages().map((p) => p.getWidth())).toEqual([400, 440, 440, 420]);
  });
}

for (const viewport of [
  { width: 1440, height: 800 },
  { width: 375, height: 844 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
  { width: 568, height: 320 },
  { width: 667, height: 320 },
]) {
  test(`duplicate action fits tiles and supports keyboard at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/app");
    await page.getByTestId("editor-upload-input").setInputFiles(await report());
    const tile = page.locator(".editor-page-grid > li").first();
    const bounds = await tile.boundingBox();
    if (!bounds) throw new Error("Missing tile");
    const actions = tile.locator(".page-action-buttons button");
    await expect(actions).toHaveCount(3);
    const boxes = [];
    for (const action of await actions.all()) {
      const box = await action.boundingBox();
      if (!box) throw new Error("Missing action");
      await expect(action).toHaveCSS("min-width", "44px");
      await expect(action).toHaveCSS("min-height", "44px");
      // Firefox bounding boxes can report 44px as 43.999992px.
      expect(Number(box.width.toFixed(4))).toBeGreaterThanOrEqual(44);
      expect(Number(box.height.toFixed(4))).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(bounds.x);
      expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height);
      boxes.push(box);
    }
    const label = await tile.locator(".page-label").boundingBox();
    const thumbnail = await tile.locator(".editor-page-preview").boundingBox();
    if (!label || !thumbnail) throw new Error("Missing page content");
    for (const [index, box] of boxes.entries()) {
      expect(box.y).toBeGreaterThanOrEqual(thumbnail.y + thumbnail.height);
      for (const other of [label, ...boxes.slice(index + 1)]) {
        const overlapX =
          Math.min(box.x + box.width, other.x + other.width) - Math.max(box.x, other.x);
        const overlapY =
          Math.min(box.y + box.height, other.y + other.height) - Math.max(box.y, other.y);
        // Fractional grid columns can leave Firefox boxes touching by a rounding error.
        expect(overlapX > 0.01 && overlapY > 0.01).toBe(false);
      }
    }
    const duplicate = tile.getByTestId("editor-page-duplicate-button");
    await duplicate.focus();
    await expect(duplicate).toHaveCSS("outline-color", "rgb(23, 128, 79)");
    await expect(duplicate).toHaveCSS("outline-width", "2px");
    await expect(duplicate).toHaveCSS("outline-style", "solid");
    // Dragging the action must never begin a page reorder.
    await duplicate.dispatchEvent("dragstart");
    await expect(tile).not.toHaveClass(/dragging/);
    await page.keyboard.press("Space");
    const tiles = page.getByTestId("editor-page-tile");
    await expect(tiles).toHaveCount(4);
    await expect(tiles.nth(1)).toBeFocused();
    await expect(tiles.nth(1)).toHaveAttribute("aria-pressed", "false");
    await expect(tiles.nth(0)).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".editor-page-grid > li.dragging")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
  });

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
    const narrow = viewport.width < 768;
    const more = page.getByTestId("editor-more-button");
    await expect(more).toBeVisible({ visible: narrow });

    // One toolbar row. Every visible control keeps a 44px hit target inside the viewport.
    const toolbar = page.getByRole("toolbar", { name: "Editor" });
    if (viewport.width === 1440) {
      await expect(page.getByTestId("editor-pages-view-button")).toHaveCSS("font-size", "14px");
    }
    const controls = toolbar.locator("button:visible, a:visible");
    const centers: number[] = [];
    for (const control of await controls.all()) {
      const box = await control.boundingBox();
      if (!box) throw new Error("Toolbar control is not visible");
      centers.push(box.y + box.height / 2);
      // Controls drawn smaller than 44px extend their hit area invisibly. The
      // probes stay 1px inside the edge, clear of sub-pixel rounding between neighbours.
      const reaches = await control.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const x = rect.x + rect.width / 2;
        const y = rect.y + rect.height / 2;
        return [
          [x - 21, y],
          [x + 21, y],
          [x, y - 21],
          [x, y + 21],
        ].every(([px, py]) => element.contains(document.elementFromPoint(px, py)));
      });
      expect(reaches).toBe(true);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    }
    expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(2);
    // Undo and redo stay in the row at every width; the page count sits by Download.
    await expect(page.getByTestId("editor-undo-button")).toBeVisible();
    await expect(page.getByTestId("editor-redo-button")).toBeVisible();
    await expect(page.getByTestId("editor-page-count")).toBeVisible({ visible: !narrow });

    const review = page.getByTestId("editor-document-view-button");
    await page.getByTestId("editor-pages-view-button").focus();
    await page.keyboard.press("ArrowRight");
    await expect(review).toBeFocused();
    await expect(review).toHaveCSS("outline-color", "rgb(23, 128, 79)");
    await expect(review).toHaveCSS("outline-style", "solid");
    await expect(review).toHaveCSS("outline-width", "2px");
    await expect(review.locator("svg")).toHaveCSS("width", "16px");
    await expect(review.locator("svg")).toHaveAttribute("stroke-width", "1.75");

    // The Download menu: whole-document outputs with their disabled reasons.
    const downloadMenu = page.getByTestId("editor-download-menu-button");
    await downloadMenu.focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("editor-download-button")).toBeFocused();
    await page.keyboard.press("End");
    const compress = page.getByTestId("editor-compress-button");
    await expect(compress).toBeFocused();
    await expect(compress).toHaveAttribute("aria-disabled", "true");
    await expect(compress).toContainText("Compress works on one untouched PDF");
    await expect(compress).toHaveCSS("outline-color", "rgb(23, 128, 79)");
    await expect(compress).toHaveCSS("opacity", "1");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("editor-download-menu")).toBeVisible();
    const menu = await page.getByTestId("editor-download-menu").boundingBox();
    if (!menu) throw new Error("Missing Download menu");
    expect(menu.x).toBeGreaterThanOrEqual(0);
    expect(menu.x + menu.width).toBeLessThanOrEqual(viewport.width);
    await page.keyboard.press("Escape");
    await expect(downloadMenu).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(compress).toBeFocused();
    await page.keyboard.press("Home");
    await expect(page.getByTestId("editor-download-button")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(toolbar.locator(":focus")).toHaveCount(0);

    // Selecting pages slides in the selection bar under the toolbar.
    const bar = page.getByRole("toolbar", { name: "Selected pages" });
    await expect(bar).toHaveCount(0);
    await tiles.first().click();
    await expect(bar).toBeVisible();
    if (viewport.width === 1440) {
      await expect(page.getByTestId("editor-rotate-button")).toHaveCSS("font-size", "14px");
    }
    const toolbarBox = await toolbar.boundingBox();
    await expect
      .poll(async () => (await bar.boundingBox())?.y)
      .toBeGreaterThanOrEqual(Math.floor((toolbarBox?.y ?? 0) + (toolbarBox?.height ?? 0)) - 1);
    await expect(page.getByTestId("editor-selection-status")).toHaveText("1 page selected.");
    await page.keyboard.press("Alt+ArrowRight");
    await expect(tiles.nth(1)).toHaveAttribute("data-source-page", "1");
    await expect(tiles.nth(1)).toBeFocused();
    await expect(tiles.nth(1)).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("editor-rotate-button").click();
    const movedPage = page.locator(".editor-page-grid > li").nth(1);
    await expect(movedPage.getByTestId("editor-page-canvas")).toHaveCSS("--page-rotation", "90deg");
    await page.getByTestId("editor-rotate-left-button").click();
    await expect(movedPage.getByTestId("editor-page-canvas")).toHaveCSS("--page-rotation", "0deg");
    await page.getByTestId("editor-rotate-button").click();
    const selectionMore = page.getByTestId("editor-selection-more-button");
    if (narrow) await selectionMore.click();
    await page.getByTestId("editor-delete-button").click();
    await expect(page.getByTestId("editor-extract-button")).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    const restore = movedPage.getByTestId("editor-page-delete-button");
    await expect(restore).toHaveAccessibleName("Restore page 2");
    await expect(restore).toHaveClass(/is-marked/);
    await restore.click();
    await expect(restore).toHaveAccessibleName("Mark page 2 for deletion");
    await expect(restore).not.toHaveClass(/is-marked/);
    await expect(tiles.nth(1)).toHaveAttribute("aria-pressed", "true");
    for (const control of await bar.locator("button:visible").all()) {
      const box = await control.boundingBox();
      if (!box) throw new Error("Missing selection control");
      expect(Number(box.width.toFixed(4))).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    }

    if (narrow) await selectionMore.click();
    const extracted = await savePDF(page, () => page.getByTestId("editor-extract-button").click());
    expect(extracted.getPageCount()).toBe(1);
    expect(extracted.getPage(0).getWidth()).toBe(400);
    expect(extracted.getPage(0).getRotation().angle).toBe(90);
    const whole = await savePDF(page, async () => {
      await downloadMenu.click();
      await page.getByTestId("editor-download-button").click();
    });
    expect(whole.getPageCount()).toBe(4);

    await tiles.nth(1).focus();
    await page.keyboard.press("Escape");
    await expect(bar).toHaveCount(0);
    await review.click();
    await expect(review).toBeFocused();
    await expect(page.locator("[inert], [aria-modal='true']:visible")).toHaveCount(0);
    const stage = page.locator(".editor-review-stage");
    const stageBounds = await stage.boundingBox();
    expect(stageBounds?.height).toBeGreaterThan(viewport.height <= 320 ? 150 : 240);
    await page.getByTestId("editor-page-viewer-next").click();
    await expect(page.getByTestId("editor-viewer-title")).toHaveText("Page 3");
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("editor-viewer-title")).toHaveText("Page 2");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("editor-page-viewer")).toBeVisible();
    await page.getByTestId("editor-pages-view-button").click();
    await expect(page.getByTestId("editor-pages-view-button")).toBeFocused();

    const chooser = page.waitForEvent("filechooser");
    await clickAddFiles(page);
    await (await chooser).setFiles({ ...(await report()), name: "additional.pdf" });
    await expect(tiles).toHaveCount(7);
    const files = page.getByTestId("editor-files-button");
    if (narrow) await more.click();
    await files.click();
    const dialog = page.getByTestId("editor-files-dialog");
    await expect(page.getByTestId("editor-files-close-button")).toBeFocused();
    await dialog.getByRole("button", { name: "Remove additional.pdf", exact: false }).click();
    await expect(tiles).toHaveCount(4);
    await expect(dialog.getByTestId("editor-file-item").last()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    // Files may sit in the closed overflow list; focus returns to what opened it.
    await expect(narrow ? more : files).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
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
  await expect(remove).toHaveCSS("background-color", "rgb(254, 242, 242)");
  await expect(remove).toHaveAccessibleName("Restore page 1");
  await remove.tap();
  await expect(remove).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const duplicate = page.getByTestId("editor-page-duplicate-button").first();
  await duplicate.tap();
  await expect(page.getByTestId("editor-page-tile")).toHaveCount(4);
  await expect(page.getByTestId("editor-page-tile").nth(1)).toBeFocused();
  await expect(page.getByTestId("editor-page-tile").nth(1)).toHaveAttribute(
    "aria-pressed",
    "false"
  );
  await expect(duplicate).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const options = page.getByTestId("editor-download-menu-button");
  await options.tap();
  await expect(options).toHaveAttribute("aria-expanded", "true");
  await page.locator(".editor-page-scroll").tap({ position: { x: 4, y: 4 } });
  await expect(options).toHaveAttribute("aria-expanded", "false");
  await expect(options).toHaveCSS("background-color", "rgb(20, 39, 31)");
  await expect(options).toHaveCSS("transform", "none");
  await context.close();
});
