import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { inspectExport } from "../../src/services/__tests__/pdf-export-inspection";
import { textFieldFixture } from "../../src/services/__tests__/pdf-field-fixtures";
import { captureDownload } from "./fixtures/download";
import { expectDocumentReady, openDocument } from "./fixtures/editor";
import { downloadDocument, openFiles, revealDocumentTools } from "./fixtures/toolbar";

async function open(page: Page) {
  const fixture = await textFieldFixture();
  await openDocument(page, {
    name: "form.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(fixture.bytes),
  });
  return fixture;
}
async function arm(page: Page) {
  await revealDocumentTools(page);
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
    await hit.click();
    const input = page.getByRole("textbox", { name: "Answer for Answer" });
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("INHERITED");
    await input.fill("ANSWER");
    await page.getByRole("button", { name: "Save answer", exact: true }).click();
    await expect(hit).toBeFocused();
    await expectDocumentReady(page);
    await hit.press("Enter");
    await expect(input).toHaveValue("ANSWER");
    await page.getByRole("button", { name: "Next field", exact: true }).click();
    await expect(input).toBeFocused();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.locator(`[data-widget-ref="${fixture.widgetRefs[1]}"]`)).toBeFocused();
    await hit.click();
    await input.fill("");
    await page.getByRole("button", { name: "Save answer", exact: true }).click();
    await expect(hit).toBeFocused();
    await expectDocumentReady(page);
    await page.getByTestId("editor-undo-button").click();
    await expectDocumentReady(page);
    await hit.click();
    await expect(input).toHaveValue("ANSWER");
    await input.press("Escape");
    await expect(hit).toBeFocused();
    await page.getByTestId("editor-redo-button").click();
    await expectDocumentReady(page);
    await hit.click();
    await expect(input).toHaveValue("");
    await input.fill("W".repeat(16));
    await page.getByRole("button", { name: "Save answer", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("does not fit");
    await expect(input).toBeFocused();
    await input.press("Escape");
    await expect(hit).toBeFocused();
    await revealDocumentTools(page);
    await page
      .getByRole("button", { name: "Read", exact: true })
      .filter({ visible: true })
      .first()
      .click();
    // Read mode keeps the fields as passive targets that open them for filling.
    await hit.click();
    await expect(input).toBeVisible();
    await input.press("Escape");
    // The header counts only the fields that can be filled.
    const fillable = await page.locator('.editor-field-hit:not([aria-disabled="true"])').count();
    await expect(page.getByTestId("editor-page-field-count")).toHaveText(
      `${fillable} field${fillable === 1 ? "" : "s"}`
    );
  });
}
test("saved answers survive source history and download", async ({ page }) => {
  const fixture = await open(page);
  await arm(page);
  const hit = page.locator(`[data-widget-ref="${fixture.widgetRefs[0]}"]`);
  await hit.click();
  await page.getByRole("textbox", { name: "Answer for Answer" }).fill("SAVED");
  await page.getByRole("button", { name: "Save answer", exact: true }).click();
  await expectDocumentReady(page);
  const { bytes: downloadedBytes } = await captureDownload(page, () => downloadDocument(page));
  const result = await inspectExport(new Uint8Array(downloadedBytes));
  expect(result.pageObjects).toBe(2);
  expect(result.widgetObjects).toBe(6);
  expect(result.orphanKids).toBe(false);
  expect(
    result.pages
      .flatMap((p) => p.annotations)
      .filter((a) => a.name === "person.answer")
      .map((a) => a.value)
  ).toEqual(["SAVED", "SAVED", "SAVED"]);
  await openFiles(page);
  await page
    .getByRole("button", { name: "Remove form.pdf and its 2 pages from the workspace" })
    .click();
  await expect(page.getByTestId("editor-page-viewer")).toHaveCount(0);
  await page.getByTestId("editor-undo-button").click();
  await page.getByTestId("editor-document-view-button").click();
  await expectDocumentReady(page);
  await arm(page);
  await page.locator(`[data-widget-ref="${fixture.widgetRefs[0]}"]`).click();
  await expect(page.getByRole("textbox", { name: "Answer for Answer" })).toHaveValue("SAVED");
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
  await expectDocumentReady(page);
  await revealDocumentTools(page);
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
  await expectDocumentReady(page);
  await expect(
    page.getByRole("button", { name: "Edit added text: Manual", exact: true })
  ).toBeFocused();
  const { bytes: downloadedBytes } = await captureDownload(page, () => downloadDocument(page));
  const exported = await inspectExport(new Uint8Array(downloadedBytes));
  expect(exported.pageObjects).toBe(12);
  expect(exported.widgetObjects).toBe(0);
});

test("logical page duplicates and duplicate-of-duplicate keep independent saved answers", async ({
  page,
}) => {
  const fixture = await open(page);
  await arm(page);
  const hit = page.locator(`[data-widget-ref="${fixture.widgetRefs[0]}"]`);
  const answer = page.getByRole("textbox", { name: "Answer for Answer" });
  async function save(value: string) {
    await hit.click();
    await answer.fill(value);
    await page.getByRole("button", { name: "Save answer", exact: true }).click();
    await expect(hit).toBeFocused();
    await expectDocumentReady(page);
  }
  await save("ORIGINAL");
  await page.getByTestId("editor-pages-view-button").click();
  await page.getByRole("button", { name: "Duplicate page 1", exact: true }).click();
  await page.getByRole("button", { name: "Duplicate page 2", exact: true }).click();
  const selectedCopy = page.getByTestId("editor-page-tile").nth(2);
  await selectedCopy.focus();
  await selectedCopy.press("Escape");
  await expect(page.getByRole("toolbar", { name: "Selected pages" })).toHaveCount(0);
  await page.getByTestId("editor-document-view-button").click();
  await expectDocumentReady(page);
  await arm(page);
  await page.getByRole("button", { name: "View page 2", exact: true }).click();
  await expectDocumentReady(page);
  await save("COPY");
  await page.getByRole("button", { name: "View page 3", exact: true }).click();
  await expectDocumentReady(page);
  await hit.click();
  await expect(answer).toHaveValue("ORIGINAL");
  await answer.press("Escape");
  await save("THIRD");
  await page.getByRole("button", { name: "View page 1", exact: true }).click();
  await expectDocumentReady(page);
  await hit.click();
  await expect(answer).toHaveValue("ORIGINAL");
  await answer.press("Escape");
  const { bytes: downloadedBytes } = await captureDownload(page, () => downloadDocument(page));
  const saved = await inspectExport(new Uint8Array(downloadedBytes));
  expect(saved.pageObjects).toBe(4);
  expect(saved.widgetObjects).toBe(14);
  expect(saved.orphanKids).toBe(false);
  expect(
    saved.pages.map((p) =>
      p.annotations.filter((a) => a.name === "person.answer").map((a) => a.value)
    )
  ).toEqual([["ORIGINAL", "ORIGINAL"], ["COPY", "COPY"], ["THIRD", "THIRD"], ["ORIGINAL"]]);
});

test("Read mode shows the field count and opens a field for filling on click", async ({ page }) => {
  const fixture = await open(page);
  // Read is the default mode; fields stay visible as passive targets.
  await expect(page.getByRole("button", { name: "Read", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  const hits = page.locator(".editor-field-hit");
  await expect(hits).toHaveCount(4);
  const fillable = await page.locator('.editor-field-hit:not([aria-disabled="true"])').count();
  const label = `${fillable} field${fillable === 1 ? "" : "s"}`;
  await expect(page.getByTestId("editor-page-field-count")).toHaveText(label);
  await expect(
    page.getByRole("button", { name: "View page 1", exact: true })
  ).toHaveAccessibleDescription(label);
  await page.locator(`[data-widget-ref="${fixture.widgetRefs[0]}"]`).click();
  const input = page.getByRole("textbox", { name: "Answer for Answer" });
  await expect(input).toBeFocused();
  // The open answer swaps the tools out of the bar; closing it shows Fill fields chosen.
  await expect(page.getByRole("button", { name: "Fill fields", exact: true })).toBeHidden();
  await input.press("Escape");
  await expect(page.locator(`[data-widget-ref="${fixture.widgetRefs[0]}"]`)).toBeFocused();
  await expect(page.getByRole("button", { name: "Fill fields", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
});
