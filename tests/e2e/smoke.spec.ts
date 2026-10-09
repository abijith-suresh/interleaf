import { expect, test } from "@playwright/test";

test("landing page renders", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Interleaf — Make documents ready in your browser");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
