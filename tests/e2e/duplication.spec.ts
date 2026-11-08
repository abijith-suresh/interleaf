import { expect, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { captureDownload } from "./fixtures/download";
import type { inspectZIP } from "./fixtures/duplication";
import { inspect, source } from "./fixtures/duplication-input";
import { test } from "./fixtures/duplication-server";
import { downloadDocument, openFiles } from "./fixtures/toolbar";

async function download(page: Page, action: () => Promise<unknown>) {
  return Array.from((await captureDownload(page, action)).bytes);
}

test("copies retain independent organization, real PDF/PNG content and source removal", async ({
  page,
  context,
  url,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const input = await source();
  await page.goto("/app");
  await page.getByTestId("editor-upload-input").setInputFiles(input);
  const tiles = page.getByTestId("editor-page-tile");
  const rows = page.locator(".editor-page-grid > li");
  await page.getByRole("button", { name: "Rotate page 1 90 degrees", exact: true }).click();
  await page.getByRole("button", { name: "Mark page 1 for deletion", exact: true }).click();
  const copy = page.getByRole("button", { name: "Duplicate page 1", exact: true });
  await copy.focus();
  await page.keyboard.press("Enter");
  await expect(tiles).toHaveCount(3);
  await expect(tiles.nth(1)).toBeFocused();
  // The copy is not selected, so the next download still covers every page.
  await expect(tiles.nth(1)).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("editor-status-message")).toHaveText(
    "Duplicated page 1 as page 2."
  );
  await page.keyboard.press("Space");
  await expect(tiles.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(tiles.nth(0)).toHaveAttribute("data-marked-for-deletion", "true");
  await expect(tiles.nth(1)).toHaveAttribute("data-marked-for-deletion", "false");
  await expect(rows.nth(1).getByTestId("editor-page-canvas")).toHaveCSS("--page-rotation", "90deg");
  await page.getByTestId("editor-document-view-button").click();
  await expect(page.getByTestId("editor-viewer-title")).toHaveText("Page 2");
  await expect(page.getByTestId("editor-page-grid")).toHaveCount(0);
  const reader = await context.newPage();
  await reader.goto(`${url}duplicate-test`);
  const selected = await inspect(
    reader,
    await download(page, () => page.getByTestId("editor-extract-button").click())
  );
  expect(selected.count).toBe(1);
  expect(selected.pages[0]).toMatchObject({
    text: "Source 1",
    rotation: 180,
    libRotation: 180,
    libSize: { width: 200, height: 300 },
    size: [400, 600],
  });
  expect(selected.pages[0].ink).toBeGreaterThan(20000);
  const zip = await download(page, () =>
    page.getByTestId("editor-export-selected-images-button").click()
  );
  const pngs = await reader.evaluate(
    async (bytes): Promise<Awaited<ReturnType<typeof inspectZIP>>> => {
      const path = "/tests/e2e/fixtures/duplication.ts";
      return (await import(path)).inspectZIP(bytes);
    },
    zip
  );
  expect(pngs).toEqual([
    {
      name: "page-001.png",
      size: selected.pages[0].size,
      hash: selected.pages[0].hash,
      ink: selected.pages[0].ink,
    },
  ]);
  await page.getByTestId("editor-pages-view-button").click();
  await page.getByRole("button", { name: "Duplicate page 2", exact: true }).click();
  await page.getByRole("button", { name: "Rotate page 3 90 degrees", exact: true }).click();
  await page.getByRole("button", { name: "Mark page 3 for deletion", exact: true }).click();
  await expect(tiles.nth(1)).toHaveAttribute("data-marked-for-deletion", "false");
  await page.getByRole("button", { name: "Restore page 3", exact: true }).click();
  await tiles.nth(2).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("Alt+ArrowRight");
  await expect(tiles.nth(3)).toHaveAttribute("aria-pressed", "true");
  await expect(tiles.nth(3)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("toolbar", { name: "Selected pages" })).toHaveCount(0);
  await page.getByTestId("editor-download-menu-button").click();
  await expect(page.getByTestId("editor-compress-button")).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");
  const all = await inspect(reader, await download(page, () => downloadDocument(page)));
  expect(all.count).toBe(3);
  expect(all.pages.map((p) => [p.text, p.rotation, p.libRotation])).toEqual([
    ["Source 1", 180, 180],
    ["Source 2", 0, 0],
    ["Source 1", 270, 270],
  ]);
  expect(all.pages.map((p) => p.libSize.width)).toEqual([200, 240, 200]);
  expect(all.pages[0].hash).toBe(selected.pages[0].hash);
  expect(all.pages.every((p) => p.ink > 20000)).toBe(true);
  await openFiles(page);
  await expect(page.getByTestId("editor-file-item")).toHaveCount(1);
  await expect(page.getByTestId("editor-file-item")).toContainText("4 pages");
  await page.getByTestId("editor-file-remove").click();
  await expect(page.getByTestId("editor-upload-input")).toBeAttached();
  expect(errors).toEqual([]);
});

test("repeated form source pages keep the existing separate copyPages export baseline", async ({
  page,
  context,
  url,
}) => {
  const input = await source(true);
  const original = await PDFDocument.load(input.buffer);
  const baseline = await PDFDocument.create();
  for (let repeat = 0; repeat < 3; repeat++) {
    const [copy] = await baseline.copyPages(original, [0]);
    baseline.addPage(copy);
  }
  await page.goto("/app");
  await page.getByTestId("editor-upload-input").setInputFiles(input);
  await page.getByRole("button", { name: "Duplicate page 1", exact: true }).click();
  await page.getByRole("button", { name: "Duplicate page 2", exact: true }).click();
  await page.getByTestId("editor-undo-button").click();
  await page.getByTestId("editor-redo-button").click();
  await page.getByTestId("editor-page-tile").nth(0).click();
  await page.getByTestId("editor-page-tile").nth(1).click();
  await page.getByTestId("editor-page-tile").nth(2).click();
  const reader = await context.newPage();
  await reader.goto(`${url}duplicate-test`);
  const exported = await inspect(
    reader,
    await download(page, () => page.getByTestId("editor-extract-button").click())
  );
  const expected = await inspect(reader, Array.from(await baseline.save()));
  expect(exported).toEqual(expected);
  expect(exported.count).toBe(3);
  expect(exported.pages.every((p) => p.ink > 20000 && p.annotations.length === 1)).toBe(true);
});
