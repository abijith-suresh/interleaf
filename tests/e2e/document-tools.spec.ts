import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

async function ready(page: Page) {
  await expect(page.locator(".editor-review-stage")).toHaveAttribute("data-render-state", "ready");
}
async function upload(page: Page, name: string, buffer: Buffer) {
  await page.goto("/app");
  await page
    .getByTestId("editor-upload-input")
    .setInputFiles({ name, mimeType: "application/pdf", buffer });
  await page.getByTestId("editor-document-view-button").click();
  await ready(page);
}
async function blankPages(page: Page) {
  const pdf = await PDFDocument.create();
  pdf.addPage([400, 600]);
  pdf.addPage([400, 600]);
  await upload(page, "blank.pdf", Buffer.from(await pdf.save()));
}
async function tools(page: Page) {
  const disclosure = page.getByRole("button", { name: "Tools", exact: true });
  if ((await disclosure.isVisible()) && (await disclosure.getAttribute("aria-expanded")) !== "true")
    await disclosure.click();
}
async function draftAt(page: Page, tool: "Add text" | "Checkmark", x = 0.4, y = 0.5) {
  await tools(page);
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
  const look = (element: Element) => getComputedStyle(element).backgroundColor;
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
  await tools(page);
  await expectPressed(page, "Read");
  for (const tool of ["Add text", "Checkmark"] as const) {
    await draftAt(page, tool);
    await expectPressed(page, tool);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await tools(page);
    await expectPressed(page, "Read");
  }
  await draftAt(page, "Add text");
  await page.getByLabel("Added text", { exact: true }).fill("Saved");
  await page.getByRole("button", { name: "Save text", exact: true }).click();
  await ready(page);
  await tools(page);
  await expectPressed(page, "Select additions");
  await page.getByRole("button", { name: "Edit added text: Saved", exact: true }).click();
  await expectPressed(page, "Select additions");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await tools(page);
  await expectPressed(page, "Select additions");
  await draftAt(page, "Checkmark", 0.6, 0.7);
  await expectPressed(page, "Checkmark");
  await page.getByLabel("Checkmark size in points").press("Escape");
  await tools(page);
  await expectPressed(page, "Select additions");
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await ready(page);
  await tools(page);
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
  await ready(page);
  await draftAt(page, "Checkmark", 0.5, 0.7);
  await page.getByRole("button", { name: "Save checkmark", exact: true }).click();
  await ready(page);
  await tools(page);
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
  await tools(page);
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
