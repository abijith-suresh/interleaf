import { expect, type Page } from "@playwright/test";
import type { FilePayload } from "./files";

export async function expectDocumentReady(page: Page) {
  await expect(page.locator(".editor-review-stage")).toHaveAttribute("data-render-state", "ready");
}

export async function openDocument(page: Page, input: FilePayload) {
  await page.goto("/app");
  await page.getByTestId("editor-upload-input").setInputFiles(input);
  await page.getByTestId("editor-document-view-button").click();
  await expectDocumentReady(page);
}
