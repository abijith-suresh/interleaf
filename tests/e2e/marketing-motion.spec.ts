import { expect, test } from "@playwright/test";

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`marketing entry is navigation-only with ${reducedMotion} motion`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await page.goto("/");
    expect(await page.locator("main").evaluate((main) => main.getAnimations())).toEqual([]);
    for (const path of ["features", "faq", "privacy", "terms", "features"]) {
      await page.evaluate(() => {
        document.addEventListener(
          "astro:after-swap",
          () => {
            const main = document.querySelector("main");
            Reflect.set(window, "entry", {
              chromeAnimated: [...document.querySelectorAll("header, nav, footer")].some(
                (node) => node.getAnimations().length > 0
              ),
              viewTransitions: document
                .getAnimations()
                .some((animation) =>
                  (animation.effect as KeyframeEffect)?.pseudoElement?.includes("view-transition")
                ),
              position: main?.getBoundingClientRect().toJSON(),
            });
          },
          { once: true }
        );
      });
      await page.locator(`footer a[href="/${path}"]`).click();
      await expect(page).toHaveURL(new RegExp(`/${path}/?$`));
      const entry = await page.evaluate(() => Reflect.get(window, "entry"));
      expect(entry.chromeAnimated).toBe(false);
      expect(entry.viewTransitions).toBe(false);
      await expect(page.locator("h1")).toBeVisible();
      await expect(page.locator("main")).toHaveCSS("opacity", "1");
      await expect(page.locator(".marketing-content")).toHaveCSS("opacity", "1");
      if (reducedMotion === "reduce") {
        expect(
          await page.locator("main").evaluate((main) => main.getBoundingClientRect().toJSON())
        ).toEqual(entry.position);
        expect(await page.locator("main").evaluate((main) => main.getAnimations())).toEqual([]);
      }
    }
  });
}

test("entry remains visible and interactive without a matching animation end", async ({ page }) => {
  await page.goto("/");
  await page.locator('footer a[href="/features"]').click();
  await expect(page).toHaveURL(/\/features\/?$/);
  await page.locator("main").evaluate((main) => {
    for (const animation of main.getAnimations()) animation.cancel();
    main.dispatchEvent(
      new AnimationEvent("animationend", { animationName: "unrelated", bubbles: true })
    );
  });
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.locator("main")).toHaveCSS("opacity", "1");
  await expect(page.locator(".marketing-content")).toHaveCSS("opacity", "1");
  await page.locator('footer a[href="/faq"]').click();
  await expect(page).toHaveURL(/\/faq\/?$/);
  await expect(page.locator("h1")).toBeVisible();
});
