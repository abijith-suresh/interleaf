import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("http://127.0.0.1:4173/smoke.html");
  await page.waitForFunction(
    () => document.querySelector("#output")?.textContent?.startsWith("PASS:") === true,
    undefined,
    { timeout: 45_000 }
  );

  if (errors.length > 0) {
    throw new Error(`Browser reported errors: ${errors.join("; ")}`);
  }
} finally {
  await browser.close();
}
