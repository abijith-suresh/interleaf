import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream, StandardFonts } from "pdf-lib";

const LEAVE_MESSAGE = "Leave the editor? Your pages aren't saved anywhere.";

async function source() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const first = document.addPage([400, 600]);
  document.getForm().createTextField("name").addToPage(first, {
    x: 40,
    y: 420,
    width: 200,
    height: 24,
    font,
  });
  document.addPage([400, 600]);
  return {
    name: "unsaved.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await document.save()),
  };
}

async function load(page: Page) {
  await page.getByTestId("editor-upload-input").setInputFiles(await source());
  await expect(page.getByTestId("editor-page-grid")).toBeVisible();
}

async function open(page: Page) {
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.goto("/app");
  await load(page);
  await page.getByTestId("editor-document-view-button").click();
  await ready(page);
}

async function ready(page: Page) {
  await expect(page.locator(".editor-review-stage")).toHaveAttribute("data-render-state", "ready");
}

async function draft(page: Page, tool: "Add text" | "Checkmark") {
  await page.getByRole("button", { name: tool, exact: true }).click();
  await expect(page.locator(".editor-text-layer")).toHaveAttribute("data-geometry-ready", "true");
  const frame = await page.locator(".editor-review-page").boundingBox();
  if (!frame) throw new Error("Missing page frame");
  await page.mouse.click(frame.x + frame.width * 0.4, frame.y + frame.height * 0.6);
}

/** Decoded content of the downloaded PDF's first page. */
async function download(page: Page) {
  const downloading = page.waitForEvent("download");
  await page.getByTestId("editor-download-button").click();
  const path = await (await downloading).path();
  if (!path) throw new Error("Missing PDF download");
  const contents = (await PDFDocument.load(await readFile(path))).getPage(0).node.Contents();
  const streams =
    contents instanceof PDFArray
      ? Array.from({ length: contents.size() }, (_, index) => contents.lookup(index, PDFRawStream))
      : contents instanceof PDFRawStream
        ? [contents]
        : [];
  return streams
    .map((stream) => new TextDecoder().decode(decodePDFRawStream(stream).decode()))
    .join("\n")
    .toLowerCase();
}

const hex = (text: string) => Buffer.from(text, "latin1").toString("hex");

test("download saves an open text edit so the PDF matches the page", async ({ page }) => {
  await open(page);
  await draft(page, "Add text");
  const input = page.getByLabel("Added text", { exact: true });
  await input.fill("Approved 2026-11-07");
  await page.getByRole("button", { name: "Save text", exact: true }).click();
  await expect(input).toHaveCount(0);
  await ready(page);

  await page.getByRole("button", { name: "Edit added text: Approved 2026-11-07" }).click();
  await input.fill("CHANGED 2");
  const operators = await download(page);
  expect(operators).toContain(hex("CHANGED 2"));
  expect(operators).not.toContain(hex("Approved 2026-11-07"));
  await expect(input).toHaveCount(0);
  await expect(page.getByTestId("editor-undo-button")).toHaveAttribute(
    "aria-label",
    "Undo Edit text"
  );
  await expect(page.getByRole("button", { name: "Edit added text: CHANGED 2" })).toBeVisible();
});

test("page navigation and view switches save open text, checkmark, and field drafts", async ({
  page,
}) => {
  await open(page);
  const undo = page.getByTestId("editor-undo-button");
  const title = page.getByTestId("editor-viewer-title");

  await draft(page, "Add text");
  await page.getByLabel("Added text", { exact: true }).fill("Kept on next");
  await page.getByTestId("editor-page-viewer-next").click();
  await expect(title).toHaveText("Page 2");
  await expect(undo).toHaveAttribute("aria-label", "Undo Add text");

  await ready(page);
  await draft(page, "Checkmark");
  await expect(page.getByRole("button", { name: "Drag checkmark to move it" })).toBeVisible();
  await page.getByRole("button", { name: "View page 1" }).click();
  await expect(title).toHaveText("Page 1");
  await expect(undo).toHaveAttribute("aria-label", "Undo Add checkmark");
  await expect(page.getByRole("button", { name: "Edit added text: Kept on next" })).toBeVisible();

  await ready(page);
  await page.getByRole("button", { name: "Fill fields", exact: true }).click();
  await page.getByRole("button", { name: "Fill field: name" }).click();
  await page.getByRole("textbox", { name: "Answer for name" }).fill("Ada");
  await page.getByTestId("editor-pages-view-button").click();
  await expect(page.getByTestId("editor-page-grid")).toBeVisible();
  await expect(undo).toHaveAttribute("aria-label", "Undo Fill text field");

  // Undo removes each saved draft as its own change.
  await undo.click();
  await expect(undo).toHaveAttribute("aria-label", "Undo Add checkmark");
});

test("an invalid draft blocks leaving it and shows why, while Cancel still discards", async ({
  page,
}) => {
  await open(page);
  let downloads = 0;
  page.on("download", () => downloads++);
  await draft(page, "Add text");
  const input = page.getByLabel("Added text", { exact: true });
  await input.fill("Café");

  for (const leave of [
    page.getByTestId("editor-pages-view-button"),
    page.getByTestId("editor-page-viewer-next"),
    page.getByRole("button", { name: "View page 2" }),
    page.getByTestId("editor-download-button"),
  ]) {
    await leave.click();
    await expect(page.locator("#editor-text-error")).toContainText("basic Latin");
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("Café");
    await expect(page.getByTestId("editor-viewer-title")).toHaveText("Page 1");
  }
  expect(downloads).toBe(0);
  await expect(page.getByTestId("editor-undo-button")).toHaveAttribute(
    "aria-label",
    "Nothing to undo"
  );

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(input).toHaveCount(0);
  await page.getByTestId("editor-pages-view-button").click();
  await expect(page.getByTestId("editor-page-grid")).toBeVisible();
  await expect(page.getByTestId("editor-undo-button")).toHaveAttribute(
    "aria-label",
    "Nothing to undo"
  );
});

test("leaving the editor asks first only when the workspace has pages", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Open editor" }).first().click();
  await expect(page).toHaveURL(/\/app$/);
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });

  // An empty workspace has nothing to lose.
  await page.getByRole("link", { name: "Return to Interleaf home" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/app$/);
  expect(dialogs).toEqual([]);

  await load(page);
  for (const link of [
    page.getByRole("link", { name: "Return to Interleaf home" }),
    page.locator(".editor-sidebar .editor-brand"),
  ]) {
    await link.click();
    await expect.poll(() => dialogs.length).toBeGreaterThan(0);
    expect(dialogs.pop()).toBe(LEAVE_MESSAGE);
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByTestId("editor-page-grid")).toBeVisible();
  }

  // Back has already moved the address bar. Declining returns it to the editor.
  await page.goBack();
  await expect.poll(() => dialogs.length).toBeGreaterThan(0);
  expect(dialogs.pop()).toBe(LEAVE_MESSAGE);
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByTestId("editor-page-grid")).toBeVisible();

  page.removeAllListeners("dialog");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("link", { name: "Return to Interleaf home" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("reloading a workspace with pages asks first", async ({ page }) => {
  await page.goto("/app");
  await load(page);
  // Browsers show the unload prompt only after the user interacts with the page.
  await page.getByRole("heading", { name: "Pages", exact: true }).click();
  const prompt = page.waitForEvent("dialog");
  void page.reload().catch(() => undefined);
  const dialog = await prompt;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.dismiss();
  await expect(page.getByTestId("editor-page-grid")).toBeVisible();
});
