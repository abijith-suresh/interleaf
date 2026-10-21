import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { unzipSync } from "fflate";
import { degrees, PDFDocument, rgb } from "pdf-lib";

async function makePages() {
  const pdf = await PDFDocument.create();
  for (const [width, height] of [
    [20000, 20000],
    [12000, 600],
    [600, 12000],
    [600, 1200],
  ]) {
    const page = pdf.addPage([width, height]);
    page.drawRectangle({ width, height, color: rgb(0.8, 0.2, 0.1) });
  }
  pdf.getPage(3).setRotation(degrees(90));
  return Buffer.from(await pdf.save());
}

async function expectFittedPage(page: Page, width: number, height: number, budget: number) {
  const stage = page.locator(".editor-review-stage");
  let allocation: { width: number; height: number; cssWidth: number } | undefined;
  // A queued resize can start between separate readiness and canvas reads.
  // Check the complete rendered frame in one browser turn, including its pixels.
  await expect
    .poll(async () => {
      const snapshot = await stage.evaluate(
        (element, expected) => {
          const canvas = element.querySelector("canvas");
          if (!canvas) throw new Error("Missing review canvas");
          const bounds = canvas.getBoundingClientRect();
          const stageBounds = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          const availableWidth =
            element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
          const availableHeight =
            element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
          const scale = Math.min(
            1.5,
            availableWidth / expected.width,
            availableHeight / expected.height
          );
          const center = canvas
            .getContext("2d")
            ?.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
          const allocation = {
            state: element.getAttribute("data-render-state"),
            width: canvas.width,
            height: canvas.height,
            cssWidth: bounds.width,
            cssHeight: bounds.height,
            fitError: Math.max(
              Math.abs(bounds.width - expected.width * scale),
              Math.abs(bounds.height - expected.height * scale)
            ),
            left: bounds.left - stageBounds.left - parseFloat(style.paddingLeft),
            right: stageBounds.right - parseFloat(style.paddingRight) - bounds.right,
            top: bounds.top - stageBounds.top - parseFloat(style.paddingTop),
            bottom: stageBounds.bottom - parseFloat(style.paddingBottom) - bounds.bottom,
            overflowX: element.scrollWidth - element.clientWidth,
            overflowY: element.scrollHeight - element.clientHeight,
            center: center ? Array.from(center) : [],
          };
          return {
            allocation,
            checks: {
              ready: allocation.state === "ready",
              fitted: allocation.fitError < 1,
              positiveBitmap: allocation.width > 0 && allocation.height > 0,
              withinBudget: allocation.width * allocation.height <= expected.budget,
              aspectRatio:
                Math.abs(
                  allocation.cssWidth / allocation.cssHeight - expected.width / expected.height
                ) < 0.05,
              withinBounds: [
                allocation.left,
                allocation.right,
                allocation.top,
                allocation.bottom,
              ].every((distance) => distance >= -1),
              noOverflow: allocation.overflowX <= 1 && allocation.overflowY <= 1,
              redPixel: allocation.center[0] > 180,
              greenPixel: allocation.center[1] < 80,
              opaquePixel: allocation.center[3] === 255,
            },
          };
        },
        { width, height, budget }
      );
      allocation = snapshot.allocation;
      return snapshot;
    })
    .toMatchObject({
      checks: {
        ready: true,
        fitted: true,
        positiveBitmap: true,
        withinBudget: true,
        aspectRatio: true,
        withinBounds: true,
        noOverflow: true,
        redPixel: true,
        greenPixel: true,
        opaquePixel: true,
      },
    });
  if (!allocation) throw new Error("Missing review allocation sample");
  return allocation;
}

for (const scenario of [
  { name: "desktop", viewport: { width: 3000, height: 2600 }, coarse: false, budget: 16_000_000 },
  {
    name: "coarse pointer",
    viewport: { width: 1800, height: 1600 },
    coarse: true,
    budget: 4_000_000,
  },
  {
    name: "mobile fine pointer",
    viewport: { width: 390, height: 844 },
    coarse: false,
    budget: 4_000_000,
  },
]) {
  test.describe(scenario.name, () => {
    test.use({ deviceScaleFactor: 2, hasTouch: scenario.coarse, viewport: scenario.viewport });

    test("fits review pages independently of the bitmap budget and preserves exports", async ({
      page,
    }) => {
      test.setTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto("/app");
      await page.getByTestId("editor-upload-input").setInputFiles({
        name: "preview-sizes.pdf",
        mimeType: "application/pdf",
        buffer: await makePages(),
      });
      await expect(page.getByTestId("editor-page-tile")).toHaveCount(4);
      await page.getByTestId("editor-document-view-button").click();
      const first = await expectFittedPage(page, 20000, 20000, scenario.budget);
      if (scenario.name !== "mobile fine pointer") {
        expect(first.width * first.height).toBeGreaterThan(scenario.budget * 0.99);
        expect(first.cssWidth * 2).toBeGreaterThan(first.width);
      }
      expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(
        scenario.coarse
      );

      // Asymmetric fractional padding must be honored, including at an unchanged
      // outer size. Trigger the same resize path used by viewport changes.
      await page.locator(".editor-review-stage").evaluate((stage) => {
        (stage as HTMLElement).style.padding = "11.5px 27px 19.25px 13px";
        window.dispatchEvent(new Event("resize"));
      });
      await expectFittedPage(page, 20000, 20000, scenario.budget);
      await page.locator(".editor-review-stage").evaluate((stage) => {
        (stage as HTMLElement).style.removeProperty("padding");
      });

      for (const viewport of [
        { width: 320, height: 480 },
        { width: 844, height: 390 },
        { width: 667, height: 320 },
      ]) {
        await page.setViewportSize(viewport);
        for (const [index, width, height] of [
          [1, 20000, 20000],
          [2, 12000, 600],
          [3, 600, 12000],
          [4, 1200, 600],
        ]) {
          await page.getByRole("button", { name: `View page ${index}`, exact: true }).click();
          await expectFittedPage(page, width, height, scenario.budget);
        }
      }

      // Intrinsic rotation plus a workspace rotation remains the same in review,
      // PDF output and PNG output. Keep exports on the ordinary-sized last page.
      await page.getByTestId("editor-pages-view-button").click();
      await page.getByTestId("editor-page-tile").nth(3).click();
      await page.getByRole("button", { name: "Rotate page 4 90 degrees", exact: true }).click();
      await page.getByTestId("editor-document-view-button").click();
      await expectFittedPage(page, 600, 1200, scenario.budget);
      await page.getByTestId("editor-pages-view-button").click();
      const pdfDownload = page.waitForEvent("download");
      await page.getByTestId("editor-download-button").click();
      const pdfPath = await (await pdfDownload).path();
      if (!pdfPath) throw new Error("PDF download failed");
      const pdf = await PDFDocument.load(await readFile(pdfPath));
      expect(pdf.getPageCount()).toBe(1);
      expect(pdf.getPage(0).getSize()).toEqual({ width: 600, height: 1200 });
      expect(pdf.getPage(0).getRotation().angle).toBe(180);
      await page.getByTestId("editor-download-options-button").click();
      const pngDownload = page.waitForEvent("download");
      await page.getByTestId("editor-export-images-button").click();
      const pngPath = await (await pngDownload).path();
      if (!pngPath) throw new Error("PNG download failed");
      const images = Object.entries(unzipSync(await readFile(pngPath))).filter(([name]) =>
        name.endsWith(".png")
      );
      expect(images).toHaveLength(1);
      const png = Buffer.from(images[0][1]);
      expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(png.readUInt32BE(16)).toBe(1200);
      expect(png.readUInt32BE(20)).toBe(2400);
      expect(errors).toEqual([]);
    });
  });
}
