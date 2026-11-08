import type { Page } from "@playwright/test";

/** Narrow layouts list Add files and Files under the toolbar's More menu. */
export async function revealSourceActions(page: Page) {
  const more = page.getByTestId("editor-more-button");
  if ((await more.isVisible()) && (await more.getAttribute("aria-expanded")) !== "true")
    await more.click();
}

export async function openFiles(page: Page) {
  await revealSourceActions(page);
  await page.getByTestId("editor-files-button").click();
}

export async function clickAddFiles(page: Page) {
  await revealSourceActions(page);
  await page.getByTestId("editor-add-pdf-button").click();
}

/** Narrow layouts list Extract, Export PNG, and other selection actions under More. */
export async function clickSelectionAction(page: Page, testId: string) {
  const more = page.getByTestId("editor-selection-more-button");
  if ((await more.isVisible()) && (await more.getAttribute("aria-expanded")) !== "true")
    await more.click();
  await page.getByTestId(testId).click();
}

/** Phone page actions contain zoom controls. Keep the disclosure open for repeated zooming. */
export async function revealPageZoom(page: Page) {
  const more = page.getByTestId("editor-page-actions-button");
  if ((await more.isVisible()) && (await more.getAttribute("aria-expanded")) !== "true") {
    await more.click();
    // Measure the 44px targets after the disclosure's scale animation finishes.
    await page.locator("#editor-page-actions").evaluate(async (panel) => {
      await Promise.all(panel.getAnimations().map((animation) => animation.finished));
    });
  }
}
