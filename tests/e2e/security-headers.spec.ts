import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

const rule = (
  JSON.parse(readFileSync("vercel.json", "utf8")) as {
    headers: { source: string; headers: { key: string; value: string }[] }[];
  }
).headers.find((entry) => entry.source === "/(.*)");

async function watchViolations(page: Page) {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/content.security.policy/i.test(message.text())) violations.push(message.text());
  });
  await page.exposeFunction("reportCspViolation", (violation: string) =>
    violations.push(violation)
  );
  await page.addInitScript(() =>
    document.addEventListener("securitypolicyviolation", (event) =>
      (window as unknown as { reportCspViolation(text: string): void }).reportCspViolation(
        `${event.effectiveDirective} ${event.blockedURI}`
      )
    )
  );
  return violations;
}

async function download(page: Page, id: string) {
  const pending = page.waitForEvent("download");
  await page.getByTestId(id).click();
  const file = await pending;
  const path = test.info().outputPath(file.suggestedFilename());
  await file.saveAs(path);
  return readFileSync(path);
}

test("pages are served with the vercel.json security headers", async ({ request }) => {
  expect(rule?.headers.map(({ key }) => key)).toContain("Content-Security-Policy");
  for (const path of ["/", "/app"]) {
    const headers = (await request.get(path)).headers();
    for (const { key, value } of rule?.headers ?? [])
      expect(headers[key.toLowerCase()]).toBe(value);
  }
});

test("the editor opens, compresses and exports without CSP violations", async ({ page }) => {
  const violations = await watchViolations(page);
  const pdf = await PDFDocument.create();
  pdf.addPage([400, 600]).drawText("CSP source", { x: 30, y: 500, size: 18 });
  await page.goto("/app");
  await page.getByTestId("editor-upload-input").setInputFiles({
    name: "csp.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await pdf.save({ useObjectStreams: false })),
  });
  await expect(page.getByTestId("editor-page-tile")).toHaveCount(1);
  await page.getByTestId("editor-document-view-button").click();
  await expect(page.locator(".editor-review-stage")).toHaveAttribute("data-render-state", "ready");

  await page.getByTestId("editor-download-options-button").click();
  const compressed = await download(page, "editor-compress-button");
  expect((await PDFDocument.load(compressed)).getPageCount()).toBe(1);
  expect(
    (await PDFDocument.load(await download(page, "editor-download-button"))).getPageCount()
  ).toBe(1);
  await page.getByTestId("editor-download-options-button").click();
  expect((await download(page, "editor-export-images-button")).byteLength).toBeGreaterThan(0);

  expect(violations).toEqual([]);
});

test("the native password dialog and mobile menu work without CSP violations", async ({ page }) => {
  const violations = await watchViolations(page);
  await page.goto("/app");
  await page.getByTestId("editor-upload-input").setInputFiles({
    name: "protected.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(
      readFileSync("tools/qpdf-wasm/fixtures/encrypted-40-bit-r3.b64", "utf8"),
      "base64"
    ),
  });
  const dialog = page.getByRole("dialog", { name: "Password required" });
  await expect(dialog).toBeVisible();
  await page.getByLabel("PDF password", { exact: true }).fill("wrong");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Incorrect password. Try again.");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator("details.mobile-nav summary").click();
  await page.keyboard.press("Escape");
  await expect(page.locator("details.mobile-nav")).toHaveJSProperty("open", false);

  expect(violations).toEqual([]);
});

test("the CSP blocks cross-origin fetches", async ({ page }) => {
  const violations = await watchViolations(page);
  await page.goto("/app");
  const outcome = await page.evaluate(() =>
    fetch("https://csp.invalid/upload", { method: "POST", body: "synthetic" }).then(
      () => "resolved",
      () => "rejected"
    )
  );
  expect(outcome).toBe("rejected");
  await expect.poll(() => violations.some((text) => text.startsWith("connect-src"))).toBe(true);
});
