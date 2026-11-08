import { expect, type Page } from "@playwright/test";
import {
  decodePDFRawStream,
  PDFArray,
  type PDFContentStream,
  PDFDocument,
  type PDFPage,
  PDFRawStream,
} from "pdf-lib";
import { saveDownload } from "./fixtures/download";
import { expectDocumentReady } from "./fixtures/editor";
import { encryptedFixture } from "./fixtures/files";
import { test } from "./fixtures/privacy";
import { downloadDocument } from "./fixtures/toolbar";

async function download(page: Page, filename: string) {
  const pending = page.waitForEvent("download");
  await downloadDocument(page);
  const saved = await pending;
  const path = test.info().outputPath(filename);
  const bytes = await saveDownload(saved, path);
  expect(await saved.failure()).toBeNull();
  return PDFDocument.load(bytes);
}

function operators(page: PDFPage) {
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray() : [contents];
  // Reading a page can rewrap its content as a PDFContentStream.
  return streams
    .map((ref) => page.node.context.lookup(ref))
    .map((stream) =>
      new TextDecoder().decode(
        stream instanceof PDFRawStream
          ? decodePDFRawStream(stream).decode()
          : (stream as PDFContentStream).getUnencodedContents()
      )
    )
    .join("\n");
}

function expectVectorPages(pdf: PDFDocument) {
  expect(pdf.isEncrypted).toBe(false);
  expect(pdf.getPageCount()).toBe(30);
  for (const index of [0, 29]) {
    expect(operators(pdf.getPage(index))).toContain(`(Potato ${index})`);
    expect(pdf.getPage(index).node.normalizedEntries().XObject?.keys() ?? []).toHaveLength(0);
  }
}

test("an unlocked AES-256 PDF exports every page as vectors with added text", async ({
  page,
  privacy,
}) => {
  await page.goto("/app");
  await page
    .getByTestId("editor-upload-input")
    .setInputFiles(await encryptedFixture("encrypted-256-bit-r6"));
  await page.getByLabel("PDF password", { exact: true }).fill("wwwww");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(page.locator(".password-modal")).toHaveCount(0);
  await expect(page.getByTestId("editor-page-tile")).toHaveCount(30);

  await page.getByTestId("editor-document-view-button").click();
  await expectDocumentReady(page);
  await page.getByRole("button", { name: "Add text", exact: true }).click();
  await expect(page.locator(".editor-text-layer")).toHaveAttribute("data-geometry-ready", "true");
  await page.locator(".editor-review-stage").press("Enter");
  await page.getByLabel("Added text", { exact: true }).fill("Protected note");
  await page.getByRole("button", { name: "Save text", exact: true }).click();
  await expectDocumentReady(page);
  await expect(page.getByRole("button", { name: "Edit added text: Protected note" })).toBeVisible();

  const pdf = await download(page, "protected-edited.pdf");
  expectVectorPages(pdf);
  expect(operators(pdf.getPage(0))).toContain(
    Buffer.from("Protected note").toString("hex").toUpperCase()
  );
  expect(privacy.requests.some((request) => request.url().includes("/qpdf/qpdf.wasm"))).toBe(true);
});

test("an owner-password-only PDF opens without a prompt and exports every page", async ({
  page,
}) => {
  await page.goto("/app");
  await page
    .getByTestId("editor-upload-input")
    .setInputFiles(await encryptedFixture("encrypted-256-bit-owner-only"));
  await expect(page.getByTestId("editor-page-tile")).toHaveCount(30);
  await expect(page.locator(".password-modal")).toHaveCount(0);

  expectVectorPages(await download(page, "owner-only.pdf"));
});

test("an R3 PDF with a non-ASCII password exports after unlocking", async ({ page }) => {
  await page.goto("/app");
  await page
    .getByTestId("editor-upload-input")
    .setInputFiles(await encryptedFixture("encrypted-128-bit-r3-latin1-password"));
  await page.getByLabel("PDF password", { exact: true }).fill("é");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(page.locator(".password-modal")).toHaveCount(0);
  await expect(page.getByTestId("editor-page-tile")).toHaveCount(1);

  const pdf = await download(page, "latin1-password.pdf");
  expect(pdf.isEncrypted).toBe(false);
  expect(pdf.getPageCount()).toBe(1);
  expect(operators(pdf.getPage(0))).toContain("(Potato)");
});
