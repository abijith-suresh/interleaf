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

  await summary.click();
  await expect(menu).toHaveJSProperty("open", true);
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

test("the page delete toggle keeps one name and exposes its state through aria-pressed", async ({
  page,
}) => {
  await page.goto("/app");
  await page.getByTestId("editor-upload-input").setInputFiles(await source("one.pdf"));
  const toggle = page.getByRole("button", { name: "Mark page 1 for deletion", exact: true });

  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(toggle).toHaveAccessibleName("Mark page 1 for deletion");
});
