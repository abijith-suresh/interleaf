import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { expectDocumentReady, openDocument } from "./fixtures/editor";
import { blankPdf } from "./fixtures/files";
import { revealDocumentTools } from "./fixtures/toolbar";

async function upload(page: Page, name: string, buffer: Buffer) {
  await openDocument(page, { name, mimeType: "application/pdf", buffer });
}
async function blankPages(page: Page) {
  await openDocument(
    page,
    await blankPdf("blank.pdf", [
      { width: 400, height: 600 },
      { width: 400, height: 600 },
    ])
  );
}
async function draftAt(page: Page, tool: "Add text" | "Checkmark", x = 0.4, y = 0.5) {
  await revealDocumentTools(page);
  await page.getByRole("button", { name: tool, exact: true }).click();
  await expect(page.locator(".editor-text-layer")).toHaveAttribute("data-geometry-ready", "true");
  const box = await page.locator(".editor-review-page").boundingBox();
  if (!box) throw new Error("Missing page");
  await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
}
const toolNames = ["Read", "Add text", "Checkmark", "Fill fields", "Select additions"];
// An open draft swaps the page tools out of the bar, so read them even while hidden.
const hidden = { includeHidden: true } as const;
async function pressed(page: Page) {
  const toolbar = page.getByRole("toolbar", { name: "Page tools", ...hidden });
  const names: string[] = [];
  for (const name of toolNames) {
    const button = toolbar.getByRole("button", { name, exact: true, ...hidden });
    if ((await button.count()) && (await button.getAttribute("aria-pressed")) === "true")
      names.push(name);
  }
  return names;
}
async function expectPressed(page: Page, name: string) {
  await expect.poll(() => pressed(page)).toEqual([name]);
  const button = page
    .getByRole("toolbar", { name: "Page tools", ...hidden })
    .getByRole("button", { name, exact: true, ...hidden });
  // Pressed styling comes from the same state as aria-pressed.
  const look = (element: Element) => getComputedStyle(element).color;
  const read = page
    .getByRole("toolbar", { name: "Page tools", ...hidden })
    .getByRole("button", { name: name === "Read" ? "Add text" : "Read", exact: true, ...hidden });
  await expect
    .poll(async () => (await button.evaluate(look)) !== (await read.evaluate(look)))
    .toBe(true);
}

test("one tool is pressed while drafting, after cancel, and after a page change", async ({
  page,
}) => {
  test.slow();
  await blankPages(page);
  await revealDocumentTools(page);
  await expectPressed(page, "Read");
  for (const tool of ["Add text", "Checkmark"] as const) {
    await draftAt(page, tool);
    await expectPressed(page, tool);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await revealDocumentTools(page);
    await expectPressed(page, "Read");
  }
  await draftAt(page, "Add text");
  await page.getByLabel("Added text", { exact: true }).fill("Saved");
  await page.getByRole("button", { name: "Save text", exact: true }).click();
  await expectDocumentReady(page);
  await revealDocumentTools(page);
  await expectPressed(page, "Select additions");
  await page.getByRole("button", { name: "Edit added text: Saved", exact: true }).click();
  await expectPressed(page, "Select additions");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await revealDocumentTools(page);
  await expectPressed(page, "Select additions");
  await draftAt(page, "Checkmark", 0.6, 0.7);
  await expectPressed(page, "Checkmark");
  await page.getByLabel("Checkmark size in points").press("Escape");
  await revealDocumentTools(page);
  await expectPressed(page, "Select additions");
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expectDocumentReady(page);
  await revealDocumentTools(page);
  await expectPressed(page, "Read");
});

async function hitCenter(page: Page, name: string) {
  const box = await page.getByRole("button", { name, exact: true }).boundingBox();
  if (!box) throw new Error(`Missing ${name}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}
async function hitAt(page: Page, x: number, y: number) {
  return page.evaluate(
    ([x, y]) =>
      document.elementFromPoint(x, y)?.closest<HTMLElement>(".editor-text-hit")?.ariaLabel ?? null,
    [x, y]
  );
}
async function placeBoth(page: Page) {
  await blankPages(page);
  await draftAt(page, "Add text", 0.3, 0.3);
  await page.getByLabel("Added text", { exact: true }).fill("Small");
  await page.getByRole("button", { name: "Save text", exact: true }).click();
  await expectDocumentReady(page);
  await draftAt(page, "Checkmark", 0.5, 0.7);
  await page.getByRole("button", { name: "Save checkmark", exact: true }).click();
  await expectDocumentReady(page);
  await revealDocumentTools(page);
  await page.getByRole("button", { name: "Select additions" }).click();
}

test("placed text and checkmarks have a centred 24px minimum hit area", async ({ page }) => {
  await placeBoth(page);
  for (const name of ["Edit added text: Small", "Edit added checkmark"]) {
    const { x, y, box } = await hitCenter(page, name);
    expect(box.height).toBeLessThan(20);
    for (const [dx, dy] of [
      [0, -11],
      [0, 11],
      [Math.max(box.width / 2, 12) - 1, 0],
      [-Math.max(box.width / 2, 12) + 1, 0],
    ])
      expect(await hitAt(page, x + dx, y + dy)).toBe(name);
    expect(await hitAt(page, x, y - 14)).toBeNull();
    expect(await hitAt(page, x, y + 14)).toBeNull();
  }
  // The larger target only selects. Nothing drawn or exported changes size.
  const mark = await hitCenter(page, "Edit added checkmark");
  await page.mouse.click(mark.x, mark.y + 11);
  await expect(page.getByLabel("Checkmark size in points")).toHaveValue("16");
});

test.describe("coarse pointers", () => {
  test.use({ hasTouch: true });
  test("placed items have a 44px minimum hit area", async ({ page, browserName }) => {
    await placeBoth(page);
    test.skip(
      !(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)),
      `${browserName} does not emulate a coarse pointer`
    );
    for (const name of ["Edit added text: Small", "Edit added checkmark"]) {
      const { x, y } = await hitCenter(page, name);
      expect(await hitAt(page, x, y - 21)).toBe(name);
      expect(await hitAt(page, x, y + 21)).toBe(name);
      expect(await hitAt(page, x, y + 24)).toBeNull();
    }
  });
});

async function openContact(page: Page) {
  const bytes = Buffer.from(
    await readFile("tests/e2e/fixtures/field-contact.b64", "utf8"),
    "base64"
  );
  await upload(page, "contact.pdf", bytes);
  await revealDocumentTools(page);
  await page.getByRole("button", { name: "Fill fields", exact: true }).click();
  await expect(page.locator(".editor-field-hit")).toHaveCount(3);
}

test("fields use readable names and visual order with Enter navigation", async ({ page }) => {
  test.slow();
  await openContact(page);
  const fields = page.locator(".editor-field-layer").getByRole("button");
  expect(await fields.evaluateAll((hits) => hits.map((hit) => hit.ariaLabel))).toEqual([
    "Fill field: Applicant full name",
    "Fill field: Email",
    "Fill field: Phone",
  ]);
  await page.getByRole("button", { name: "Fill field: Applicant full name", exact: true }).click();
  const name = page.getByRole("textbox", { name: "Answer for Applicant full name" });
  await expect(name).toBeFocused();
  await expect(page.locator(".editor-field-label")).toHaveText("Applicant full name");
  await expect(page.getByRole("button", { name: "Previous field" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Next field" })).toBeEnabled();

  await name.fill("Ada Lovelace");
  await name.press("Enter");
  const email = page.getByRole("textbox", { name: "Answer for Email" });
  await expect(email).toBeFocused();
  await email.fill("ada@example.com");
  await email.press("Shift+Enter");
  await expect(name).toBeFocused();
  await expect(name).toHaveValue("Ada Lovelace");
  await name.press("Enter");
  await expect(email).toHaveValue("ada@example.com");
  await email.press("Enter");
  const phone = page.getByRole("textbox", { name: "Answer for Phone" });
  await expect(phone).toBeFocused();
  await expect(page.getByRole("button", { name: "Next field" })).toBeDisabled();
  await phone.fill("555 0100");
  await phone.press("Enter");
  await expect(page.locator(".editor-field-settings")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Fill field: Phone", exact: true })).toBeFocused();
  await expect(page.getByTestId("editor-undo-button")).toBeEnabled();

  await page.getByRole("button", { name: "Fill field: Phone", exact: true }).click();
  await expect(phone).toHaveValue("555 0100");
  await phone.fill("discarded");
  await phone.press("Escape");
  await expect(page.locator(".editor-field-settings")).toHaveCount(0);
  await page.getByRole("button", { name: "Fill field: Phone", exact: true }).click();
  await expect(phone).toHaveValue("555 0100");
});

for (const width of [1440, 375, 320]) {
  test(`filmstrip field badges sit below page content at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    const pdf = await PDFDocument.create();
    const sheet = pdf.addPage([400, 600]);
    pdf
      .getForm()
      .createTextField("name")
      .addToPage(sheet, { x: 40, y: 400, width: 200, height: 24 });
    await upload(page, "form.pdf", Buffer.from(await pdf.save()));
    const item = page.locator(".editor-review-filmstrip-item").first();
    const badge = item.locator(".editor-filmstrip-fields");
    await expect(badge).toHaveText("1 field");
    await expect(item).toHaveAccessibleDescription("1 field");
    const thumbnail = await item.locator(".canvas-container").boundingBox();
    const box = await badge.boundingBox();
    expect(box?.y).toBeGreaterThanOrEqual((thumbnail?.y ?? 0) + (thumbnail?.height ?? 0));
    await expect(badge).toHaveCSS("background-color", "rgb(229, 229, 229)");
  });
}

test("phone page-tool disclosure names the current tool and lists Read once", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await blankPages(page);
  const disclosure = page.getByRole("button", { name: "Page tool: Read", exact: true });
  await disclosure.click();
  const tools = page.getByRole("toolbar", { name: "Page tools" });
  await expect(tools.getByRole("button", { name: "Read", exact: true })).toHaveCount(1);
  await tools.getByRole("button", { name: "Add text", exact: true }).click();
  const current = page.getByRole("button", { name: "Page tool: Add text", exact: true });
  await expect(current).toHaveAttribute("aria-expanded", "false");
  await current.click();
  await expect(tools.getByRole("button", { name: "Read", exact: true })).toHaveCount(1);
  await expect(tools.getByRole("button", { name: "Add text", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
});
