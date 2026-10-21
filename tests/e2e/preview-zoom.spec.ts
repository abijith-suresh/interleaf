import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { unzipSync } from "fflate";
import { degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib";

async function makeDocument() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 3; i++) {
    const page = pdf.addPage([600, 800]);
    page.drawRectangle({ width: 600, height: 800, color: rgb(0.98, 0.97, 0.94) });
    page.drawText(`Report page ${i + 1}`, { x: 36, y: 745, size: 24, font });
    for (let line = 0; line < 28; line++) {
      page.drawText(`Line ${line + 1}. Read the page details at any preview zoom.`, {
        x: 36,
        y: 700 - line * 22,
        size: 12,
        font,
      });
    }
    // Colored corners let a synchronous sample verify actual pixels and identity.
    page.drawRectangle({
      x: 0,
      y: 0,
      width: 24,
      height: 24,
      color: rgb(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0),
    });
  }
  pdf.getPage(1).setRotation(degrees(90));
  return Buffer.from(await pdf.save());
}

async function ready(page: Page, zoom: number, index = 1) {
  await expect
    .poll(() =>
      page.locator(".editor-review-stage").evaluate(
        (stage, expected) => {
          const canvas = stage.querySelector("canvas");
          if (!canvas?.width || !canvas.height) return false;
          const rect = canvas.getBoundingClientRect();
          const pixels = canvas
            .getContext("2d")
            ?.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
          const budget =
            innerWidth <= 700 || matchMedia("(pointer: coarse)").matches ? 4_000_000 : 16_000_000;
          return (
            stage.getAttribute("data-render-state") === "ready" &&
            Number(stage.getAttribute("data-zoom")) === expected.zoom &&
            document.querySelector("#editor-review-title")?.textContent ===
              `Page ${expected.index}` &&
            rect.width > 0 &&
            rect.height > 0 &&
            canvas.width * canvas.height <= budget &&
            pixels?.[3] === 255
          );
        },
        { zoom, index }
      )
    )
    .toBe(true);
}

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
  { width: 320, height: 480 },
  { width: 667, height: 320 },
]) {
  test(`zoom, pan, fit, navigation and exact exports at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/app");
    await page.getByTestId("editor-upload-input").setInputFiles({
      name: "report.pdf",
      mimeType: "application/pdf",
      buffer: await makeDocument(),
    });
    await expect(page.getByTestId("editor-page-tile")).toHaveCount(3);
    // Review/export selection must survive view-only gestures.
    await page.getByTestId("editor-page-tile").nth(1).click();
    await page.getByTestId("editor-document-view-button").click();
    await ready(page, 1, 2);
    const stage = page.locator(".editor-review-stage");
    const fit = await page.locator(".editor-review-canvas").boundingBox();
    if (!fit) throw new Error("Missing fit bounds");
    for (const name of ["Zoom in", "Zoom out", "Fit page", "Pages"]) {
      const bounds = await page.getByRole("button", { name, exact: true }).boundingBox();
      if (!bounds) throw new Error(`Missing ${name}`);
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    }
    const zoomIn = page.getByRole("button", { name: "Zoom in", exact: true });
    await zoomIn.focus();
    await page.keyboard.press("Enter");
    for (let i = 0; i < 4; i++) await zoomIn.click();
    await ready(page, 4, 2);
    await expect(zoomIn).toBeDisabled();
    const enlarged = await page.locator(".editor-review-canvas").boundingBox();
    expect(enlarged?.width).toBeCloseTo(fit.width * 4, 0);
    expect(enlarged?.height).toBeCloseTo(fit.height * 4, 0);

    // Real mouse input exercises capture outside the page and stage, then release.
    const box = await stage.boundingBox();
    if (!box) throw new Error("Missing stage");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(0, 0, { steps: 4 });
    await page.mouse.up();
    await expect(stage).not.toHaveClass(/is-panning/);
    await expect(page.getByRole("heading", { name: "Page 2", exact: true })).toBeVisible();
    await stage.focus();
    await page.keyboard.press("End");
    const end = await stage.evaluate((el) => ({
      x: el.scrollLeft,
      y: el.scrollTop,
      maxX: el.scrollWidth - el.clientWidth,
      maxY: el.scrollHeight - el.clientHeight,
    }));
    expect(Math.abs(end.x - end.maxX)).toBeLessThanOrEqual(1);
    expect(Math.abs(end.y - end.maxY)).toBeLessThanOrEqual(1);
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown");
    await expect(stage).toHaveCSS("outline-color", "rgb(36, 36, 33)");
    await expect(page.getByRole("heading", { name: "Page 2", exact: true })).toBeVisible();
    await expect.poll(() => stage.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    // Modified browser shortcuts must not be consumed by the dialog.
    expect(
      await stage.evaluate((el) => {
        const event = new KeyboardEvent("keydown", {
          key: "+",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        });
        el.dispatchEvent(event);
        return event.defaultPrevented;
      })
    ).toBe(false);
    await page.getByRole("button", { name: "Zoom out", exact: true }).click();
    await expect(stage).toHaveAttribute("data-zoom", String(4 / 1.4));
    await page.getByRole("button", { name: "Fit page", exact: true }).click();
    await ready(page, 1, 2);
    expect(
      await stage.evaluate((el) => [
        el.scrollLeft,
        el.scrollTop,
        el.scrollWidth - el.clientWidth,
        el.scrollHeight - el.clientHeight,
      ])
    ).toEqual([0, 0, 0, 0]);
    await zoomIn.click();
    await page.setViewportSize({ width: viewport.width + 1, height: viewport.height });
    await ready(page, 1, 2);
    await zoomIn.click();
    // A same-size resize must reset too, without a stale sharper completion.
    await stage.evaluate(() => window.dispatchEvent(new Event("resize")));
    await ready(page, 1, 2);
    await page.getByTestId("editor-pages-view-button").click();
    await expect(page.getByTestId("editor-pages-view-button")).toBeFocused();
    await page.getByRole("button", { name: "Rotate page 2 90 degrees", exact: true }).click();
    await page.getByTestId("editor-document-view-button").click();
    await ready(page, 1, 2);
    // Download directly in Document with the original selection intact.

    const pdfDownload = page.waitForEvent("download");
    await page.getByTestId("editor-download-button").click();
    const pdfPath = await (await pdfDownload).path();
    if (!pdfPath) throw new Error("Missing PDF download");
    const pdf = await PDFDocument.load(await readFile(pdfPath));
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getRotation().angle).toBe(180);
    expect(pdf.getPage(0).getSize()).toEqual({ width: 600, height: 800 });
    await page.getByTestId("editor-download-options-button").click();
    const pngDownload = page.waitForEvent("download");
    await page.getByTestId("editor-export-images-button").click();
    const pngPath = await (await pngDownload).path();
    if (!pngPath) throw new Error("Missing PNG download");
    const images = Object.entries(unzipSync(await readFile(pngPath))).filter(([name]) =>
      name.endsWith(".png")
    );
    expect(images).toHaveLength(1);
    const png = Buffer.from(images[0][1]);
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(1600);
    const corner = await page.evaluate(
      async (bytes) => {
        const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
        try {
          const image = new Image();
          image.src = url;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Missing PNG inspection context");
          context.drawImage(image, 0, 0);
          const pixel = Array.from(context.getImageData(canvas.width - 11, 10, 1, 1).data);
          canvas.width = canvas.height = 0;
          return pixel;
        } finally {
          URL.revokeObjectURL(url);
        }
      },
      [...png]
    );
    // Only selected source page 2 has this green corner, now rotated 180°.
    expect(corner).toEqual([0, 255, 0, 255]);
    expect(errors).toEqual([]);
  });
}

test.describe("touch preview", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test("pinch, single-finger pan, cancellation and capture loss retain a complete frame", async ({
    page,
    browserName,
  }) => {
    await page.goto("/app");
    await page.getByTestId("editor-upload-input").setInputFiles({
      name: "touch-report.pdf",
      mimeType: "application/pdf",
      buffer: await makeDocument(),
    });
    await page.getByTestId("editor-document-view-button").click();
    await ready(page, 1);
    const stage = page.locator(".editor-review-stage");
    const box = await stage.boundingBox();
    if (!box) throw new Error("Missing touch stage");
    const y = box.y + box.height / 2;
    const bitmap = await stage.evaluate((el) => {
      const c = el.querySelector("canvas");
      return [c?.width, c?.height];
    });
    // Chromium exposes real multi-touch through CDP. Playwright's other browser
    // protocols only expose taps; replay the same pointer stream there.
    const cdp = browserName === "chromium" ? await page.context().newCDPSession(page) : null;
    async function touches(
      type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel",
      points: { id: number; x: number; y: number }[]
    ) {
      if (cdp) {
        await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
        return;
      }
      await stage.evaluate(
        (el, input) => {
          const target = el as HTMLElement & {
            testTouches?: Map<number, { x: number; y: number }>;
          };
          if (!target.testTouches) {
            target.testTouches = new Map();
            // Untrusted events cannot acquire native capture. Real mouse coverage
            // above exercises capture; these events exercise touch state transitions.
            target.setPointerCapture = () => {};
          }
          const next =
            input.type === "touchCancel"
              ? new Map<number, { x: number; y: number }>()
              : input.type === "touchEnd"
                ? new Map(
                    [...target.testTouches].filter(
                      ([id]) => !input.points.some((point) => point.id === id)
                    )
                  )
                : new Map(input.points.map((point) => [point.id, point]));
          for (const [id, point] of target.testTouches) {
            if (!next.has(id))
              target.dispatchEvent(
                new PointerEvent(input.type === "touchCancel" ? "pointercancel" : "pointerup", {
                  pointerId: id,
                  pointerType: "touch",
                  clientX: point.x,
                  clientY: point.y,
                  bubbles: true,
                  cancelable: true,
                })
              );
          }
          for (const [id, point] of next) {
            target.dispatchEvent(
              new PointerEvent(target.testTouches.has(id) ? "pointermove" : "pointerdown", {
                pointerId: id,
                pointerType: "touch",
                clientX: point.x,
                clientY: point.y,
                button: 0,
                bubbles: true,
                cancelable: true,
              })
            );
          }
          target.testTouches = next;
        },
        { type, points }
      );
    }
    await touches("touchStart", [
      { id: 1, x: 140, y },
      { id: 2, x: 240, y },
    ]);
    await touches("touchMove", [
      { id: 1, x: 70, y },
      { id: 2, x: 310, y },
    ]);
    await expect.poll(() => stage.getAttribute("data-zoom").then(Number)).toBeGreaterThan(2);
    expect(
      await stage.evaluate((el) => {
        const c = el.querySelector("canvas");
        return [c?.width, c?.height];
      })
    ).toEqual(bitmap);
    await touches("touchEnd", [{ id: 2, x: 310, y }]);
    const before = await stage.evaluate((el) => el.scrollTop);
    await touches("touchMove", [{ id: 1, x: 70, y: y - 80 }]);
    await expect.poll(() => stage.evaluate((el) => el.scrollTop)).toBeGreaterThan(before);
    await touches("touchCancel", []);
    await expect(stage).not.toHaveClass(/is-panning/);
    const settledZoom = Number(await stage.getAttribute("data-zoom"));
    await ready(page, settledZoom);
    // An unexpected native capture loss terminates every remaining pointer.
    await stage.evaluate((el) => {
      const id = (el as HTMLElement & { testTouches?: Map<number, unknown> }).testTouches ? 7 : 1;
      (el as HTMLElement).setPointerCapture = () => {};
      el.dispatchEvent(
        new PointerEvent("pointerdown", {
          pointerId: id,
          pointerType: "touch",
          button: 0,
          clientX: 100,
          clientY: 200,
          bubbles: true,
        })
      );
      el.dispatchEvent(new PointerEvent("lostpointercapture", { pointerId: id, bubbles: true }));
      el.dispatchEvent(
        new PointerEvent("pointermove", { pointerId: id, clientX: 0, clientY: 0, bubbles: true })
      );
    });
    await expect(stage).not.toHaveClass(/is-panning/);
    await page.getByTestId("editor-page-viewer-next").click();
    await ready(page, 1, 2);
    await expect(stage).not.toHaveClass(/is-panning/);
    await page.getByRole("button", { name: "Zoom in", exact: true }).tap();
    await ready(page, 1.4, 2);
    await page.getByRole("button", { name: "Fit page", exact: true }).tap();
    await ready(page, 1, 2);
    expect(await stage.evaluate((el) => [el.scrollLeft, el.scrollTop])).toEqual([0, 0]);
    await cdp?.detach();
  });
});

test("zoom limits retain Fit focus and workspace navigation for keyboard and pointer actions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await page.goto("/app");
  await page.getByTestId("editor-upload-input").setInputFiles({
    name: "focus-report.pdf",
    mimeType: "application/pdf",
    buffer: await makeDocument(),
  });
  for (const action of ["Zoom in", "Zoom out"]) {
    for (const input of ["keyboard", "pointer"]) {
      await test.step(`${input} ${action} limit`, async () => {
        await page.getByTestId("editor-document-view-button").click();
        await ready(page, 1);
        const fit = page.getByRole("button", { name: "Fit page", exact: true });
        const zoomIn = page.getByRole("button", { name: "Zoom in", exact: true });
        const zoomOut = page.getByRole("button", { name: "Zoom out", exact: true });
        if (action === "Zoom out") {
          await zoomIn.click();
          await zoomOut.focus();
        } else {
          await fit.focus();
          await page.keyboard.press("Tab");
          await expect(zoomIn).toBeFocused();
        }
        const button = action === "Zoom in" ? zoomIn : zoomOut;
        for (let i = 0; i < (action === "Zoom in" ? 5 : 1); i++) {
          if (input === "keyboard") await page.keyboard.press("Enter");
          else await button.click();
        }
        await expect(button).toBeDisabled();
        await expect(fit).toBeFocused();
        // Tab follows the normal workspace after the focused action becomes disabled.
        await page.keyboard.press("Tab");
        await expect(
          action === "Zoom in"
            ? page.getByRole("region", { name: "Page preview, use arrow keys to pan" })
            : zoomIn
        ).toBeFocused();
        await page.keyboard.press("Shift+Tab");
        await expect(fit).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(page.getByTestId("editor-page-viewer")).toBeVisible();
        await expect(fit).toBeFocused();
        await page.getByTestId("editor-pages-view-button").click();
        await expect(page.getByTestId("editor-page-viewer")).toHaveCount(0);
        await expect(page.getByTestId("editor-pages-view-button")).toBeFocused();
      });
    }
  }
});
