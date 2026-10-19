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

test("copies retain independent organization, real PDF/PNG content and source removal", async ({
  page,
  context,
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
  await expect(tiles.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(tiles.nth(0)).toHaveAttribute("data-marked-for-deletion", "true");
  await expect(tiles.nth(1)).toHaveAttribute("data-marked-for-deletion", "false");
  await expect(rows.nth(1).getByTestId("editor-page-canvas")).toHaveCSS("--page-rotation", "90deg");
  await page.getByTestId("editor-document-view-button").click();
  await expect(page.getByTestId("editor-viewer-title")).toHaveText("Page 2");
  await expect(
    page.getByRole("button", { name: /Duplicate page|Rotate page|Mark page/ })
  ).toHaveCount(0);
  const reader = await context.newPage();
  await reader.goto(`${url}duplicate-test`);
  const selected = await inspect(
    reader,
    await download(page, () => page.getByTestId("editor-download-button").click())
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
  await page.getByTestId("editor-download-options-button").click();
  const zip = await download(page, () => page.getByTestId("editor-export-images-button").click());
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
  await page.getByRole("button", { name: "Restore page 3 from deletion", exact: true }).click();
  await tiles.nth(2).focus();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(tiles.nth(3)).toHaveAttribute("aria-pressed", "true");
  await tiles.nth(3).focus();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("editor-selection-title")).toHaveText("All 3 exportable");
  await page.getByTestId("editor-download-options-button").click();
  await expect(page.getByTestId("editor-compress-button")).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");
  const all = await inspect(
    reader,
    await download(page, () => page.getByTestId("editor-download-button").click())
  );
  expect(all.count).toBe(3);
  expect(all.pages.map((p) => [p.text, p.rotation, p.libRotation])).toEqual([
    ["Source 1", 180, 180],
    ["Source 2", 0, 0],
    ["Source 1", 270, 270],
  ]);
  expect(all.pages.map((p) => p.libSize.width)).toEqual([200, 240, 200]);
  expect(all.pages[0].hash).toBe(selected.pages[0].hash);
  expect(all.pages.every((p) => p.ink > 20000)).toBe(true);
  await page.getByTestId("editor-files-button").click();
  await expect(page.getByTestId("editor-file-item")).toHaveCount(1);
  await expect(page.getByTestId("editor-file-item")).toContainText("4 pages");
  await page.getByTestId("editor-file-remove").click();
  await expect(page.getByTestId("editor-upload-input")).toBeAttached();
  expect(errors).toEqual([]);
});

test("repeated form source pages keep the existing separate copyPages export baseline", async ({
  page,
  context,
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
  await page.getByTestId("editor-page-tile").nth(0).click();
  await page.getByTestId("editor-page-tile").nth(1).click();
  const reader = await context.newPage();
  await reader.goto(`${url}duplicate-test`);
  const exported = await inspect(
    reader,
    await download(page, () => page.getByTestId("editor-download-button").click())
  );
  const expected = await inspect(reader, Array.from(await baseline.save()));
  expect(exported).toEqual(expected);
  expect(exported.count).toBe(3);
  expect(exported.pages.every((p) => p.ink > 20000 && p.annotations.length === 1)).toBe(true);
});
