import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { unzipSync } from "fflate";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

// Enough drawing operations to exercise PDF.js's streamed operator lists, as well
// as enough pages to move thumbnails beyond the existing 200px observer margin.
async function makeReport() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < 36; index++) {
    const page = pdf.addPage(index % 2 ? [612, 792] : [792, 612]);
    page.drawText(`Quarterly report - page ${index + 1}`, { x: 30, y: 560, size: 20, font });
    for (let row = 0; row < 100; row++) {
      for (let column = 0; column < 4; column++) {
        page.drawRectangle({
          x: 30 + column * 130,
          y: 540 - row * 5,
          width: 120,
          height: 4,
          color: rgb(row % 2 ? 0.8 : 0.3, column / 4, 0.6),
        });
        page.drawText(`${index + 1}.${row + 1} Revenue forecast`, {
          x: 32 + column * 130,
          y: 540 - row * 5,
          size: 4,
          font,
        });
      }
    }
  }
  return Buffer.from(await pdf.save());
}

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test(`thumbnail release, rapid reentry, review and export at ${viewport.width}px`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/app");
    await page.getByTestId("editor-upload-input").setInputFiles({
      name: "report.pdf",
      mimeType: "application/pdf",
      buffer: await makeReport(),
    });
    const frames = page.locator('.editor-page-grid [data-testid="editor-page-canvas"]');
    const first = frames.first();
    const scroll = page.locator(".editor-page-scroll");
    await expect(frames).toHaveCount(36);
    await expect(first).toHaveAttribute("data-render-state", "ready");
    const pixels = () =>
      first.locator("canvas").evaluate((canvas: HTMLCanvasElement) => {
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Missing canvas context");
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let hash = 0;
        for (const value of data) hash = (hash * 31 + value) | 0;
        return { width: canvas.width, height: canvas.height, hash };
      });
    const original = await pixels();
    expect(original.width / original.height).toBeCloseTo(792 / 612);
    await page.getByTestId("editor-page-tile").first().click();
    await page.getByRole("button", { name: "Rotate page 1 90 degrees", exact: true }).click();
    await expect(first).toHaveCSS("--page-rotation", "90deg");

    // Traverse the whole document. Completed canvases should stop accumulating.
    await scroll.evaluate(async (root) => {
      for (let top = 0; top < root.scrollHeight; top += root.clientHeight) {
        root.scrollTop = top;
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
      root.scrollTop = root.scrollHeight;
    });
    await expect(first.locator("canvas")).toHaveAttribute("width", "0");
    await expect
      .poll(() =>
        frames.evaluateAll(
          (elements) =>
            elements.filter((frame) => (frame.querySelector("canvas")?.width ?? 0) > 0).length
        )
      )
      .toBeLessThan(18);

    // Reenter before cancellation finalization can finish, repeatedly.
    await scroll.evaluate(async (root) => {
      for (let index = 0; index < 36; index++) {
        root.scrollTop = index % 2 ? 0 : root.scrollHeight;
        await new Promise((resolve) => setTimeout(resolve, [5, 20, 50][index % 3]));
      }
      root.scrollTop = 0;
    });
    await expect(first).toHaveAttribute("data-render-state", "ready");
    expect(await pixels()).toEqual(original);
    await expect(first).toHaveCSS("--page-rotation", "90deg");
    await expect(page.getByTestId("editor-page-tile").first()).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect(page.getByTestId("editor-page-canvas-error")).toHaveCount(0);

    // Export uses source pages, including the preserved selection and rotation.
    const pdfDownload = page.waitForEvent("download");
    await page.getByTestId("editor-download-button").click();
    const pdfPath = await (await pdfDownload).path();
    if (!pdfPath) throw new Error("PDF download failed");
    const result = await PDFDocument.load(await readFile(pdfPath));
    expect(result.getPageCount()).toBe(1);
    expect(result.getPage(0).getRotation().angle).toBe(90);
    await page.getByTestId("editor-download-options-button").click();
    const pngDownload = page.waitForEvent("download");
    await page.getByTestId("editor-export-images-button").click();
    const pngPath = await (await pngDownload).path();
    if (!pngPath) throw new Error("PNG download failed");
    const archive = unzipSync(await readFile(pngPath));
    const images = Object.entries(archive).filter(([name]) => name.endsWith(".png"));
    expect(images).toHaveLength(1);
    expect([...images[0][1].slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

    // Clear selection to review the full document, including filmstrip turnover.
    await page.getByTestId("editor-page-tile").first().click();
    await page.getByTestId("editor-document-view-button").click();
    const viewer = page.getByTestId("editor-page-viewer");
    await expect(viewer.locator(".editor-review-stage")).toHaveAttribute(
      "data-render-state",
      "ready"
    );
    await page.getByRole("button", { name: "View page 2", exact: true }).click();
    await expect(page.getByTestId("editor-viewer-title")).toHaveText("Page 2");
    for (let index = 0; index < 15; index++) {
      await page.getByTestId("editor-page-viewer-next").click();
    }
    await expect(page.getByTestId("editor-viewer-title")).toHaveText("Page 17");
    await expect(viewer.locator(".editor-review-stage")).toHaveAttribute(
      "data-render-state",
      "ready"
    );
    await expect(viewer.getByRole("button", { name: "View page 17", exact: true })).toHaveAttribute(
      "aria-current",
      "page"
    );
    await expect(viewer.getByTestId("editor-page-canvas-error")).toHaveCount(0);
    await page.getByTestId("editor-page-viewer-previous").click();
    await expect(page.getByTestId("editor-viewer-title")).toHaveText("Page 16");
    await page.getByTestId("editor-pages-view-button").click();
    await expect(viewer).toHaveCount(0);
    await expect(first).toHaveAttribute("data-render-state", "ready");
    expect(errors).toEqual([]);
  });
}
