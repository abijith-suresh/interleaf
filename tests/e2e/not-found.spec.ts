import { expect, test } from "@playwright/test";

test("an unknown path shows the 404 page with working links", async ({ page }) => {
  const response = await page.goto("/no/such/page");
  expect(response?.status()).toBe(404);

  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Footer navigation" })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
  await expect(page.locator('meta[property="og:image"], meta[name="twitter:image"]')).toHaveCount(
    0
  );

  const main = page.getByRole("main");
  await expect(main.getByRole("link", { name: "Open editor" })).toHaveAttribute("href", "/app");
  await expect(main.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
});

test("the sitemap leaves out the 404 page", async ({ request }) => {
  const sitemap = await request.get("/sitemap-0.xml");
  expect(await sitemap.text()).not.toContain("404");
});
