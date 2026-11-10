import { expect, test } from "@playwright/test";

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`marketing entry is navigation-only with ${reducedMotion} motion`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await page.addInitScript(() => {
      const original = document.addEventListener.bind(document);
      let registrations = 0;
      document.addEventListener = ((...args: Parameters<typeof original>) => {
        if (args[0] === "astro:after-swap") registrations++;
        return original(...args);
      }) as typeof document.addEventListener;
      Object.defineProperty(window, "swapRegistrations", { get: () => registrations });
    });
    await page.goto("/");
    await expect(page.locator(".marketing-content")).not.toHaveAttribute("data-entering");
    expect(await page.locator("main").evaluate((main) => main.getAnimations())).toEqual([]);
    const registrations = await page.evaluate(() => Reflect.get(window, "swapRegistrations"));

    for (const path of ["features", "faq", "privacy", "terms", "features"]) {
      await page.evaluate(() => {
        document.addEventListener(
          "astro:after-swap",
          () => {
            const main = document.querySelector("main");
            Reflect.set(window, "entry", {
              marked: document.querySelector(".marketing-content")?.hasAttribute("data-entering"),
              animation: main && getComputedStyle(main).animationName,
              chromeAnimated: [...document.querySelectorAll("header, nav, footer")].some(
                (node) => node.getAnimations().length > 0
              ),
              viewTransitions: document
                .getAnimations()
                .some((animation) =>
                  (animation.effect as KeyframeEffect)?.pseudoElement?.includes("view-transition")
                ),
            });
          },
          { once: true }
        );
      });
      await page.locator(`footer a[href="/${path}"]`).click();
      await expect(page).toHaveURL(new RegExp(`/${path}/?$`));
      expect(await page.evaluate(() => Reflect.get(window, "entry"))).toEqual({
        marked: true,
        animation: reducedMotion === "reduce" ? "none" : "marketing-enter",
        chromeAnimated: false,
        viewTransitions: false,
      });
      await expect(page.locator(".marketing-content")).not.toHaveAttribute("data-entering");
    }
    // Five one-shot test listeners were added; the layout must not register again.
    expect(await page.evaluate(() => Reflect.get(window, "swapRegistrations"))).toBe(
      registrations + 5
    );
  });
}

test("entry cleanup filters unrelated animation ends and has a timeout fallback", async ({
  page,
}) => {
  await page.goto("/features");
  await page.evaluate(() => {
    document.dispatchEvent(new Event("astro:after-swap"));
    const main = document.querySelector("main");
    main?.dispatchEvent(new AnimationEvent("animationend", { animationName: "unrelated" }));
  });
  await expect(page.locator(".marketing-content")).toHaveAttribute("data-entering");
  await page.evaluate(() => {
    document
      .querySelector("main")
      ?.dispatchEvent(new AnimationEvent("animationend", { animationName: "marketing-enter" }));
  });
  await expect(page.locator(".marketing-content")).not.toHaveAttribute("data-entering");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => document.dispatchEvent(new Event("astro:after-swap")));
  await expect(page.locator(".marketing-content")).toHaveAttribute("data-entering");
  await expect(page.locator(".marketing-content")).not.toHaveAttribute("data-entering");
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`press and release timings respect ${reducedMotion} motion`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await page.goto("/");
    for (const selector of [
      ".nav-actions > .marketing-button",
      ".marketing-button-leaf",
      "footer .marketing-link",
    ]) {
      const control = page.locator(selector).first();
      await control.hover();
      await page.mouse.down();
      expect(await control.evaluate((node) => getComputedStyle(node).transitionDuration)).toBe(
        reducedMotion === "reduce" ? "0s" : "0.06s"
      );
      // Release outside the link so this checks feedback without navigating.
      await page.mouse.move(0, 0);
      await page.mouse.up();
      expect(await control.evaluate((node) => getComputedStyle(node).transitionDuration)).toBe(
        reducedMotion === "reduce"
          ? "0s"
          : selector.includes("marketing-link")
            ? "0.15s"
            : "0.15s, 0.15s, 0.15s, 0.24s"
      );
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const trigger = page.locator(".mobile-nav-trigger");
    await trigger.hover();
    await page.mouse.down();
    expect(await trigger.evaluate((node) => getComputedStyle(node).transitionDuration)).toBe(
      reducedMotion === "reduce" ? "0s" : "0.06s"
    );
    await page.mouse.move(0, 0);
    await page.mouse.up();
    expect(await trigger.evaluate((node) => getComputedStyle(node).transitionDuration)).toBe(
      reducedMotion === "reduce" ? "0s" : "0.15s, 0.15s, 0.24s"
    );
  });
}
