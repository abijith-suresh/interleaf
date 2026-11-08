import { expect, type Page } from "@playwright/test";
import { createJpegFile, createPngFile } from "../../src/services/__tests__/pdf-fixtures";
import { captureDownload } from "./fixtures/download";
import type { inspectZIP } from "./fixtures/duplication";
import { inspect, source } from "./fixtures/duplication-input";
import { test } from "./fixtures/duplication-server";
import { encryptedFixture, filePayload } from "./fixtures/files";
import { downloadDocument, openFiles } from "./fixtures/toolbar";

async function download(page: Page, action: () => Promise<unknown>) {
  return Array.from((await captureDownload(page, action)).bytes);
}

test("mixed history restores real PDF order, rotations, text, selected PNG pixels and compression", async ({
  page,
  context,
  url,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/app");
  await page.getByTestId("editor-upload-input").setInputFiles(await source());
  const tiles = page.getByTestId("editor-page-tile");
  const undo = page.getByTestId("editor-undo-button");
  const redo = page.getByTestId("editor-redo-button");
  const reader = await context.newPage();
  await reader.goto(`${url}duplicate-test`);
  const pdf = () => download(page, () => downloadDocument(page));
  const original = await inspect(reader, await pdf());
  await page.getByRole("button", { name: "Rotate page 1 90 degrees", exact: true }).click();
  await page.getByRole("button", { name: "Duplicate page 1", exact: true }).click();
  await expect(tiles.nth(1)).toBeFocused();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(tiles.nth(2)).toBeFocused();
  // Select the copy, then page 2, which stays the active page.
  await tiles.nth(2).click();
  await tiles.nth(1).click();
  for (const id of ["editor-rotate-button", "editor-delete-button", "editor-delete-button"]) {
    await page.getByTestId(id).click();
  }
  await page.getByRole("button", { name: "Mark page 1 for deletion", exact: true }).click();
  await page.getByTestId("editor-document-view-button").click();
  const changed = await inspect(reader, await pdf());
  expect(changed.count).toBe(2);
  expect(changed.pages.map((p) => [p.text, p.rotation, p.libRotation])).toEqual([
    ["Source 2", 90, 90],
    ["Source 1", 270, 270],
  ]);
  const png = async () => {
    await page.getByTestId("editor-download-menu-button").click();
    const zip = await download(page, () => page.getByTestId("editor-export-images-button").click());
    return reader.evaluate(async (bytes): Promise<Awaited<ReturnType<typeof inspectZIP>>> => {
      const path = "/tests/e2e/fixtures/duplication.ts";
      return (await import(path)).inspectZIP(bytes);
    }, zip);
  };
  const changedPNG = await png();
  expect(changedPNG.map((p) => [p.hash, p.size, p.ink])).toEqual(
    changed.pages.map((p) => [p.hash, p.size, p.ink])
  );
  for (let step = 0; step < 7; step++) await undo.click();
  await expect(undo).toBeFocused();
  await expect(undo).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByTestId("editor-document-view-button")).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(page.getByRole("toolbar", { name: "Selected pages" })).toHaveCount(0);
  expect(await inspect(reader, await pdf())).toEqual(original);
  await page.getByTestId("editor-download-menu-button").click();
  await expect(page.getByTestId("editor-compress-button")).toHaveAttribute(
    "aria-disabled",
    "false"
  );
  await page.keyboard.press("Escape");
  for (let step = 0; step < 7; step++) await redo.click();
  expect(await inspect(reader, await pdf())).toEqual(changed);
  expect(await png()).toEqual(changedPNG);
  await expect(page.getByTestId("editor-viewer-title")).toHaveText("Page 2");
  await page.getByTestId("editor-pages-view-button").click();
  await tiles.nth(2).focus();
  // Reordering undo preserves focus on the same logical copy.
  for (let step = 0; step < 5; step++) await page.keyboard.press("Control+z");
  await expect(tiles.nth(1)).toBeFocused();
  // Undoing duplication removes that copy and gives focus to a surviving page.
  await page.keyboard.press("Control+z");
  await expect(tiles).toHaveCount(2);
  await expect(tiles.nth(0)).toBeFocused();
  await page.keyboard.press("Control+y");
  await expect(tiles).toHaveCount(3);
  await page.getByRole("button", { name: "Rotate page 3 90 degrees", exact: true }).click();
  await expect(redo).toHaveAttribute("aria-disabled", "true");
  expect(errors).toEqual([]);
});

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 568, height: 320 },
  { width: 667, height: 320 },
]) {
  test(`history remains reachable without overflow at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/app");
    await page.getByTestId("editor-upload-input").setInputFiles(await source());
    for (const id of ["editor-undo-button", "editor-redo-button"]) {
      const button = page.getByTestId(id);
      await expect(button).toHaveAttribute("aria-disabled", "true");
      const bounds = await button.boundingBox();
      expect(bounds).toBeTruthy();
      if (!bounds) throw new Error("Missing history button");
      // Compact controls extend their hit area beyond their visual box.
      expect(
        await button.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          const x = bounds.x + bounds.width / 2;
          const y = bounds.y + bounds.height / 2;
          return [
            [x - 21, y],
            [x + 21, y],
            [x, y - 21],
            [x, y + 21],
          ].every(([px, py]) => element.contains(document.elementFromPoint(px, py)));
        })
      ).toBe(true);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    }
    // History stays in the toolbar. Phones list Exit under More.
    const toolbar = await page.getByRole("toolbar", { name: "Editor" }).boundingBox();
    const undoBox = await page.getByTestId("editor-undo-button").boundingBox();
    if (!toolbar || !undoBox) throw new Error("Missing toolbar");
    expect(undoBox.y).toBeGreaterThanOrEqual(toolbar.y - 1);
    expect(undoBox.y + undoBox.height).toBeLessThanOrEqual(toolbar.y + toolbar.height + 1);
    const exit = page.getByTestId("editor-exit-link");
    if (viewport.width < 768) {
      await expect(exit).toBeHidden();
      await page.getByTestId("editor-more-button").click();
      await expect(page.getByRole("link", { name: "Exit editor" })).toBeVisible();
      await page.keyboard.press("Escape");
    } else {
      const exitBox = await exit.boundingBox();
      if (!exitBox) throw new Error("Missing Exit");
      expect(exitBox.x).toBeGreaterThanOrEqual(0);
      expect(exitBox.y + exitBox.height).toBeLessThanOrEqual(toolbar.y + toolbar.height + 1);
    }
    await page.getByRole("button", { name: "Rotate page 1 90 degrees", exact: true }).click();
    await page.getByTestId("editor-undo-button").click();
    await expect(page.getByTestId("editor-undo-button")).toBeFocused();
    await page.getByTestId("editor-document-view-button").click();
    await page.getByTestId("editor-redo-button").click();
    await expect(page.getByTestId("editor-viewer-title")).toHaveText("Page 1");
    const stage = await page.locator(".editor-review-stage").boundingBox();
    expect(stage?.height).toBeGreaterThan(viewport.height <= 320 ? 150 : 240);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
  });
}

test("pointer and touch drags record one committed move and ignore canceled gestures", async ({
  page,
}) => {
  await page.goto("/app");
  await page.getByTestId("editor-upload-input").setInputFiles(await source());
  const tiles = page.getByTestId("editor-page-tile");
  const rows = page.locator(".editor-page-grid > li");
  const undo = page.getByTestId("editor-undo-button");
  await rows.nth(0).dragTo(rows.nth(1));
  await expect(tiles.nth(0)).toHaveAttribute("data-source-page", "2");
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press("Control+z");
  await expect(tiles.nth(0)).toHaveAttribute("data-source-page", "1");
  await expect(undo).toHaveAttribute("aria-disabled", "true");
  const touch = async (type: string, index: number, target: number) => {
    await tiles.nth(index).evaluate(
      (element, { type, target }) => {
        const bounds = document
          .querySelectorAll('[data-testid="editor-page-tile"]')
          [target].getBoundingClientRect();
        const point = {
          identifier: 1,
          target: element,
          clientX: bounds.x + bounds.width / 2,
          clientY: bounds.y + bounds.height / 2,
        };
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperties(event, {
          touches: { value: type === "touchend" || type === "touchcancel" ? [] : [point] },
          changedTouches: { value: [point] },
        });
        element.dispatchEvent(event);
      },
      { type, target }
    );
  };
  await touch("touchstart", 0, 0);
  await expect(rows.nth(0)).toHaveClass(/dragging/);
  await touch("touchmove", 0, 1);
  await touch("touchcancel", 0, 1);
  await expect(undo).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByTestId("editor-redo-button")).toHaveAttribute("aria-disabled", "false");
  await touch("touchstart", 0, 0);
  await expect(rows.nth(0)).toHaveClass(/dragging/);
  await touch("touchmove", 0, 1);
  await touch("touchend", 0, 1);
  await expect(tiles.nth(0)).toHaveAttribute("data-source-page", "2");
  await undo.click();
  await expect(tiles.nth(0)).toHaveAttribute("data-source-page", "1");
  await expect(undo).toHaveAttribute("aria-disabled", "true");
});

test("Document keeps keyboard focus when undo removes the active copy or disables reading navigation", async ({
  page,
}) => {
  await page.goto("/app");
  await page.getByTestId("editor-upload-input").setInputFiles(await source());
  // Copy the last page, so redo leaves the active copy on the last page.
  await page.getByRole("button", { name: "Duplicate page 2", exact: true }).click();
  await page.getByTestId("editor-document-view-button").click();
  const filmstrip = page.getByRole("navigation", { name: "Document pages" });
  await filmstrip.getByRole("button", { name: "View page 3", exact: true }).focus();
  await page.keyboard.press("Control+z");
  await expect(filmstrip.getByRole("button", { name: "View page 1", exact: true })).toBeFocused();
  await page.keyboard.press("Control+Shift+z");
  await expect(page.getByTestId("editor-viewer-title")).toHaveText("Page 3");
  await expect(filmstrip.getByRole("button", { name: "View page 3", exact: true })).toHaveAttribute(
    "aria-current",
    "page"
  );
  await page.getByTestId("editor-undo-button").click();
  const next = page.getByTestId("editor-page-viewer-next");
  await next.focus();
  await page.keyboard.press("Control+y");
  await expect(next).toBeDisabled();
  await expect(filmstrip.getByRole("button", { name: "View page 3", exact: true })).toBeFocused();
});

test("text controls, open menus, dialogs and failed imports preserve history; source commits extend it", async ({
  page,
}) => {
  await page.goto("/app");
  await page.getByTestId("editor-upload-input").setInputFiles(await source());
  const undo = page.getByTestId("editor-undo-button");
  const redo = page.getByTestId("editor-redo-button");
  await page.getByRole("button", { name: "Rotate page 1 90 degrees", exact: true }).click();
  await page.evaluate(() => {
    const root = document.querySelector('[data-testid="editor-root"]');
    for (const tag of ["input", "textarea", "select", "div"]) {
      const input = document.createElement(tag);
      input.dataset.testid = `history-${tag}`;
      if (tag === "div") input.contentEditable = "true";
      input.setAttribute("aria-label", `History test ${tag}`);
      root?.append(input);
    }
  });
  for (const tag of ["input", "textarea", "select", "div"]) {
    await page.getByTestId(`history-${tag}`).focus();
    await page.keyboard.press("Control+z");
    await expect(undo).toHaveAttribute("aria-disabled", "false");
  }
  await page.evaluate(() => {
    document.querySelectorAll('[data-testid^="history-"]').forEach((element) => {
      element.remove();
    });
  });
  await page.getByTestId("editor-download-menu-button").click();
  await page.keyboard.press("Control+z");
  await expect(undo).toHaveAttribute("aria-disabled", "false");
  await page.keyboard.press("Escape");
  await openFiles(page);
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("editor-files-notice")).toHaveText("Undid page rotation.");
  await expect(undo).toHaveAttribute("aria-disabled", "true");
  await expect(redo).toHaveAttribute("aria-disabled", "false");
  await page.getByTestId("editor-files-close-button").click();
  await page.getByTestId("editor-add-pdf-input").setInputFiles({
    name: "broken.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("invalid PDF"),
  });
  await expect(page.getByTestId("editor-root")).toHaveAttribute("aria-busy", "false");
  await expect(redo).toHaveAttribute("aria-disabled", "false");
  await page
    .getByTestId("editor-add-pdf-input")
    .setInputFiles({ ...(await source()), name: "second.pdf" });
  await expect(page.getByTestId("editor-page-tile")).toHaveCount(4);
  await expect(redo).toHaveAttribute("aria-disabled", "true");
  await expect(undo).toHaveAttribute("aria-label", "Undo source addition");
  await page.getByRole("button", { name: "Duplicate page 1", exact: true }).click();
  await openFiles(page);
  await page.getByTestId("editor-file-remove").nth(0).click();
  await page.getByTestId("editor-files-close-button").click();
  await expect(page.getByTestId("editor-page-tile")).toHaveCount(2);
  await expect(undo).toHaveAttribute("aria-disabled", "false");
  await openFiles(page);
  await page.getByTestId("editor-file-remove").click();
  await expect(page.getByTestId("editor-upload-input")).toBeAttached();
  await expect(page.getByTestId("editor-root")).toHaveAttribute("aria-busy", "false");
  await page.getByTestId("editor-upload-input").setInputFiles(await source());
  await expect(undo).toHaveAttribute("aria-label", "Undo source addition");
  await expect(redo).toHaveAttribute("aria-disabled", "true");
});

const idle = (page: Page) =>
  expect(page.getByTestId("editor-root")).toHaveAttribute("aria-busy", "false");
async function historyStep(page: Page, direction: "undo" | "redo") {
  await page.getByTestId(`editor-${direction}-button`).click();
  await idle(page);
}

test("source and page history restores real mixed PDF, PNG and EXIF JPEG output including copied forms", async ({
  page,
  context,
  url,
}) => {
  test.setTimeout(90_000);
  await page.goto("/app");
  await page.getByTestId("editor-upload-input").setInputFiles(await source(true));
  const tiles = page.getByTestId("editor-page-tile");
  const reader = await context.newPage();
  await reader.goto(`${url}duplicate-test`);
  const pdf = async () => inspect(reader, await download(page, () => downloadDocument(page)));
  const png = async () => {
    await page.getByTestId("editor-download-menu-button").click();
    const bytes = await download(page, () =>
      page.getByTestId("editor-export-images-button").click()
    );
    return reader.evaluate(async (bytes): Promise<Awaited<ReturnType<typeof inspectZIP>>> => {
      const path = "/tests/e2e/fixtures/duplication.ts";
      return (await import(path)).inspectZIP(bytes);
    }, bytes);
  };
  const original = await pdf();
  await page
    .getByTestId("editor-add-pdf-input")
    .setInputFiles([
      await source(),
      await filePayload(createPngFile()),
      await filePayload(createJpegFile("portrait.jpg", true)),
    ]);
  await expect(tiles).toHaveCount(6);
  const added = await pdf();
  expect(added.pages.slice(0, 2)).toEqual(original.pages);
  expect(added.pages.slice(4).map((p) => p.libSize)).toEqual([
    { width: 841.89, height: 595.28 },
    { width: 841.89, height: 595.28 },
  ]);
  await page.getByRole("button", { name: "Duplicate page 5", exact: true }).click();
  await page.getByRole("button", { name: "Rotate page 6 90 degrees", exact: true }).click();
  await tiles.nth(5).focus();
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page.locator('[data-testid="editor-page-tile"][aria-pressed="true"]')).toHaveCount(
    0
  );
  await page.getByRole("button", { name: "Mark page 1 for deletion", exact: true }).click();
  const changed = await pdf();
  const changedPNG = await png();
  expect(changedPNG.map((p) => [p.hash, p.size, p.ink])).toEqual(
    changed.pages.map((p) => [p.hash, p.size, p.ink])
  );
  await openFiles(page);
  await page.getByTestId("editor-file-remove").nth(2).click();
  await idle(page);
  await page.getByTestId("editor-files-close-button").click();
  await expect(tiles).toHaveCount(4);
  await historyStep(page, "undo");
  await expect(tiles).toHaveCount(7);
  expect(await pdf()).toEqual(changed);
  expect(await png()).toEqual(changedPNG);
  // Undo marking, reordering, rotation, duplication, then the whole mixed import.
  for (let step = 0; step < 5; step++) await historyStep(page, "undo");
  await expect(tiles).toHaveCount(2);
  expect(await pdf()).toEqual(original);
  await page.getByTestId("editor-download-menu-button").click();
  await expect(page.getByTestId("editor-compress-button")).toHaveAttribute(
    "aria-disabled",
    "false"
  );
  await page.keyboard.press("Escape");
  await historyStep(page, "redo");
  expect(await pdf()).toEqual(added);
  for (let step = 0; step < 4; step++) await historyStep(page, "redo");
  expect(await pdf()).toEqual(changed);
  expect(await png()).toEqual(changedPNG);
});

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 568, height: 320 },
  { width: 667, height: 320 },
]) {
  test(`empty session retains visible focus and source undo at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/app");
    await page.getByTestId("editor-upload-input").setInputFiles(await source());
    await page.getByTestId("editor-document-view-button").click();
    await openFiles(page);
    await page.getByTestId("editor-file-remove").click();
    await idle(page);
    const undo = page.getByTestId("editor-undo-button");
    const redo = page.getByTestId("editor-redo-button");
    await expect(undo).toBeFocused();
    await expect(page.getByTestId("editor-pages-view-button")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    const documentButton = page.getByTestId("editor-document-view-button");
    await expect(documentButton).toHaveAttribute("aria-disabled", "true");
    await documentButton.focus();
    await page.keyboard.press("Enter");
    await expect(documentButton).toBeFocused();
    const uploader = page.getByTestId("editor-upload-dropzone");
    await uploader.scrollIntoViewIfNeeded();
    for (const control of [undo, redo, uploader]) {
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      if (!box) throw new Error("Missing empty workspace control");
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await historyStep(page, "undo");
    await expect(page.getByTestId("editor-page-tile")).toHaveCount(2);
    await expect(undo).toBeFocused();
    await historyStep(page, "redo");
    await page
      .getByTestId("editor-upload-input")
      .setInputFiles({ ...(await source()), name: "new.pdf" });
    await expect(page.getByTestId("editor-page-tile")).toHaveCount(2);
    await historyStep(page, "undo");
    await expect(uploader).toBeVisible();
    await historyStep(page, "undo");
    await expect(page.getByTestId("editor-page-tile")).toHaveCount(2);
    await expect(redo).toHaveAttribute("aria-disabled", "false");
  });
}

test("restoring an encrypted source re-prompts, cancels transactionally, and supports export after password retry", async ({
  page,
  context,
  url,
}) => {
  test.setTimeout(60_000);
  await page.goto("/app");
  const encrypted = (await encryptedFixture()).buffer;
  await page
    .getByTestId("editor-upload-input")
    .setInputFiles({ name: "protected.pdf", mimeType: "application/pdf", buffer: encrypted });
  const password = page.getByLabel("PDF password", { exact: true });
  await password.fill("623");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await idle(page);
  const reader = await context.newPage();
  await reader.goto(`${url}duplicate-test`);
  const pdf = async () => inspect(reader, await download(page, () => downloadDocument(page)));
  const original = await pdf();
  await openFiles(page);
  await page.getByTestId("editor-file-remove").click();
  await idle(page);
  await page.getByTestId("editor-undo-button").click();
  await expect(password).toBeFocused();
  await page.keyboard.press("Escape");
  await idle(page);
  await expect(page.getByTestId("editor-upload-input")).toBeAttached();
  await expect(page.getByTestId("editor-redo-button")).toHaveAttribute("aria-disabled", "true");
  await page.getByTestId("editor-undo-button").click();
  await password.fill("wrong");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(page.getByText("Incorrect password. Try again.")).toBeVisible();
  await password.fill("623");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await idle(page);
  expect(await pdf()).toEqual(original);
  await historyStep(page, "redo");
  await page.getByTestId("editor-undo-button").click();
  await expect(password).toBeFocused();
  await password.fill("623");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await idle(page);
  expect(await pdf()).toEqual(original);
});
