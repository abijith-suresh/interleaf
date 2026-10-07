import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { init } from "@embedpdf/pdfium";
import { unzipSync } from "fflate";
import {
  createJpegFile,
  createPdfFile,
  createPngFile,
  formBytes,
  sharedFormBytes,
} from "../../src/services/__tests__/pdf-fixtures.ts";
import { PDFiumEngine } from "../../src/services/pdfium/engine.ts";

// The runner is a development tool. Its optional dependency is separate from application dependencies.
const runnerPath = process.argv[3];
const playwright = await import(
  runnerPath
    ? pathToFileURL(join(runnerPath, "node_modules/playwright/index.mjs")).href
    : "playwright"
);
const requestedBrowser = process.env.INTERLEAF_BROWSER ?? "chromium";
const browserName = requestedBrowser === "chrome" ? "chromium" : requestedBrowser;
assert.ok(["chromium", "firefox", "webkit"].includes(browserName));
const origin = process.argv[2] ?? "http://127.0.0.1:4873";
const directory = await mkdtemp(join(tmpdir(), "interleaf-pdfium-"));
const api = await init({
  wasmBinary: await readFile(
    new URL("../../node_modules/@embedpdf/pdfium/dist/pdfium.wasm", import.meta.url)
  ),
});
const engine = new PDFiumEngine(api);
const browser = await playwright[browserName].launch({
  headless: true,
  executablePath: process.env.INTERLEAF_BROWSER_EXECUTABLE,
});
const context = await browser.newContext({ acceptDownloads: true });
let page = await context.newPage();
const errors = [];
const requests = [];
function observe(context, page) {
  page.on("pageerror", (error) => errors.push(error.message));
  context.on("request", (request) =>
    requests.push({ url: request.url(), method: request.method() })
  );
}
observe(context, page);

async function openFiles(files) {
  await page.goto(`${origin}/app/`);
  await page.locator("input[type=file]").first().setInputFiles(files);
  await page.locator("[data-testid=editor-page-canvas][data-render-state=ready]").first().waitFor();
}
async function downloadFrom(testId, name) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId(testId).click(),
  ]);
  const path = join(directory, name);
  await download.saveAs(path);
  return new Uint8Array(await readFile(path));
}
async function applyText(text, button) {
  await page.getByLabel("Text", { exact: true }).fill(text);
  assert.deepEqual(
    await page
      .locator(".editor-content-composer input")
      .evaluateAll((inputs) =>
        inputs
          .filter((input) => !input.validity.valid)
          .map((input) => ({ value: input.value, message: input.validationMessage }))
      ),
    [],
    "Tap placement must produce valid form inputs"
  );
  await page
    .locator(".editor-content-composer")
    .getByRole("button", { name: button, exact: true })
    .click();
  await waitForSaved();
}
async function waitForSaved() {
  await page.locator(".editor-content-composer").waitFor({ state: "hidden" });
  await page.getByRole("status").filter({ hasText: "Applied to this page" }).waitFor();
}
async function placeText(x = 0.17, y = 0.88, touch = false) {
  const placement = page.getByRole("button", { name: "Place text on page", exact: true });
  const box = await placement.boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0);
  await placement[touch ? "tap" : "click"]({
    position: { x: box.width * x, y: box.height * y },
  });
  await page.getByLabel("Text", { exact: true }).waitFor();
}
async function assertVisibleInViewport(locator, label) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(
    box &&
      box.x >= 0 &&
      box.y >= 0 &&
      box.x + box.width <= viewport.width + 1 &&
      box.y + box.height <= viewport.height + 1,
    `${label} must remain reachable within ${viewport.width}x${viewport.height}: ${JSON.stringify(box)}`
  );
}
async function pinchWithoutPlacing(context) {
  if (browserName !== "chromium") return;
  const paper = page.locator(".editor-review-page");
  const box = await paper.boundingBox();
  const session = await context.newCDPSession(page);
  const center = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.35 };
  const points = (distance) => [
    { id: 1, x: center.x - distance, y: center.y },
    { id: 2, x: center.x + distance, y: center.y },
  ];
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(35) });
  for (const distance of [45, 55, 65]) {
    await page.waitForTimeout(30);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: points(distance),
    });
  }
  await page.waitForTimeout(30);
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  // Detaching a second CDP session resets touch emulation in older Chromium.
  // Closing the browser releases this session after the mobile checks finish.
  await page.waitForFunction(
    (width) => document.querySelector(".editor-review-page").clientWidth > width * 1.05,
    box.width
  );
  assert.equal(
    await page.locator(".editor-content-composer").count(),
    0,
    "Pinching must not insert text"
  );
  await page.getByRole("button", { name: "Fit page", exact: true }).tap();
}

try {
  const formPath = join(directory, "forms.pdf");
  await writeFile(formPath, formBytes());
  await openFiles([formPath]);
  await page.getByTestId("editor-download-options-button").click();
  assert.equal(
    await page.getByTestId("editor-compress-button").getAttribute("aria-disabled"),
    "false"
  );
  const compressed = await downloadFrom("editor-compress-button", "compressed.pdf");
  assert.equal(engine.open(compressed).count, 1);

  await page.getByRole("button", { name: "Review pages", exact: true }).click();
  await page.getByRole("button", { name: "Edit page", exact: true }).click();
  await placeText();
  await applyText("Added line", "Add text");
  await page.getByRole("button", { name: "Edit text", exact: true }).click();
  await page.getByRole("button", { name: "Edit Original phrase", exact: true }).click();
  await applyText("New phrase", "Replace text");
  await page.getByRole("button", { name: "Fill forms", exact: true }).click();
  await page.getByRole("button", { name: "Check Agree", exact: true }).click();
  await page.getByRole("button", { name: "Uncheck Agree", exact: true }).waitFor();
  await page.getByRole("button", { name: "Fill Name", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Alice");
  await page.getByRole("button", { name: "Save & next", exact: true }).click();
  await page.getByRole("checkbox", { name: "Agree", exact: true }).waitFor();
  assert.equal(await page.getByRole("checkbox", { name: "Agree", exact: true }).isChecked(), true);
  await page.getByRole("button", { name: "Save & next", exact: true }).click();
  await page.getByLabel("Color", { exact: true }).selectOption("Blue");
  await page.getByRole("button", { name: "Save field", exact: true }).click();
  await waitForSaved();
  await page.screenshot({ path: join(directory, "editing.png"), fullPage: true });
  await page.getByRole("button", { name: "Close page review", exact: true }).click();
  await page.getByTestId("editor-download-options-button").click();
  assert.equal(
    await page.getByTestId("editor-compress-button").getAttribute("aria-disabled"),
    "true"
  );
  const pngZip = await downloadFrom("editor-export-images-button", "pages.zip");
  const pngs = Object.values(unzipSync(pngZip));
  assert.equal(pngs.length, 1);
  assert.deepEqual(Array.from(pngs[0].subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  const editedBytes = await downloadFrom("editor-download-button", "edited.pdf");
  const edited = engine.open(editedBytes);
  const content = engine.content(edited.id, 1);
  assert.deepEqual(
    content.text.map((run) => run.text),
    ["New phrase", "Added line"]
  );
  assert.equal(content.fields[0].value, "Alice");
  assert.equal(content.fields[1].checked, true);
  assert.equal(content.fields[2].value, "Blue");

  const sharedPath = join(directory, "shared.pdf");
  await writeFile(sharedPath, sharedFormBytes());
  const pngPath = join(directory, "image.png"),
    jpegPath = join(directory, "image.jpg");
  await writeFile(pngPath, new Uint8Array(await createPngFile().arrayBuffer()));
  await writeFile(jpegPath, new Uint8Array(await createJpegFile("image.jpg", true).arrayBuffer()));
  await openFiles([sharedPath, pngPath, jpegPath]);
  assert.equal(await page.getByTestId("editor-page-canvas").count(), 4);
  const mixed = engine.open(await downloadFrom("editor-download-button", "mixed.pdf"));
  assert.equal(mixed.count, 4);
  assert.equal(
    engine.content(mixed.id, 1).fields[0].name,
    engine.content(mixed.id, 2).fields[0].name
  );
  await page.getByTestId("editor-files-button").click();
  await page.getByTestId("editor-file-remove").last().click();
  await page.getByTestId("editor-files-close-button").click();
  assert.equal(await page.getByTestId("editor-page-canvas").count(), 2);

  await page.getByTestId("editor-add-pdf-input").setInputFiles([formPath]);
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="editor-page-canvas"]').length === 3
  );
  const readded = engine.open(await downloadFrom("editor-download-button", "readded.pdf"));
  assert.equal(readded.count, 3);
  assert.equal(engine.content(readded.id, 3).fields[0].value, "Before");

  const encryptedPath = join(directory, "encrypted.pdf");
  const encrypted = Buffer.from(
    await readFile(
      new URL("../qpdf-wasm/fixtures/encrypted-256-bit-r6.b64", import.meta.url),
      "utf8"
    ),
    "base64"
  );
  await writeFile(encryptedPath, encrypted);
  await page.goto(`${origin}/app/`);
  await page.locator("input[type=file]").first().setInputFiles(encryptedPath);
  await page.getByLabel("PDF password").fill("wwwww");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await page.locator("[data-testid=editor-page-canvas][data-render-state=ready]").first().waitFor();
  const unlocked = engine.open(await downloadFrom("editor-download-button", "unlocked.pdf"));
  assert.ok(engine.content(unlocked.id, 1).text.length > 0);

  const blank = await createPdfFile("blank.pdf", [
    { width: 612, height: 792 },
    { width: 612, height: 792 },
  ]);
  const blankPath = join(directory, "blank.pdf");
  await writeFile(blankPath, new Uint8Array(await blank.arrayBuffer()));
  const mobileContext = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 390, height: 844 },
    isMobile: browserName !== "firefox",
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  page = await mobileContext.newPage();
  observe(mobileContext, page);
  await openFiles([blankPath]);
  await page.getByRole("button", { name: "Review pages", exact: true }).click();
  await page.getByRole("button", { name: "Edit page", exact: true }).click();
  await page.getByRole("button", { name: "Fill forms", exact: true }).tap();
  await page
    .getByText("No interactive fields. Tap the page to add text.", { exact: true })
    .waitFor();
  const fittedWidth = await page
    .locator(".editor-review-page")
    .evaluate((element) => element.clientWidth);
  assert.ok(fittedWidth >= 342, `Mobile document should use page width: ${fittedWidth}`);
  assert.equal(await page.locator(".editor-content-composer").count(), 0);
  assert.equal(await page.locator(".editor-review-filmstrip").isVisible(), false);
  await page.getByRole("button", { name: "Zoom in", exact: true }).tap();
  await page.waitForFunction(
    (width) => document.querySelector(".editor-review-page").clientWidth > width * 1.3,
    fittedWidth
  );
  const pan = await page.locator(".editor-review-stage").evaluate((stage) => {
    stage.scrollLeft = 40;
    stage.scrollTop = 40;
    return { horizontal: stage.scrollLeft, vertical: stage.scrollTop };
  });
  assert.ok(pan.horizontal > 0 && pan.vertical > 0, "Zoomed document must pan in both directions");
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    "Zoomed paper must scroll inside the viewer without widening the screen"
  );
  await page.getByRole("button", { name: "Fit page", exact: true }).tap();
  await page.waitForFunction(
    (width) => Math.abs(document.querySelector(".editor-review-page").clientWidth - width) <= 1,
    fittedWidth
  );
  await pinchWithoutPlacing(mobileContext);
  await page.waitForFunction(
    (width) => Math.abs(document.querySelector(".editor-review-page").clientWidth - width) <= 1,
    fittedWidth
  );
  await placeText(0.2, 0.35, true);
  await page.getByLabel("Text", { exact: true }).fill("Café");
  await page
    .locator(".editor-content-composer")
    .getByRole("button", { name: "Add text", exact: true })
    .tap();
  await page.getByRole("alert").filter({ hasText: "basic Latin" }).waitFor();
  assert.equal(await page.getByLabel("Text", { exact: true }).inputValue(), "Café");
  assert.equal(
    await page.getByRole("button", { name: "Close page review", exact: true }).isDisabled(),
    true
  );
  await page.getByRole("button", { name: "Cancel edit", exact: true }).tap();
  await page.getByRole("status").filter({ hasText: "Draft cancelled" }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Close page review", exact: true }).isEnabled(),
    true
  );
  await placeText(0.2, 0.35, true);
  await page.getByLabel("Text", { exact: true }).fill("Mobile");
  await page.screenshot({ path: join(directory, "mobile-typing.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 430 });
  await page.waitForTimeout(200);
  await assertVisibleInViewport(
    page.getByLabel("Text", { exact: true }),
    "Text input with emulated keyboard height"
  );
  assert.equal(await page.getByLabel("Text", { exact: true }).inputValue(), "Mobile");
  await assertVisibleInViewport(
    page.locator(".editor-content-composer").getByRole("button", { name: "Add text", exact: true }),
    "Apply action with emulated keyboard height"
  );
  await page.screenshot({ path: join(directory, "mobile-short-viewport.png"), fullPage: true });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(200);
  await assertVisibleInViewport(page.getByLabel("Text", { exact: true }), "Landscape text input");
  assert.equal(await page.getByLabel("Text", { exact: true }).inputValue(), "Mobile");
  await assertVisibleInViewport(
    page.locator(".editor-content-composer").getByRole("button", { name: "Add text", exact: true }),
    "Landscape Apply action"
  );
  const landscape = await page.evaluate(() => {
    const stage = document.querySelector(".editor-review-stage");
    const frame = document.querySelector(".editor-review-page");
    return {
      stageWidth: stage.clientWidth,
      stageHeight: stage.clientHeight,
      frameWidth: frame.clientWidth,
      frameStyle: frame.style.cssText,
      innerWidth: window.innerWidth,
      coarse: window.matchMedia("(pointer: coarse)").matches,
      viewportScale: window.visualViewport?.scale,
      zoomInDisabled: document.querySelector('[aria-label="Zoom in"]').disabled,
      zoomOutDisabled: document.querySelector('[aria-label="Zoom out"]').disabled,
    };
  });
  assert.ok(
    landscape.frameWidth >= 400,
    `Landscape document must remain readable: ${JSON.stringify(landscape)}`
  );
  await page.screenshot({ path: join(directory, "mobile-landscape.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  await applyText("Mobile", "Add text");
  await page.getByRole("button", { name: "Next page", exact: true }).tap();
  await page.getByTestId("editor-viewer-title").filter({ hasText: "Page 2" }).waitFor();
  await page.getByRole("button", { name: "Previous page", exact: true }).tap();
  await page.getByTestId("editor-viewer-title").filter({ hasText: "Page 1" }).waitFor();
  await page.screenshot({ path: join(directory, "mobile.png"), fullPage: true });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true
  );
  await page.getByRole("button", { name: "Close page review", exact: true }).tap();
  const mobilePDF = engine.open(await downloadFrom("editor-download-button", "mobile.pdf"));
  assert.equal(mobilePDF.count, 2);
  assert.deepEqual(
    engine.content(mobilePDF.id, 1).text.map((run) => run.text),
    ["Mobile"]
  );
  assert.deepEqual(engine.content(mobilePDF.id, 2).text, []);

  await openFiles([formPath]);
  await page.getByRole("button", { name: "Review pages", exact: true }).tap();
  await page.getByRole("button", { name: "Edit page", exact: true }).tap();
  await page.getByRole("button", { name: "Fill forms", exact: true }).tap();
  await page.getByRole("button", { name: "Check Agree", exact: true }).tap();
  await page.getByRole("button", { name: "Uncheck Agree", exact: true }).waitFor();
  await page.getByRole("button", { name: "Fill Name", exact: true }).tap();
  await page.getByLabel("Name", { exact: true }).fill("Phone");
  await page.screenshot({ path: join(directory, "mobile-forms.png"), fullPage: true });
  await page.getByRole("button", { name: "Save field", exact: true }).tap();
  await waitForSaved();
  await page.getByRole("button", { name: "Close page review", exact: true }).tap();
  const mobileForm = engine.open(await downloadFrom("editor-download-button", "mobile-form.pdf"));
  assert.equal(engine.content(mobileForm.id, 1).fields[0].value, "Phone");
  assert.equal(engine.content(mobileForm.id, 1).fields[1].checked, true);
  assert.deepEqual(errors, []);
  assert.deepEqual(
    requests.filter(
      (request) => !request.url.startsWith(`${origin}/`) && !request.url.startsWith("blob:")
    ),
    []
  );
  assert.deepEqual(
    requests.filter((request) => request.method !== "GET"),
    []
  );
  process.stdout.write(
    `PASS ${browserName}: direct text placement/replacement, native forms and guided navigation, PNG ZIP, mixed files, file removal, add files, password export, compression, mobile zoom/flat-form/draft recovery/short viewport/landscape, and privacy. Artifacts: ${directory}\n`
  );
} catch (error) {
  await page.screenshot({ path: join(directory, "failure.png"), fullPage: true });
  process.stderr.write(`Browser errors: ${JSON.stringify(errors)}. Artifacts: ${directory}\n`);
  throw error;
} finally {
  engine.dispose();
  await browser.close();
}
