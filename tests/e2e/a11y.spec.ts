import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

async function source(name: string) {
  const pdf = await PDFDocument.create();
  pdf.addPage([400, 600]);
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) };
}

test("the mobile menu closes on Escape, outside click, and link navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const menu = page.locator("details.mobile-nav");
  const summary = menu.locator("summary");
  const nav = page.getByRole("navigation", { name: "Main navigation" });

  // The editor action stays in the header; the menu holds only the page links.
  await expect(nav.getByRole("link", { name: "Open editor" })).toBeVisible();
  await expect(summary).toHaveAccessibleName("Menu");

  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(menu).toHaveJSProperty("open", true);
  await expect(menu.getByRole("link")).toHaveText(["Features", "FAQ"]);
  // The dropdown hangs from the trigger's right edge.
  const rightEdge = (selector: string) =>
    page.locator(selector).evaluate((node) => Math.round(node.getBoundingClientRect().right));
  expect(await rightEdge(".mobile-nav-panel")).toBe(await rightEdge(".mobile-nav-trigger"));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveJSProperty("open", false);
  await expect(summary).toBeFocused();

  await summary.click();
  await page.mouse.click(10, 600);
  await expect(menu).toHaveJSProperty("open", false);

  await summary.click();
  await menu.getByRole("link", { name: "FAQ" }).click();
  await expect(page).toHaveURL(/\/faq\/?$/);
  await expect(page.locator("details.mobile-nav")).toHaveJSProperty("open", false);

  // A link to the page already shown never swaps the page, so it must close the menu itself.
  await page.locator("details.mobile-nav summary").click();
  await page.locator("details.mobile-nav").getByRole("link", { name: "FAQ" }).click();
  await expect(page.locator("details.mobile-nav")).toHaveJSProperty("open", false);
});

test("a wrong password is flagged on the input and announced; the dialog is modal", async ({
  page,
}) => {
  await page.goto("/app");
  await page.getByTestId("editor-upload-input").setInputFiles({
    name: "protected.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(
      await readFile("tools/qpdf-wasm/fixtures/encrypted-40-bit-r3.b64", "utf8"),
      "base64"
    ),
  });
  const dialog = page.getByRole("dialog", { name: "Password required" });
  const password = page.getByLabel("PDF password", { exact: true });
  await expect(password).toBeFocused();
  await expect(password).not.toHaveAttribute("aria-invalid", "true");
  expect(await dialog.evaluate((node) => (node as HTMLDialogElement).matches(":modal"))).toBe(true);

  await password.fill("wrong");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();

  await expect(password).toHaveAttribute("aria-invalid", "true");
  await expect(password).toHaveAccessibleDescription("Incorrect password. Try again.");
  await expect(dialog.getByRole("alert")).toHaveText("Incorrect password. Try again.");
  await expect(password).toHaveValue("");

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("error toasts stay readable, pause on hover, and can be dismissed", async ({ page }) => {
  await page.clock.install();
  await page.goto("/app");
  await page
    .getByTestId("editor-upload-input")
    .setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("text") });

  const toast = page.getByTestId("editor-toast");
  await expect(toast).toHaveAttribute("role", "alert");
  await page.clock.runFor(3500);
  await expect(toast).toBeVisible();

  await toast.hover();
  await page.clock.runFor(20_000);
  await expect(toast).toBeVisible();

  await page.mouse.move(5, 500);
  await page.clock.runFor(8100);
  await expect(toast).toHaveCount(0);
});

test("dismissing a toast from the keyboard moves focus back into the editor", async ({ page }) => {
  await page.goto("/app");
  await page
    .getByTestId("editor-upload-input")
    .setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("text") });

  const dismiss = page.getByRole("button", { name: "Dismiss notification" });
  await dismiss.focus();
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("editor-toast")).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.activeElement === document.body))
    .toBe(false);
});

test("the page delete button names the action it takes", async ({ page }) => {
  await page.goto("/app");
  await page.getByTestId("editor-upload-input").setInputFiles(await source("one.pdf"));
  const toggle = page.getByTestId("editor-page-delete-button");

  await expect(toggle).toHaveAccessibleName("Mark page 1 for deletion");
  await expect(toggle).not.toHaveAttribute("aria-pressed");
  await toggle.click();
  await expect(toggle).toHaveAccessibleName("Restore page 1");
  await expect(toggle).not.toHaveAttribute("aria-pressed");
  await toggle.click();
  await expect(toggle).toHaveAccessibleName("Mark page 1 for deletion");
});

for (const width of [375, 320]) {
  test(`phone view labels and Document header remain usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await page.goto("/app");
    await page.getByTestId("editor-upload-input").setInputFiles(await source("form.pdf"));
    for (const name of ["Pages", "Document"]) {
      const button = page.getByRole("button", { name, exact: true });
      await expect(button.locator(".editor-view-label")).toBeVisible();
      await expect(button).toHaveAccessibleName(name);
      const box = await button.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
    }
    await expect(page.getByTestId("editor-download-menu-button")).toHaveAccessibleName(
      "Download options"
    );
    await page.getByRole("button", { name: "Document", exact: true }).click();
    const header = await page.locator(".editor-review-header").boundingBox();
    const tools = await page.getByRole("button", { name: "Tools", exact: true }).boundingBox();
    expect(
      Math.abs(
        (header?.y ?? 0) + (header?.height ?? 0) / 2 - (tools?.y ?? 0) - (tools?.height ?? 0) / 2
      )
    ).toBeLessThan(2);
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    await expect(page.getByRole("button", { name: "Add text", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByTestId("editor-page-actions-button").click();
    await expect(page.getByRole("button", { name: "Fit page", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("editor-page-actions-button")).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}
