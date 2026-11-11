import { expect, type Locator, test } from "@playwright/test";

async function rendered(frame: Locator) {
  return frame
    .locator(".demo-tile, .demo-stage, .demo-cursor, .demo-download-menu")
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const style = getComputedStyle(node);
        return [style.transform, style.translate, style.opacity, style.visibility];
      })
    );
}

async function settled(frame: Locator) {
  let previous = await rendered(frame);
  let stable = 0;
  await expect
    .poll(
      async () => {
        const current = await rendered(frame);
        const still = JSON.stringify(current) === JSON.stringify(previous);
        previous = current;
        stable = still ? stable + 1 : 0;
        return stable >= 8;
      },
      { intervals: [100], timeout: 5000 }
    )
    .toBe(true);
  return previous;
}

test("the hero picture is decorative and has a text alternative", async ({ page }) => {
  await page.goto("/");
  const figure = page.locator("figure.hero-demo");
  await expect(figure.locator("[data-hero-demo]")).toHaveAttribute("aria-hidden", "true");
  await expect(figure.locator("figcaption")).toContainText("Two PDFs merged into one set");
  await expect(page.getByRole("figure")).toHaveAccessibleName(/Two PDFs merged into one set/);
});

test("reduced motion keeps the finished frame still", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.goto("/");
  const frame = page.locator("[data-hero-demo]");
  await expect(frame.locator(".demo-selection")).toBeHidden();
  await expect(frame.locator(".demo-download-menu")).toBeVisible();
  const tiles = frame.locator(".demo-tile");
  const boxes = await tiles.evaluateAll((nodes) =>
    nodes.map((node) => node.getBoundingClientRect().x)
  );
  expect(boxes[2]).toBeLessThan(boxes[0]);
  expect(boxes[0]).toBeLessThan(boxes[1]);
  const finished = await settled(frame);
  await page.clock.runFor(15000);
  await expect.poll(() => rendered(frame)).toEqual(finished);
});

test("the loop plays on screen and pauses off screen", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.goto("/");
  const frame = page.locator("[data-hero-demo]");
  await expect(frame).toBeInViewport();
  const finished = await settled(frame);
  await page.clock.runFor(4000);
  await expect.poll(() => rendered(frame)).not.toEqual(finished);
  await settled(frame);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(frame).not.toBeInViewport();
  // Allow IntersectionObserver to deliver before crossing the next loop deadline.
  const paused = await settled(frame);
  for (let step = 0; step < 12; step++) {
    await page.clock.runFor(1000);
    await expect.poll(() => rendered(frame)).toEqual(paused);
  }
});

for (const width of [375, 320]) {
  test(`the hero frame scales down without overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    const box = await page.locator("[data-hero-demo]").boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  });
}

test("selection clears before the whole-document Download menu opens", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.goto("/");
  const frame = page.locator("[data-hero-demo]");
  await expect(frame).toBeInViewport();
  await expect
    .poll(
      async () => {
        await page.clock.runFor(1000);
        return frame.locator(".demo-selection").isVisible();
      },
      { timeout: 15000, intervals: [100] }
    )
    .toBe(true);
  await expect(frame.locator(".demo-download-menu")).toBeHidden();
  await expect
    .poll(
      async () => {
        await page.clock.runFor(1000);
        return frame.locator(".demo-selection").isVisible();
      },
      { timeout: 15000, intervals: [100] }
    )
    .toBe(false);
  await expect
    .poll(
      async () => {
        await page.clock.runFor(250);
        return frame.locator(".demo-download-menu").isVisible();
      },
      { timeout: 10000, intervals: [100] }
    )
    .toBe(true);
  await expect(frame.locator(".demo-download-menu")).toContainText("Download PDF");
  await expect(frame.locator(".demo-download-menu")).toContainText("2 of 3 pages exportable");
});
