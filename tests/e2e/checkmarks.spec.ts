import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import {
  decodePDFRawStream,
  degrees,
  PDFArray,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
} from "pdf-lib";

async function open(page: Page) {
  const pdf = await PDFDocument.create();
  const sheet = pdf.addPage([400, 600]);
  sheet.setMediaBox(-40, -60, 400, 600);
  sheet.setCropBox(-20, 40, 300, 400);
  sheet.node.set(PDFName.of("UserUnit"), PDFNumber.of(1.5));
  sheet.setRotation(degrees(90));
  sheet.drawText("Flat form: choose an answer", { x: 20, y: 400, size: 12 });
  sheet.drawRectangle({ x: 80, y: 170, width: 14, height: 14, borderWidth: 1 });
  await page.goto("/app");
  await page.getByTestId("editor-upload-input").setInputFiles({
    name: "form.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await pdf.save()),
  });
  await page.getByTestId("editor-document-view-button").click();
  await ready(page);
}
async function ready(page: Page) {
  await expect(page.locator(".editor-review-stage")).toHaveAttribute("data-render-state", "ready");
}
async function tools(page: Page) {
  const disclosure = page.getByRole("button", { name: "Tools", exact: true });
  if ((await disclosure.isVisible()) && (await disclosure.getAttribute("aria-expanded")) !== "true")
    await disclosure.click();
}
async function arm(page: Page) {
  await tools(page);
  await page.getByRole("button", { name: "Checkmark", exact: true }).press("Enter");
  await expect(page.locator(".editor-text-layer")).toHaveAttribute("data-geometry-ready", "true");
}
async function place(page: Page) {
  await arm(page);
  const box = await page.locator(".editor-review-page").boundingBox();
  if (!box) throw new Error("Missing page");
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.55);
  await expect(page.getByLabel("Checkmark size in points")).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: "Draft checkmark" })).toBeVisible();
  await page.getByRole("button", { name: "Save checkmark", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit added checkmark", exact: true })
  ).toBeFocused();
  await ready(page);
}

for (const [width, height] of [
  [1280, 800],
  [320, 667],
  [390, 844],
  [568, 320],
  [667, 320],
]) {
  test(`checkmark placement, movement, controls and focus at ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await open(page);
    await arm(page);
    const stage = page.locator(".editor-review-stage");
    await expect(stage).toBeFocused();
    await stage.press(width === 1280 ? "Space" : "Enter");
    const size = page.getByLabel("Checkmark size in points");
    await expect(size).toBeFocused();
    const draft = page.getByRole("button", { name: "Drag checkmark to move it" });
    const placed = await draft.evaluate((element) => [
      parseFloat(element.style.left),
      parseFloat(element.style.top),
    ]);
    expect(placed[0]).toBeCloseTo(100 * (0.5 - 8 / 600), 4);
    expect(placed[1]).toBeCloseTo(100 * (0.5 + 8 / 450), 4);
    await size.fill("24");
    await expect(draft.locator("svg polyline")).toHaveAttribute(
      "points",
      "0.12,0.5 0.38,0.78 0.88,0.15000000000000002"
    );
    // Use real keyboard navigation so focus-visible follows each browser's modality rules.
    for (let step = 0; step < 5; step++) await page.keyboard.press("Shift+Tab");
    await expect(draft).toBeFocused();
    const before = await draft.evaluate((element) => [
      parseFloat(element.style.left),
      parseFloat(element.style.top),
    ]);
    if (width !== 1280)
      await expect(page.getByRole("button", { name: "Tools", exact: true })).toHaveAttribute(
        "aria-expanded",
        "false"
      );
    const unobscured = () =>
      draft.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return top === element || element.contains(top);
      });
    await expect.poll(unobscured).toBe(true);
    await draft.press("ArrowRight");
    await draft.press("Shift+ArrowDown");
    const after = await draft.evaluate((element) => [
      parseFloat(element.style.left),
      parseFloat(element.style.top),
    ]);
    expect(after[0]).toBeGreaterThan(before[0]);
    expect(after[1]).toBeGreaterThan(before[1]);
    await expect.poll(unobscured).toBe(true);
    await draft.press("Enter");
    await expect(size).toBeFocused();
    await size.fill("144");
    for (let step = 0; step < 60; step++) await draft.press("Shift+ArrowRight");
    await draft.press("Enter");
    await expect(size).toBeFocused();
    await page.getByRole("button", { name: "Rotate checkmark 90 degrees" }).click();
    await page.getByRole("button", { name: "Save checkmark", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("beyond the page");
    await expect(size).toBeFocused();
    for (let step = 0; step < 60; step++) await draft.press("Shift+ArrowLeft");
    await draft.press("Enter");
    await expect(size).toBeFocused();
    await size.fill("24");
    await page.getByRole("button", { name: "Save checkmark", exact: true }).press("Enter");
    const hit = page.getByRole("button", { name: "Edit added checkmark", exact: true });
    await expect(hit).toBeFocused();
    await ready(page);
    for (const action of ["Cancel", "Escape", "Save checkmark"]) {
      await hit.press("Enter");
      await expect(size).toBeFocused();
      await expect(
        page.getByRole("status").filter({ hasText: "Editing saved checkmark" })
      ).toBeVisible();
      if (action === "Escape") await size.press("Escape");
      else await page.getByRole("button", { name: action, exact: true }).press("Enter");
      await expect(hit).toBeFocused();
    }
    await hit.press("Enter");
    await page.getByRole("button", { name: "Delete added checkmark" }).press("Enter");
    await expect(
      width === 1280
        ? page.getByRole("button", { name: "Add text", exact: true })
        : page.getByRole("button", { name: "Tools", exact: true })
    ).toBeFocused();
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      stage: document.querySelector(".editor-review-stage")?.clientHeight ?? 0,
    }));
    expect(layout.overflow).toBe(false);
    expect(layout.stage).toBeGreaterThan(50);
  });
}

test("point placement, drag, cancel, independent text and checkmark history, duplication and source restoration", async ({
  page,
}) => {
  await open(page);
  await place(page);
  const hit = page.getByRole("button", { name: "Edit added checkmark", exact: true });
  const savedPosition = await hit.evaluate((element) => [element.style.left, element.style.top]);
  await hit.click();
  const draft = page.getByRole("button", { name: "Drag checkmark to move it" });
  await page.getByRole("button", { name: "Checkmark settings" }).click();
  await ready(page);
  const before = await draft.boundingBox();
  if (!before) throw new Error("Missing draft");
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 20, before.y + before.height / 2 + 15, {
    steps: 4,
  });
  await page.mouse.up();
  const after = await draft.boundingBox();
  expect(after?.x).toBeCloseTo(before.x + 20, 0);
  expect(after?.y).toBeCloseTo(before.y + 15, 0);
  await draft.press("Escape");
  await expect(hit).toBeFocused();
  expect(await hit.evaluate((element) => [element.style.left, element.style.top])).toEqual(
    savedPosition
  );
  const downloading = page.waitForEvent("download");
  await page.getByTestId("editor-download-button").click();
  const path = await (await downloading).path();
  if (!path) throw new Error("Missing marked PDF download");
  const downloaded = await PDFDocument.load(await readFile(path));
  expect(downloaded.getPageCount()).toBe(1);
  const contents = downloaded.getPage(0).node.Contents();
  if (!(contents instanceof PDFArray)) throw new Error("Missing downloaded page content");
  let operators = "";
  for (let index = 0; index < contents.size(); index++)
    operators += new TextDecoder().decode(
      decodePDFRawStream(contents.lookup(index, PDFRawStream)).decode()
    );
  expect(operators.match(/\nS\n/g)?.length).toBeGreaterThanOrEqual(2);
  await page.getByRole("button", { name: "More download options" }).click();
  await expect(page.getByRole("menuitem", { name: /Compress/ })).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.getByTestId("editor-undo-button").click();
  await page.getByRole("button", { name: "More download options" }).click();
  await expect(page.getByRole("menuitem", { name: /Compress/ })).toBeEnabled();
  await page.keyboard.press("Escape");
  await page.getByTestId("editor-redo-button").click();
  await page.getByRole("button", { name: "Add text", exact: true }).click();
  await page.locator(".editor-review-stage").press("Enter");
  await page.getByLabel("Added text", { exact: true }).fill("Answer");
  await page.getByRole("button", { name: "Save text", exact: true }).click();
  await page.getByTestId("editor-pages-view-button").click();
  await page.getByRole("button", { name: "Duplicate page 1", exact: true }).click();
  await page.getByTestId("editor-document-view-button").click();
  await page.getByRole("button", { name: "Select additions" }).click();
  await hit.click();
  await page.getByLabel("Checkmark size in points").fill("30");
  await page.getByRole("button", { name: "Save checkmark", exact: true }).click();
  await page.getByRole("button", { name: "Edit added text: Answer", exact: true }).click();
  await page.getByLabel("Added text", { exact: true }).fill("Copy");
  await page.getByRole("button", { name: "Save text", exact: true }).click();
  await page.getByTestId("editor-pages-view-button").click();
  await page.getByRole("button", { name: "Page 2", exact: true }).click();
  await page.getByTestId("editor-document-view-button").click();
  await page.getByRole("button", { name: "Previous page", exact: true }).click();
  await page.getByRole("button", { name: "Select additions" }).click();
  await expect(
    page.getByRole("button", { name: "Edit added text: Answer", exact: true })
  ).toBeVisible();
  await hit.click();
  await expect(page.getByLabel("Checkmark size in points")).toHaveValue("16");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "View 1 file" }).click();
  await page
    .getByRole("button", { name: "Remove form.pdf and its 2 pages from the workspace" })
    .click();
  await page.getByTestId("editor-undo-button").click();
  await page.getByTestId("editor-document-view-button").click();
  await page.getByRole("button", { name: "Select additions" }).click();
  await expect(hit).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit added text: Answer", exact: true })
  ).toBeVisible();
});

test.describe("touch checkmark gestures", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("pan, pinch and cancellation keep placement armed before a native tap", async ({ page }) => {
    await open(page);
    await arm(page);
    const stage = page.locator(".editor-review-stage");
    const box = await stage.boundingBox();
    if (!box) throw new Error("Missing stage");
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    // Other protocols do not expose multitouch. Exercise the same pointer path.
    await stage.evaluate(
      (element, { x, y }) => {
        (element as HTMLElement).setPointerCapture = () => {};
        for (const [type, id, dx] of [
          ["pointerdown", 1, -25],
          ["pointermove", 1, -50],
          ["pointercancel", 1, -50],
          ["pointerdown", 2, -25],
          ["pointerdown", 3, 25],
          ["pointermove", 2, -50],
          ["pointermove", 3, 50],
          ["pointerup", 2, -50],
          ["pointerup", 3, 50],
        ] as const)
          element.dispatchEvent(
            new PointerEvent(type, {
              pointerId: id,
              pointerType: "touch",
              button: 0,
              clientX: x + dx,
              clientY: y,
              bubbles: true,
              cancelable: true,
            })
          );
      },
      { x, y }
    );
    await expect(stage).toHaveAttribute("data-zoom", "2");
    await ready(page);
    await expect(page.getByLabel("Checkmark size in points")).toHaveCount(0);
    await expect(page.locator(".editor-text-layer")).toHaveClass(/is-placing/);
    await page.touchscreen.tap(x, y);
    await expect(page.getByLabel("Checkmark size in points")).toBeVisible();
    await page.getByRole("button", { name: "Save checkmark", exact: true }).tap();
    await expect(
      page.getByRole("button", { name: "Edit added checkmark", exact: true })
    ).toBeVisible();
    await page.getByRole("button", { name: "Read", exact: true }).tap();
    await expect(page.locator(".editor-text-layer")).not.toHaveClass(/is-editing/);
  });
});

for (const kind of ["checkmark", "text"] as const) {
  test(`compact ${kind} settings reveal focused fields after a saved addition at 568x320`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 568, height: 320 });
    await open(page);
    await place(page);
    await tools(page);
    await page
      .getByRole("button", { name: kind === "checkmark" ? "Checkmark" : "Add text", exact: true })
      .press("Enter");
    const stage = page.locator(".editor-review-stage");
    await expect(stage).toBeFocused();
    const scrollPosition = () =>
      page.evaluate(() => {
        const stage = document.querySelector(".editor-review-stage");
        return [scrollX, scrollY, stage?.scrollLeft, stage?.scrollTop];
      });
    const before = await scrollPosition();
    await stage.press("Enter");
    const field = page.getByLabel(
      kind === "checkmark" ? "Checkmark size in points" : "Added text",
      { exact: true }
    );
    if (kind === "text") {
      await field.fill("Saved text");
      await page.getByRole("button", { name: "Save text", exact: true }).click();
      await ready(page);
      await page
        .getByRole("button", { name: "Edit added text: Saved text", exact: true })
        .press("Enter");
    }
    const unobscured = () =>
      field.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return [0.2, 0.5, 0.8].every((fraction) => {
          const top = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height * fraction
          );
          return top === element || element.contains(top);
        });
      });
    await expect(field).toBeFocused();
    await expect.poll(unobscured).toBe(true);
    expect(await scrollPosition()).toEqual(before);

    // Reach the draft through the actual tab order, including Edit additions.
    for (let step = 0; step < 6; step++) await page.keyboard.press("Shift+Tab");
    const draft = page.getByRole("button", { name: `Drag ${kind} to move it` });
    await expect(draft).toBeFocused();
    await expect(page.getByRole("button", { name: "Tools", exact: true })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    await draft.press("ArrowRight");
    await draft.press("Enter");
    await expect(field).toBeFocused();
    await expect.poll(unobscured).toBe(true);
    expect(await scrollPosition()).toEqual(before);

    // Validation returns focus to a visible field after actions scroll into view.
    if (kind === "checkmark") {
      for (let step = 0; step < 60; step++) await draft.press("Shift+ArrowRight");
      await draft.press("Enter");
    } else await field.fill("Café");
    await page.getByRole("button", { name: `Save ${kind}`, exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(
      kind === "checkmark" ? "beyond the page" : "basic Latin"
    );
    await expect(field).toBeFocused();
    await expect.poll(unobscured).toBe(true);
    expect(await scrollPosition()).toEqual(before);

    // Scroll the popup itself to reach actions, without moving the page or preview.
    await page.locator(".editor-document-tools").evaluate((popup) => {
      popup.scrollTop = popup.scrollHeight;
      const content = popup.querySelector(".editor-text-content");
      if (content) content.scrollTop = content.scrollHeight;
    });
    const cancel = page.getByRole("button", { name: "Cancel", exact: true });
    for (const action of [`Save ${kind}`, "Cancel"]) {
      await expect
        .poll(() =>
          page.getByRole("button", { name: action, exact: true }).evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const top = document.elementFromPoint(
              rect.left + rect.width / 2,
              rect.top + rect.height / 2
            );
            return top === element || element.contains(top);
          })
        )
        .toBe(true);
    }
    expect(await scrollPosition()).toEqual(before);
    await cancel.click();
    await expect(
      page.getByRole("button", {
        name: kind === "text" ? "Edit added text: Saved text" : "Tools",
        exact: true,
      })
    ).toBeFocused();
  });
}
