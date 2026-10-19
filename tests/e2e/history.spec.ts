import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { createServer, type ViteDevServer } from "vite";
import type { inspectPDF, inspectZIP } from "./fixtures/duplication";

let server: ViteDevServer;
let url: string;
test.beforeAll(async () => {
  server = await createServer({
    configFile: false,
    cacheDir: `node_modules/.vite-duplication/${test.info().project.name}`,
    plugins: [
      {
        name: "duplication-fixture",
        configureServer(server) {
          server.middlewares.use("/duplicate-test", (_request, response) => {
            response.setHeader("Content-Type", "text/html");
            response.end("<!doctype html><title>Duplication export inspection</title>");
          });
        },
      },
    ],
    server: { host: "127.0.0.1", port: 0 },
    optimizeDeps: { include: ["pdfjs-dist", "pdf-lib", "fflate"] },
  });
  await server.listen();
  url = server.resolvedUrls?.local[0] ?? "";
});
test.afterAll(async () => {
  await server?.close();
});

async function download(page: Page, action: () => Promise<unknown>) {
  const pending = page.waitForEvent("download");
  await action();
  const path = await (await pending).path();
  if (!path) throw new Error("Missing download");
  return Array.from(await readFile(path));
}
async function inspect(reader: Page, bytes: number[]) {
  return reader.evaluate(async (bytes): Promise<Awaited<ReturnType<typeof inspectPDF>>> => {
    const path = "/tests/e2e/fixtures/duplication.ts";
    return (await import(path)).inspectPDF(bytes);
  }, bytes);
}
async function source(form = false) {
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

test("mixed history restores real PDF order, rotations, text, selected PNG pixels and compression", async ({
  page,
  context,
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
  const pdf = () => download(page, () => page.getByTestId("editor-download-button").click());
  const original = await inspect(reader, await pdf());
  await page.getByRole("button", { name: "Rotate page 1 90 degrees", exact: true }).click();
  await page.getByRole("button", { name: "Duplicate page 1", exact: true }).click();
  await expect(tiles.nth(1)).toBeFocused();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(tiles.nth(2)).toBeFocused();
  await tiles.nth(1).click();
  for (const id of ["editor-rotate-button", "editor-delete-button", "editor-delete-button"]) {
    await page.getByTestId("editor-edit-menu-button").click();
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
    await page.getByTestId("editor-download-options-button").click();
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
  await expect(page.getByTestId("editor-selection-title")).toHaveText("All 2 exportable");
  expect(await inspect(reader, await pdf())).toEqual(original);
  await page.getByTestId("editor-download-options-button").click();
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
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    }
    const sidebar = await page.locator(".editor-sidebar").boundingBox();
    const exit = await page.getByRole("link", { name: "Return to Interleaf home" }).boundingBox();
    if (!sidebar || !exit) throw new Error("Missing workspace navigation");
    expect(exit.x).toBeGreaterThanOrEqual(sidebar.x);
    expect(exit.x + exit.width).toBeLessThanOrEqual(sidebar.x + sidebar.width);
    expect(exit.y + exit.height).toBeLessThanOrEqual(viewport.height);
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
  await undo.click();
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
  await page.getByRole("button", { name: "Duplicate page 1", exact: true }).click();
  await page.getByTestId("editor-document-view-button").click();
  const filmstrip = page.getByRole("navigation", { name: "Document pages" });
  await filmstrip.getByRole("button", { name: "View page 2", exact: true }).focus();
  await page.keyboard.press("Control+z");
  await expect(filmstrip.getByRole("button", { name: "View page 1", exact: true })).toBeFocused();
  await page.keyboard.press("Control+Shift+z");
  await expect(page.getByTestId("editor-viewer-title")).toHaveText("Page 2");
  await expect(filmstrip.getByRole("button", { name: "View page 2", exact: true })).toHaveAttribute(
    "aria-current",
    "page"
  );
  await page.getByTestId("editor-undo-button").click();
  const next = page.getByTestId("editor-page-viewer-next");
  await next.focus();
  await page.keyboard.press("Control+y");
  await expect(next).toBeDisabled();
  await expect(filmstrip.getByRole("button", { name: "View page 2", exact: true })).toBeFocused();
});

test("text controls, open menus, dialogs and failed imports preserve history; source commits reset it", async ({
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
  await page.getByTestId("editor-edit-menu-button").click();
  await page.keyboard.press("Control+z");
  await expect(undo).toHaveAttribute("aria-disabled", "false");
  await page.keyboard.press("Escape");
  await page.getByTestId("editor-files-button").click();
  await page.keyboard.press("Control+z");
  await expect(undo).toHaveAttribute("aria-disabled", "true");
  await page.getByTestId("editor-files-close-button").click();
  await expect(undo).toHaveAttribute("aria-disabled", "false");
  await undo.click();
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
  await expect(page.getByTestId("editor-status-message")).toContainText(
    "Page organization history reset."
  );
  await page.getByRole("button", { name: "Duplicate page 1", exact: true }).click();
  await page.getByTestId("editor-files-button").click();
  await page.getByTestId("editor-file-remove").nth(0).click();
  await page.getByTestId("editor-files-close-button").click();
  await expect(page.getByTestId("editor-page-tile")).toHaveCount(2);
  await expect(undo).toHaveAttribute("aria-disabled", "true");
  await page.getByTestId("editor-files-button").click();
  await page.getByTestId("editor-file-remove").click();
  await expect(page.getByTestId("editor-upload-input")).toBeAttached();
  await page.getByTestId("editor-upload-input").setInputFiles(await source());
  await expect(undo).toHaveAttribute("aria-disabled", "true");
  await expect(redo).toHaveAttribute("aria-disabled", "true");
});
