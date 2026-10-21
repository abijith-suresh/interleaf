import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";

async function open(page: Page, fixture: string) {
  let bytes = Buffer.from(
    await readFile(
      `tests/e2e/fixtures/${fixture === "field-navigation" ? "field-linked" : fixture}.b64`,
      "utf8"
    ),
    "base64"
  );
  if (fixture === "field-navigation") {
    const doc = await PDFDocument.load(bytes),
      [first, second] = doc.getPages();
    const field = doc.getForm().getTextField("person.other"),
      widget = field.acroField.getWidgets()[0];
    const kids = field.acroField.dict.lookup(PDFName.of("Kids"), PDFArray),
      ref = kids.get(0);
    first.node.lookup(PDFName.of("Annots"), PDFArray).push(ref);
    const previous = second.node.lookup(PDFName.of("Annots"), PDFArray);
    previous.remove(previous.asArray().indexOf(ref));
    doc.context.lookup(ref, PDFDict).set(PDFName.of("P"), first.ref);
    widget.setRectangle({ x: 10, y: 220, width: 240, height: 26 });
    bytes = Buffer.from(await doc.save({ updateFieldAppearances: false }));
  }
  await page.goto("/app");
  await page.getByTestId("editor-upload-input").setInputFiles({
    name: "form.pdf",
    mimeType: "application/pdf",
    buffer: bytes,
  });
  await page.getByTestId("editor-document-view-button").click();
  await expect(page.locator(".editor-review-stage")).toHaveAttribute("data-render-state", "ready");
  const tools = page.getByRole("button", { name: "Tools", exact: true });
  if (await tools.isVisible()) await tools.click();
  await page.getByRole("button", { name: "Fill fields", exact: true }).click();
  await expect(page.locator(".editor-field-hit").first()).toBeVisible();
}
async function visibleRegion(page: Page, selector: string) {
  return page.locator(selector).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    let left = 0,
      top = 0,
      right = innerWidth,
      bottom = innerHeight;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent),
        box = parent.getBoundingClientRect();
      if (/(auto|scroll|clip|hidden)/.test(style.overflowX)) {
        left = Math.max(left, box.left);
        right = Math.min(right, box.right);
      }
      if (/(auto|scroll|clip|hidden)/.test(style.overflowY)) {
        top = Math.max(top, box.top);
        bottom = Math.min(bottom, box.bottom);
      }
    }
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return {
      width: rect.width,
      inside:
        rect.left >= left - 1 &&
        rect.right <= right + 1 &&
        rect.top >= top - 1 &&
        rect.bottom <= bottom + 1,
      hit: hit === element || element.contains(hit),
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
}
for (const width of [320, 390]) {
  test(`long inherited field label leaves a usable input at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 320 ? 667 : 844 });
    await open(page, "field-contact");
    await page.getByRole("button", { name: /Fill field: form1/ }).click();
    const input = page.getByRole("textbox");
    await expect(input).toBeFocused();
    const region = await visibleRegion(page, ".editor-field-settings input");
    expect(region.width).toBeGreaterThan(200);
    expect(region).toMatchObject({ inside: true, hit: true, overflow: false });
    await input.fill("A usable answer");
    await page.getByRole("button", { name: "Save answer", exact: true }).click();
    await expect(page.locator(".editor-field-hit.is-selected")).toHaveCount(0);
  });
}
for (const width of [568, 667]) {
  test(`validation error and input remain visible without page jumps at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 320 });
    await open(page, "field-linked");
    await page
      .getByRole("button", { name: "Fill field: person.answer", exact: true })
      .first()
      .click();
    const input = page.getByRole("textbox");
    await input.fill("i".repeat(21));
    const scroll = () =>
      page.evaluate(() => [
        scrollX,
        scrollY,
        document.querySelector(".editor-review-stage")?.scrollTop,
        document.querySelector(".editor-review-stage")?.scrollLeft,
      ]);
    const before = await scroll();
    await page.getByRole("button", { name: "Save answer", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Use at most 20 characters");
    await expect(input).toBeFocused();
    expect(await visibleRegion(page, ".editor-field-settings input")).toMatchObject({
      inside: true,
      hit: true,
      overflow: false,
    });
    expect(await visibleRegion(page, "#editor-field-error")).toMatchObject({ inside: true });
    expect(await scroll()).toEqual(before);
  });
}
test("short fixed-font fields reject clipped answers with recovery", async ({ page }) => {
  await open(page, "field-short");
  await page.getByRole("button", { name: "Fill field: Name", exact: true }).click();
  await page.getByRole("textbox").fill("gjpqyQ");
  await page.getByRole("button", { name: "Save answer", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("too short for 12 pt");
  await expect(page.getByRole("textbox")).toHaveValue("gjpqyQ");
  await expect(page.getByTestId("editor-undo-button")).toBeDisabled();
});
for (const width of [320, 1280])
  for (const action of ["Save", "Cancel"]) {
    test(`terminal drafts survive Next AltDown and direct selection after ${action} at ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: width === 320 ? 667 : 800 });
      await open(page, "field-navigation");
      const hits = page.getByRole("button", { name: "Fill field: person.answer", exact: true });
      const select = async (hit: Locator) => {
        const tools = page.getByRole("button", { name: "Tools", exact: true });
        // Close the compact popup to expose the page, retaining the field tool and drafts.
        if (width === 320 && (await tools.getAttribute("aria-expanded")) === "true")
          await tools.click();
        await hit.click();
      };
      await select(hits.first());
      const input = page.getByRole("textbox");
      await input.fill("Draft A");
      await page.getByRole("button", { name: "Next field", exact: true }).click();
      await expect(input).toHaveValue("Draft A");
      await input.press("Alt+ArrowUp");
      await expect(input).toHaveValue("Draft A");
      await input.press("Alt+ArrowUp");
      await expect(input).toHaveValue("OMITTED_FIELD_ANSWER");
      await input.fill("Draft B");
      await input.press("Alt+ArrowDown");
      await expect(input).toHaveValue("Draft A");
      await select(page.getByRole("button", { name: "Fill field: person.other", exact: true }));
      await expect(input).toHaveValue("Draft B");
      await page
        .getByRole("button", { name: action === "Save" ? "Save answer" : "Cancel", exact: true })
        .click();
      await expect(input).toHaveCount(0);
      await expect(page.locator(".editor-review-stage")).toHaveAttribute(
        "data-render-state",
        "ready"
      );
      await select(hits.first());
      await expect(input).toHaveValue("Draft A");
      await select(page.getByRole("button", { name: "Fill field: person.other", exact: true }));
      await expect(input).toHaveValue(action === "Save" ? "Draft B" : "OMITTED_FIELD_ANSWER");
      await select(hits.nth(1));
      await expect(input).toHaveValue("Draft A");
      await input.press("Alt+ArrowUp");
      await expect(input).toHaveValue("Draft A");
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await select(hits.first());
      await expect(input).toHaveValue("INHERITED");
      await expect(page.getByTestId("editor-undo-button")).toBeEnabled({
        enabled: action === "Save",
      });
    });
  }
