import { expect, type Page, test } from "@playwright/test";
import { degrees, PDFDocument, PDFName, PDFNumber, StandardFonts } from "pdf-lib";

async function source() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([400, 600]);
  page.setMediaBox(-40, -60, 400, 600);
  page.setCropBox(-20, 40, 300, 400);
  page.node.set(PDFName.of("UserUnit"), PDFNumber.of(1.5));
  page.setRotation(degrees(90));
  page.drawText("Original text", { x: 20, y: 400, size: 18, font });
  const field = document.getForm().createTextField("original-field");
  field.setText("Original field");
  field.addToPage(page, { x: 20, y: 340, width: 160, height: 24, font });
  document.addPage([300, 400]);
  return {
    name: "text.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await document.save()),
  };
}
async function open(page: Page) {
  await page.goto("/app");
  await page.getByTestId("editor-upload-input").setInputFiles(await source());
  await page.getByTestId("editor-document-view-button").click();
  await ready(page);
}
async function ready(page: Page) {
  await expect(page.locator(".editor-review-stage")).toHaveAttribute("data-render-state", "ready");
}
async function point(page: Page, x = 0.35, y = 0.55) {
  const frame = await page.locator(".editor-review-page").boundingBox();
  if (!frame) throw new Error("Missing page frame");
  return { x: frame.x + frame.width * x, y: frame.y + frame.height * y };
}
async function place(page: Page, text = "Added text") {
  const disclosure = page.getByRole("button", { name: "Text tools", exact: true });
  if (await disclosure.isVisible()) await disclosure.click();
  await page.getByRole("button", { name: "Add text", exact: true }).click();
  // Geometry is measured independently of bitmap rendering.
  await expect(page.locator(".editor-text-layer")).toHaveAttribute("data-geometry-ready", "true");
  const p = await point(page);
  await page.mouse.click(p.x, p.y);
  await page.getByLabel("Added text", { exact: true }).fill(text);
  await page.getByRole("button", { name: "Save text", exact: true }).click();
  await expect(page.getByLabel("Added text", { exact: true })).toHaveCount(0);
  await ready(page);
}

for (const [width, height] of [
  [667, 320],
  [320, 667],
  [390, 844],
]) {
  test(`keyboard movement keeps the draft visible at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await open(page);
    const disclosure = page.getByRole("button", { name: "Text tools", exact: true });
    await disclosure.click();
    await page.getByRole("button", { name: "Add text", exact: true }).press("Enter");
    await expect(page.locator(".editor-text-layer")).toHaveAttribute("data-geometry-ready", "true");
    await page.keyboard.press("Enter");
    const input = page.getByLabel("Added text", { exact: true });
    await expect(input).toBeFocused();
    await input.fill("Landscape move");
    await expect(disclosure).toHaveAttribute("aria-expanded", "true");
    // Follow the actual reverse tab order from the input through the toolbar.
    for (let step = 0; step < 4; step++) await page.keyboard.press("Shift+Tab");
    const draft = page.getByRole("button", { name: "Drag text to move it" });
    await expect(draft).toBeFocused();
    const unobscured = () =>
      draft.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return box.width > 0 && box.height > 0 && (top === element || element.contains(top));
      });
    await expect.poll(unobscured).toBe(true);
    await expect(disclosure).toHaveAttribute("aria-expanded", "false");
    const before = await draft.evaluate((element) => parseFloat(element.style.left));
    await page.keyboard.press("Shift+ArrowRight");
    expect(await draft.evaluate((element) => parseFloat(element.style.left))).toBeGreaterThan(
      before
    );
    await expect(draft).toBeFocused();
    await expect.poll(unobscured).toBe(true);
    await page.keyboard.press("Enter");
    await expect(input).toBeFocused();
    await expect(disclosure).toHaveAttribute("aria-expanded", "true");
    await expect
      .poll(() =>
        input.evaluate((element) => {
          const box = element.getBoundingClientRect();
          return (
            document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === element
          );
        })
      )
      .toBe(true);
  });
}

for (const width of [1280, 390]) {
  test(`text completion and validation keep logical keyboard focus at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await open(page);
    await place(page, "Focus");
    const hit = page.getByRole("button", { name: "Edit added text: Focus", exact: true });
    await expect(hit).toBeFocused();
    if (width === 1280) {
      await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: "Read", exact: true })).toBeFocused();
    }
    const input = page.getByLabel("Added text", { exact: true });
    for (const action of ["Cancel", "Escape", "Save text"]) {
      await hit.press("Enter");
      await expect(input).toBeFocused();
      if (action === "Escape") await input.press("Escape");
      else await page.getByRole("button", { name: action, exact: true }).press("Enter");
      await expect(hit).toBeFocused();
    }
    await hit.press("Enter");
    await input.fill("Café");
    await input.press("Enter");
    await expect(page.getByRole("alert")).toContainText("basic Latin");
    await expect(input).toBeFocused();
    await input.fill("Focus");
    await page.getByRole("button", { name: "Delete added text" }).press("Enter");
    const fallback =
      width === 390
        ? page.getByRole("button", { name: "Text tools", exact: true })
        : page.getByRole("button", { name: "Add text", exact: true });
    await expect(fallback).toBeFocused();
  });

  test(`keyboard text placement and movement at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await open(page);
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await ready(page);
    const stage = page.locator(".editor-review-stage");
    await stage.press("ArrowRight");
    await stage.press("ArrowDown");
    const disclosure = page.getByRole("button", { name: "Text tools", exact: true });
    if (await disclosure.isVisible()) await disclosure.click();
    await page.getByRole("button", { name: "Add text", exact: true }).press("Enter");
    await expect(stage).toBeFocused();
    await expect(page.locator(".editor-text-layer")).toHaveAttribute("data-geometry-ready", "true");
    const center = await stage.evaluate((element) => {
      const view = element.getBoundingClientRect();
      const box = element.querySelector(".editor-text-layer")!.getBoundingClientRect();
      // Compare CSS percentages after the browser's own numeric serialization.
      const style = document.createElement("div").style;
      style.left = `${(100 * ((Math.max(box.left, view.left) + Math.min(box.right, view.right)) / 2 - box.left)) / box.width}%`;
      style.top = `${(100 * ((Math.max(box.top, view.top) + Math.min(box.bottom, view.bottom)) / 2 - box.top)) / box.height}%`;
      return [parseFloat(style.left), parseFloat(style.top)];
    });
    await stage.press(width === 390 ? "Enter" : "Space");
    const input = page.getByLabel("Added text", { exact: true });
    await expect(input).toBeFocused();
    await input.fill("Keyboard");
    const draft = page.getByRole("button", { name: "Drag text to move it" });
    await draft.focus();
    const before = await draft.evaluate((element) => [
      parseFloat(element.style.left),
      parseFloat(element.style.top),
    ]);
    expect(before).toEqual(center);
    await draft.press("ArrowRight");
    await draft.press("Shift+ArrowDown");
    const after = await draft.evaluate((element) => [
      parseFloat(element.style.left),
      parseFloat(element.style.top),
    ]);
    expect(after[0]).toBeGreaterThan(before[0]);
    expect(after[1]).toBeGreaterThan(before[1]);
    await draft.press("Enter");
    await expect(input).toBeFocused();
    await input.press("Enter");
    const hit = page.getByRole("button", { name: "Edit added text: Keyboard", exact: true });
    await expect(hit).toBeFocused();
    await hit.press("Enter");
    await input.fill("Cancelled");
    await draft.focus();
    await draft.press("Escape");
    await expect(hit).toBeFocused();
    await page.keyboard.press("Control+z");
    await expect(hit).toHaveCount(0);
  });
}

test("point placement, validation, editing, movement, rotation and history retain independent copies", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  const read = page.getByRole("button", { name: "Read", exact: true });
  const selectionColor = await read.evaluate(
    (element) => getComputedStyle(element).backgroundColor
  );
  await read.hover();
  await expect(read).toHaveCSS("background-color", selectionColor);
  await place(page, "Added 123");
  await expect
    .poll(() =>
      page
        .locator(".editor-review-filmstrip-item")
        .first()
        .evaluate((item) => {
          const container = item.querySelector(".canvas-container");
          const canvas = item.querySelector("canvas");
          const stage = item.querySelector(".canvas-stage");
          if (!canvas?.width || !canvas.height || !stage) return false;
          const frame = stage.getBoundingClientRect();
          const bitmap = canvas.getBoundingClientRect();
          const pixel = canvas
            .getContext("2d")
            ?.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
          return (
            container?.getAttribute("data-render-state") === "ready" &&
            frame.width > 0 &&
            frame.height > 0 &&
            Math.abs(bitmap.width - frame.width) < 1 &&
            Math.abs(bitmap.height - frame.height) < 1 &&
            pixel?.[3] === 255
          );
        })
    )
    .toBe(true);
  const hit = page.getByRole("button", { name: "Edit added text: Added 123", exact: true });
  await expect(hit).toBeVisible();
  await expect(page.getByTestId("editor-undo-button")).toHaveAttribute(
    "aria-label",
    "Undo Add text"
  );
  await hit.click();
  const input = page.getByLabel("Added text", { exact: true });
  const paste = await input.evaluate((element) => {
    if (!(element instanceof HTMLInputElement)) throw new Error("Missing text input");
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { getData: () => "Two\nlines" } });
    element.dispatchEvent(event);
    return { prevented: event.defaultPrevented, value: element.value };
  });
  expect(paste).toEqual({ prevented: true, value: "Added 123" });
  await expect(page.getByRole("alert")).toContainText("Use one line");
  await input.fill("Café");
  await page.getByRole("button", { name: "Save text", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("basic Latin");
  await input.fill("Changed");
  await page.getByLabel("Text size in points").fill("24");
  await page.getByRole("button", { name: "Rotate text 90 degrees" }).click();
  await page.getByRole("button", { name: "Text settings" }).click();
  await ready(page);
  const draft = page.getByRole("button", { name: "Drag text to move it" });
  const before = await draft.boundingBox();
  if (!before) throw new Error("Missing draft");
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 25, before.y + before.height / 2 + 15, {
    steps: 4,
  });
  await page.mouse.up();
  const after = await draft.boundingBox();
  expect(after?.x).toBeCloseTo(before.x + 25, 0);
  expect(after?.y).toBeCloseTo(before.y + 15, 0);
  // Resizing cancels an unfinished drag without discarding the typed draft.
  const savedPosition = await draft.evaluate((element) => [element.style.left, element.style.top]);
  if (!after) throw new Error("Missing moved draft");
  await page.mouse.move(after.x + after.width / 2, after.y + after.height / 2);
  await page.mouse.down();
  await page.mouse.move(after.x + after.width / 2 + 15, after.y + after.height / 2 + 10);
  await page.setViewportSize({ width: 1260, height: 780 });
  await expect
    .poll(() => draft.evaluate((element) => [element.style.left, element.style.top]))
    .toEqual(savedPosition);
  await page.mouse.up();
  await ready(page);
  await page.getByRole("button", { name: "Text settings" }).click();
  await page.getByRole("button", { name: "Save text", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit added text: Changed", exact: true })
  ).toBeVisible();
  await page.getByTestId("editor-undo-button").click();
  await expect(hit).toBeVisible();
  await page.getByTestId("editor-redo-button").click();
  await expect(
    page.getByRole("button", { name: "Edit added text: Changed", exact: true })
  ).toBeVisible();
  await page.getByTestId("editor-pages-view-button").click();
  await page.getByRole("button", { name: "Duplicate page 1", exact: true }).click();
  await page.getByTestId("editor-document-view-button").click();
  await page.getByRole("button", { name: "Select added text" }).click();
  await page.getByRole("button", { name: "Edit added text: Changed", exact: true }).click();
  await page.getByLabel("Added text", { exact: true }).fill("Copy");
  await page.getByRole("button", { name: "Save text", exact: true }).click();
  // Duplication selects the copy. Clear the scope to navigate to the original.
  await page.getByTestId("editor-pages-view-button").click();
  await page.getByRole("button", { name: "Page 2", exact: true }).click();
  await page.getByTestId("editor-document-view-button").click();
  await page.getByRole("button", { name: "Previous page", exact: true }).click();
  await expect(page.getByTestId("editor-viewer-title")).toHaveText("Page 1");
  await page.getByRole("button", { name: "Select added text" }).click();
  await expect(
    page.getByRole("button", { name: "Edit added text: Changed", exact: true })
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("cancel, deletion, compression after undo, source restoration, and input shortcut ownership", async ({
  page,
}) => {
  await open(page);
  await place(page);
  await page.getByRole("button", { name: "Edit added text: Added text", exact: true }).click();
  const input = page.getByLabel("Added text", { exact: true });
  await input.fill("Unsaved");
  await input.press("Control+z");
  await expect(page.getByTestId("editor-undo-button")).toHaveAttribute(
    "aria-label",
    "Undo Add text"
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit added text: Added text", exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "More download options" }).click();
  await expect(page.getByRole("menuitem", { name: /Compress/ })).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.getByTestId("editor-undo-button").click();
  await page.getByRole("button", { name: "More download options" }).click();
  await expect(page.getByRole("menuitem", { name: /Compress/ })).toBeEnabled();
  await page.keyboard.press("Escape");
  await page.getByTestId("editor-redo-button").click();
  await page.getByRole("button", { name: "Select added text" }).click();
  await page.getByRole("button", { name: "Edit added text: Added text", exact: true }).click();
  await page.getByRole("button", { name: "Delete added text" }).click();
  await expect(page.getByRole("button", { name: /Edit added text:/ })).toHaveCount(0);
  await page.getByTestId("editor-undo-button").click();
  await page.getByRole("button", { name: "Select added text" }).click();
  await expect(
    page.getByRole("button", { name: "Edit added text: Added text", exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "View 1 file" }).click();
  await page
    .getByRole("button", { name: "Remove text.pdf and its 2 pages from the workspace" })
    .click();
  await page.getByTestId("editor-undo-button").click();
  await page.getByTestId("editor-document-view-button").click();
  await page.getByRole("button", { name: "Select added text" }).click();
  await expect(
    page.getByRole("button", { name: "Edit added text: Added text", exact: true })
  ).toBeVisible();
});

for (const [width, height] of [
  [320, 667],
  [390, 844],
  [568, 320],
  [667, 320],
]) {
  test(`compact text controls and reading mode at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await open(page);
    await place(page, "Mobile");
    await page.getByRole("button", { name: "Read", exact: true }).click();
    await expect(page.locator(".editor-text-layer")).not.toHaveClass(/is-editing/);
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await ready(page);
    const start = await point(page, 0.5, 0.5);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x - 25, start.y - 15, { steps: 3 });
    await page.mouse.up();
    await expect(page.getByLabel("Added text", { exact: true })).toHaveCount(0);
    const measurements = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      stageHeight: document.querySelector(".editor-review-stage")?.clientHeight ?? 0,
      controls: [...document.querySelectorAll<HTMLButtonElement>(".editor-document-tools button")]
        .filter((button) => button.getClientRects().length > 0)
        .map((button) => ({
          width: button.getBoundingClientRect().width,
          height: button.getBoundingClientRect().height,
        })),
    }));
    expect(measurements.overflow).toBe(false);
    expect(measurements.stageHeight).toBeGreaterThan(50);
    for (const control of measurements.controls) {
      expect(control.width).toBeGreaterThanOrEqual(44);
      expect(control.height).toBeGreaterThanOrEqual(44);
    }
  });
}

test.describe("touch text placement", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("a tap places text while a pan or pinch keeps placement armed", async ({
    page,
    browserName,
  }) => {
    await open(page);
    await page.getByRole("button", { name: "Text tools", exact: true }).tap();
    await page.getByRole("button", { name: "Add text", exact: true }).tap();
    await expect(page.locator(".editor-text-layer")).toHaveAttribute("data-geometry-ready", "true");
    const stage = page.locator(".editor-review-stage");
    const p = await point(page, 0.5, 0.5);
    const events = [
      { type: "pointerdown", id: 1, x: p.x - 25, y: p.y },
      { type: "pointerdown", id: 2, x: p.x + 25, y: p.y },
      { type: "pointermove", id: 1, x: p.x - 50, y: p.y },
      { type: "pointermove", id: 2, x: p.x + 50, y: p.y },
      { type: "pointerup", id: 1, x: p.x - 50, y: p.y },
      { type: "pointerup", id: 2, x: p.x + 50, y: p.y },
    ];
    if (browserName === "chromium") {
      const cdp = await page.context().newCDPSession(page);
      const touchPoints = new Map<number, { id: number; x: number; y: number }>();
      for (const event of events) {
        if (event.type === "pointerup") touchPoints.delete(event.id);
        else touchPoints.set(event.id, { id: event.id, x: event.x, y: event.y });
        await cdp.send("Input.dispatchTouchEvent", {
          type:
            event.type === "pointerup"
              ? "touchEnd"
              : event.type === "pointerdown"
                ? "touchStart"
                : "touchMove",
          touchPoints: [...touchPoints.values()],
        });
      }
      await cdp.detach();
    } else {
      // Other Playwright protocols expose native taps, but not multi-touch.
      await stage.evaluate((element, events) => {
        (element as HTMLElement).setPointerCapture = () => {};
        for (const event of events)
          element.dispatchEvent(
            new PointerEvent(event.type, {
              pointerId: event.id,
              pointerType: "touch",
              button: 0,
              clientX: event.x,
              clientY: event.y,
              bubbles: true,
              cancelable: true,
            })
          );
      }, events);
    }
    await expect.poll(() => stage.getAttribute("data-zoom").then(Number)).toBeGreaterThan(1.5);
    await ready(page);
    await expect(page.getByLabel("Added text", { exact: true })).toHaveCount(0);
    await expect(page.locator(".editor-text-layer")).toHaveClass(/is-placing/);
    const box = await stage.boundingBox();
    if (!box) throw new Error("Missing stage");
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.getByLabel("Added text", { exact: true }).fill("Tapped");
    await page.getByRole("button", { name: "Save text", exact: true }).tap();
    await expect(page.getByLabel("Added text", { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Edit added text: Tapped", exact: true })
    ).toBeVisible();
  });
});
