import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { inspectExport } from "../../src/services/__tests__/pdf-export-inspection";
import { textFieldFixture } from "../../src/services/__tests__/pdf-field-fixtures";

async function ready(page: Page) {
  await expect(page.locator(".editor-review-stage")).toHaveAttribute("data-render-state", "ready");
}
async function tools(page: Page) {
  const button = page.getByRole("button", { name: "Tools", exact: true });
  if ((await button.isVisible()) && (await button.getAttribute("aria-expanded")) !== "true")
    await button.click();
}
async function open(page: Page) {
  const fixture = await textFieldFixture();
  await page.goto("/app");
  await page.getByTestId("editor-upload-input").setInputFiles({
    name: "form.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(fixture.bytes),
  });
  await page.getByTestId("editor-document-view-button").click();
  await ready(page);
  return fixture;
}
async function arm(page: Page) {
  await tools(page);
  await page.getByRole("button", { name: "Fill fields", exact: true }).click();
  await expect(page.locator(".editor-field-hit")).toHaveCount(4);
}
for (const [width, height] of [
  [1280, 800],
  [320, 667],
  [390, 844],
  [568, 320],
  [667, 320],
]) {
  test(`direct field selection, clear, focus, navigation and undo at ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const fixture = await open(page);
    await arm(page);
    const hit = page.locator(`[data-widget-ref="${fixture.widgetRefs[0]}"]`);
    await expect(hit).toHaveAttribute("data-field-ref", fixture.fieldRef);
    await hit.click();
    const input = page.getByRole("textbox", { name: "Answer for person.answer" });
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("INHERITED");
    await input.fill("ANSWER");
    await page.getByRole("button", { name: "Save answer", exact: true }).click();
    await expect(hit).toBeFocused();
    await ready(page);
    await hit.press("Enter");
    await expect(input).toHaveValue("ANSWER");
    await page.getByRole("button", { name: "Next field", exact: true }).click();
    await expect(input).toBeFocused();
    await expect(page.locator(".editor-field-hit.is-selected")).toHaveAttribute(
      "data-widget-ref",
      fixture.widgetRefs[1]
    );
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.locator(`[data-widget-ref="${fixture.widgetRefs[1]}"]`)).toBeFocused();
    await hit.click();
    await input.fill("");
    await page.getByRole("button", { name: "Save answer", exact: true }).click();
    await expect(hit).toBeFocused();
    await ready(page);
    await page.getByTestId("editor-undo-button").click();
    await ready(page);
    await hit.click();
    await expect(input).toHaveValue("ANSWER");
    await input.press("Escape");
    await expect(hit).toBeFocused();
    await page.getByTestId("editor-redo-button").click();
    await ready(page);
    await hit.click();
    await expect(input).toHaveValue("");
    await input.fill("W".repeat(16));
    await page.getByRole("button", { name: "Save answer", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("does not fit");
    await expect(input).toBeFocused();
    await input.press("Escape");
    await expect(hit).toBeFocused();
    await tools(page);
    await page
      .getByRole("button", { name: "Read", exact: true })
      .filter({ visible: true })
      .first()
      .click();
    await expect(page.locator(".editor-field-hit")).toHaveCount(0);
  });
}
test("saved answers survive source history and download", async ({ page }) => {
  const fixture = await open(page);
  await arm(page);
  const hit = page.locator(`[data-widget-ref="${fixture.widgetRefs[0]}"]`);
  await hit.click();
  await page.getByRole("textbox", { name: "Answer for person.answer" }).fill("SAVED");
  await page.getByRole("button", { name: "Save answer", exact: true }).click();
  await ready(page);
  const download = page.waitForEvent("download");
  await page.getByTestId("editor-download-button").click();
  const saved = await download;
  const path = await saved.path();
  if (!path) throw Error("No download");
  const result = await inspectExport(new Uint8Array(await readFile(path)));
  expect(result.pageObjects).toBe(2);
  expect(result.widgetObjects).toBe(6);
  expect(result.orphanKids).toBe(false);
  expect(
    result.pages
      .flatMap((p) => p.annotations)
      .filter((a) => a.name === "person.answer")
      .map((a) => a.value)
  ).toEqual(["SAVED", "SAVED", "SAVED"]);
  await page.getByTestId("editor-files-button").click();
  await page
    .getByRole("button", { name: "Remove form.pdf and its 2 pages from the workspace" })
    .click();
  await expect(page.getByTestId("editor-page-viewer")).toHaveCount(0);
  await page.getByTestId("editor-undo-button").click();
  await page.getByTestId("editor-document-view-button").click();
  await ready(page);
  await arm(page);
  await page.locator(`[data-widget-ref="${fixture.widgetRefs[0]}"]`).click();
  await expect(page.getByRole("textbox", { name: "Answer for person.answer" })).toHaveValue(
    "SAVED"
  );
});

test("protected PDFs keep manual text available while embedded filling is unavailable", async ({
  page,
}) => {
  const bytes = Buffer.from(
    (await readFile("tests/e2e/fixtures/added-text-encrypted.b64", "utf8")).trim(),
    "base64"
  );
  await page.goto("/app");
  await page
    .getByTestId("editor-upload-input")
    .setInputFiles({ name: "protected.pdf", mimeType: "application/pdf", buffer: bytes });
  await page.getByLabel("PDF password", { exact: true }).fill("623");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await page.getByTestId("editor-document-view-button").click();
  await ready(page);
  await tools(page);
  await page.getByRole("button", { name: "Fill fields", exact: true }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Embedded filling is unavailable for protected PDFs. Use Add text." })
  ).toBeVisible();
  await expect(page.locator(".editor-field-hit")).toHaveCount(0);
  await page.getByRole("button", { name: "Add text", exact: true }).click();
  await page.locator(".editor-review-stage").press("Enter");
  await page.getByRole("textbox", { name: "Added text", exact: true }).fill("Manual");
  await page.getByRole("button", { name: "Save text", exact: true }).click();
  await ready(page);
  await expect(
    page.getByRole("button", { name: "Edit added text: Manual", exact: true })
  ).toBeFocused();
  const download = page.waitForEvent("download");
  await page.getByTestId("editor-download-button").click();
  const result = await download;
  const path = await result.path();
  if (!path) throw Error("Missing protected export");
  const exported = await inspectExport(new Uint8Array(await readFile(path)));
  expect(exported.pageObjects).toBe(12);
  expect(exported.widgetObjects).toBe(0);
});

test("logical page duplicates and duplicate-of-duplicate keep independent saved answers", async ({
  page,
}) => {
  const fixture = await open(page);
  await arm(page);
  const hit = page.locator(`[data-widget-ref="${fixture.widgetRefs[0]}"]`);
  const answer = page.getByRole("textbox", { name: "Answer for person.answer" });
  async function save(value: string) {
    await hit.click();
    await answer.fill(value);
    await page.getByRole("button", { name: "Save answer", exact: true }).click();
    await expect(hit).toBeFocused();
    await ready(page);
  }
  await save("ORIGINAL");
  await page.getByTestId("editor-pages-view-button").click();
  await page.getByRole("button", { name: "Duplicate page 1", exact: true }).click();
  await page.getByRole("button", { name: "Duplicate page 2", exact: true }).click();
  const selectedCopy = page.getByTestId("editor-page-tile").nth(2);
  await selectedCopy.focus();
  await selectedCopy.press("Escape");
  await expect(page.getByTestId("editor-selection-title")).toHaveText("All 4 exportable");
  await page.getByTestId("editor-document-view-button").click();
  await ready(page);
  await arm(page);
  await page.getByRole("button", { name: "View page 2", exact: true }).click();
  await ready(page);
  await save("COPY");
  await page.getByRole("button", { name: "View page 3", exact: true }).click();
  await ready(page);
  await hit.click();
  await expect(answer).toHaveValue("ORIGINAL");
  await answer.press("Escape");
  await save("THIRD");
  await page.getByRole("button", { name: "View page 1", exact: true }).click();
  await ready(page);
  await hit.click();
  await expect(answer).toHaveValue("ORIGINAL");
  await answer.press("Escape");
  const promise = page.waitForEvent("download");
  await page.getByTestId("editor-download-button").click();
  const download = await promise,
    path = await download.path();
  if (!path) throw Error("Missing duplicated export");
  const saved = await inspectExport(new Uint8Array(await readFile(path)));
  expect(saved.pageObjects).toBe(4);
  expect(saved.widgetObjects).toBe(14);
  expect(saved.orphanKids).toBe(false);
  expect(
    saved.pages.map((p) =>
      p.annotations.filter((a) => a.name === "person.answer").map((a) => a.value)
    )
  ).toEqual([["ORIGINAL", "ORIGINAL"], ["COPY", "COPY"], ["THIRD", "THIRD"], ["ORIGINAL"]]);
});
