import { expect, test } from "@playwright/test";

const FINISHED = ["is-merged", "is-moved", "is-rotated", "is-selected", "is-marked"];

test("the hero picture is decorative and has a text alternative", async ({ page }) => {
  await page.goto("/");
  const figure = page.locator("figure.hero-demo");
  await expect(figure.locator("[data-hero-demo]")).toHaveAttribute("aria-hidden", "true");
  await expect(figure.locator("figcaption")).toContainText("Two PDFs merged into one set");
  await expect(page.getByRole("figure")).toHaveAccessibleName(/Two PDFs merged into one set/);
});

test("reduced motion keeps the finished frame still", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const frame = page.locator("[data-hero-demo]");
  await page.waitForTimeout(3500);
  for (const state of FINISHED) await expect(frame).toContainClass(state);
  await expect(frame).not.toContainClass("is-playing");
});

test("the loop plays on screen and pauses off screen", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const frame = page.locator("[data-hero-demo]");
  await expect(frame).toContainClass("is-playing", { timeout: 15000 });

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(frame).not.toBeInViewport();
  await page.waitForTimeout(1000);
  const paused = await frame.getAttribute("class");
  await page.waitForTimeout(2500);
  expect(await frame.getAttribute("class")).toBe(paused);
});

for (const width of [375, 320]) {
  test(`the hero frame scales down without overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    const box = await page.locator("[data-hero-demo]").boundingBox();
    expect(box?.x).toBe(16);
    expect(box?.width).toBe(width - 32);
  });
}
