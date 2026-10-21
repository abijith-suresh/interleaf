import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { init } from "@embedpdf/pdfium";
import { unzipSync } from "fflate";
import {
  createJpegFile,
  createPdfBytes,
  createPdfFile,
  createPngFile,
  formBytes,
  sharedFormBytes,
} from "../../src/experimental/pdfium/services/__tests__/pdf-fixtures.ts";
import { PDFiumEngine } from "../../src/experimental/pdfium/services/pdfium/engine.ts";

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

async function assertRouteIsolation() {
  const appearance = () =>
    page.evaluate(() => {
      const selectors = ["body", ".editor-header", ".editor-dropzone"];
      return selectors.map((selector) => {
        const style = getComputedStyle(document.querySelector(selector));
        return [style.backgroundColor, style.padding, style.fontSize, style.height];
      });
    });
  const navigate = async (path) => {
    await page.evaluate((href) => {
      const link = document.createElement("a");
      link.href = href;
      link.textContent = "Route isolation check";
      link.id = "route-isolation-check";
      link.style.cssText = "position:fixed;top:0;left:0;z-index:9999;background:white";
      document.body.append(link);
    }, path);
    await page.locator("#route-isolation-check").click();
    await page.waitForURL(`${origin}${path}`);
    await page.getByTestId("editor-upload-input").waitFor({ state: "attached" });
  };

  await page.goto(`${origin}/app/`);
  await page.getByTestId("editor-upload-input").waitFor({ state: "attached" });
  assert.equal(await page.locator('a[href*="pdfium"]').count(), 0);
  const baseline = await appearance();
  await page.evaluate(() => {
    window.__pdfiumRouteIsolation = true;
  });
  await navigate("/pdfium/");
  assert.equal(await page.title(), "Experimental PDFium workspace — Interleaf");
  assert.equal(
    await page.locator('meta[name="robots"]').getAttribute("content"),
    "noindex, nofollow"
  );
  await page.getByText("Experimental", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__pdfiumRouteIsolation), true);
  const css = await page.evaluate(() =>
    Array.from(document.styleSheets)
      .flatMap((sheet) => Array.from(sheet.cssRules, (rule) => rule.cssText))
      .filter((rule) => rule.includes("pdfium-experiment"))
      .join("\n")
  );
  assert.ok(css.includes("@scope"));
  await navigate("/app/");
  assert.equal(await page.evaluate(() => window.__pdfiumRouteIsolation), true);
  // Also verify a retained experimental stylesheet cannot change the default editor.
  await page.addStyleTag({ content: css });
  assert.deepEqual(await appearance(), baseline);
  assert.equal(await page.getByText("Experimental", { exact: true }).count(), 0);
  const sitemap = await (await page.request.get(`${origin}/sitemap-0.xml`)).text();
  assert.equal(sitemap.includes("/pdfium/"), false);
}

async function openFiles(files) {
  await page.goto(`${origin}/pdfium/`);
  await page.locator("input[type=file]").first().setInputFiles(files);
  await page.locator("[data-testid=editor-page-canvas][data-render-state=ready]").first().waitFor();
}
async function chooseTool(name, touch = false) {
  const rail = page.locator(".editor-tool-rail");
  if (name === "Document") {
    await rail.getByRole("button", { name, exact: true })[touch ? "tap" : "click"]();
  } else {
    const direct = rail.getByRole("button", { name, exact: true });
    if (await direct.isVisible()) {
      await direct[touch ? "tap" : "click"]();
    } else {
      await rail.getByRole("button", { name: /^Tools/ })[touch ? "tap" : "click"]();
      const picker = page.getByRole("dialog", { name: "PDF tools", exact: true });
      await picker.getByRole("button", { name: new RegExp(`^${name}`) })[touch ? "tap" : "click"]();
      await picker.waitFor({ state: "hidden" });
    }
  }
  await page.getByTestId("editor-page-viewer").waitFor();
}
async function backToPages(touch = false) {
  const back = page.getByRole("button", { name: "Back to pages", exact: true });
  const target = (await back.isVisible())
    ? back
    : page
        .getByRole("navigation", { name: "Workspace views", exact: true })
        .getByRole("button", { name: "Pages", exact: true });
  await target[touch ? "tap" : "click"]();
  await page.getByTestId("editor-page-grid").waitFor();
}
async function assertMobileToolPicker() {
  const rail = page.locator(".editor-tool-rail");
  assert.deepEqual(await rail.locator("button:visible > span").allTextContents(), [
    "Pages",
    "Document",
    "Tools",
  ]);
  const trigger = rail.getByRole("button", { name: /^Tools/ });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const picker = page.getByRole("dialog", { name: "PDF tools", exact: true });
  assert.equal(
    await picker.evaluate(
      (dialog) => dialog instanceof HTMLDialogElement && dialog.matches(":modal")
    ),
    true
  );
  assert.equal(await trigger.getAttribute("aria-expanded"), "true");
  assert.deepEqual(await picker.locator("button strong").allTextContents(), [
    "Add text",
    "Edit text",
    "Fill forms",
  ]);
  const first = picker.getByRole("button", { name: "Close tools", exact: true });
  const last = picker.getByRole("button", { name: /^Fill forms/ });
  const assertModalFocus = async (key) => {
    // Browser chrome can retain the previous DOM focus or expose body at a native modal boundary.
    if (await page.evaluate(() => document.activeElement === document.body))
      await page.keyboard.press(key);
    assert.equal(
      await picker.evaluate((dialog) => dialog.contains(document.activeElement)),
      true,
      "Native modal must keep background document controls out of keyboard navigation"
    );
  };
  await last.focus();
  await page.keyboard.press("Tab");
  await assertModalFocus("Tab");
  await first.focus();
  await page.keyboard.press("Shift+Tab");
  await assertModalFocus("Shift+Tab");
  await last.focus();
  await page.keyboard.press("Shift+Tab");
  assert.equal(
    await picker
      .getByRole("button", { name: "Edit text", exact: true })
      .evaluate((button) => document.activeElement === button),
    true
  );
  await page.keyboard.press("Tab");
  assert.equal(await last.evaluate((button) => document.activeElement === button), true);
  await page.keyboard.press("Escape");
  await picker.waitFor({ state: "hidden" });
  assert.equal(
    await page.getByTestId("editor-page-viewer").isVisible(),
    true,
    "Escape closes Tools while preserving Document"
  );
  assert.equal(await trigger.evaluate((button) => document.activeElement === button), true);
  await trigger.tap();
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(200);
  assert.equal(await picker.isVisible(), true, "Tools stays modal across compact orientations");
  await page.keyboard.press("Escape");
  await picker.waitFor({ state: "hidden" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  assert.deepEqual(await rail.locator("button:visible > span").allTextContents(), [
    "Pages",
    "Document",
    "Tools",
  ]);
}
async function resetFitWidth(touch = false) {
  const fit = page.getByRole("button", { name: "Fit page", exact: true });
  // The Fit action alternates between fitting the complete page and fitting its width.
  if ((await fit.innerText()).trim() === "Fit") {
    await fit[touch ? "tap" : "click"]();
    await page.waitForFunction(
      () => document.querySelector('[aria-label="Fit page"]').textContent.trim() === "Width"
    );
  }
  await fit[touch ? "tap" : "click"]();
  assert.equal((await fit.innerText()).trim(), "Fit");
  assert.equal(
    await page.getByRole("button", { name: "Zoom out", exact: true }).isDisabled(),
    true
  );
}
async function downloadFrom(testId, name, trigger = page.getByTestId(testId)) {
  const [download] = await Promise.all([page.waitForEvent("download"), trigger.click()]);
  const path = join(directory, name);
  await download.saveAs(path);
  return new Uint8Array(await readFile(path));
}
async function travelHistory(label, redo = false, touch = false) {
  const button = page
    .getByRole("button", { name: `${redo ? "Redo" : "Undo"} ${label}`, exact: true })
    .filter({ visible: true })
    .last();
  await button.waitFor();
  await page.waitForFunction(
    (name) =>
      Array.from(document.querySelectorAll("button")).some(
        (button) =>
          button.getAttribute("aria-label") === name &&
          !button.disabled &&
          button.getClientRects().length
      ),
    `${redo ? "Redo" : "Undo"} ${label}`
  );
  await button[touch ? "tap" : "click"]();
  await page.waitForFunction(
    (text) =>
      Array.from(document.querySelectorAll('[role="status"]')).some((node) =>
        node.textContent.includes(text)
      ),
    `${redo ? "Redid" : "Undid"} ${label}.`
  );
  const opposite = page
    .getByRole("button", { name: `${redo ? "Undo" : "Redo"} ${label}`, exact: true })
    .filter({ visible: true })
    .last();
  await opposite.waitFor();
  await page.waitForFunction(
    (name) =>
      Array.from(document.querySelectorAll("button")).some(
        (button) =>
          button.getAttribute("aria-label") === name &&
          !button.disabled &&
          button.getClientRects().length
      ),
    `${redo ? "Undo" : "Redo"} ${label}`
  );
}
async function viewerOutput(name) {
  const bytes = await downloadFrom(
    "editor-download-button",
    name,
    page.getByTestId("editor-page-viewer").getByRole("button", { name: /^Download PDF/ })
  );
  const document = engine.open(bytes);
  return { document, content: engine.content(document.id, 1) };
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
async function placeText(x = 0.17, y = 0.88, touch = false, placementLabel = "Place text on page") {
  const placement = page.getByRole("button", { name: placementLabel, exact: true });
  const box = await placement.boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0);
  await placement[touch ? "tap" : "click"]({
    position: { x: box.width * x, y: box.height * y },
  });
  if (placementLabel === "Place X mark on page") {
    await page.getByRole("button", { name: "Add X mark", exact: true }).waitFor();
    assert.equal(await page.getByRole("textbox").count(), 0, "X marks do not open a text input");
    assert.equal(
      await page.evaluate(() => document.activeElement?.tagName === "INPUT"),
      false,
      "X marks must not focus a text input or summon the mobile keyboard"
    );
  } else await page.getByLabel("Text", { exact: true }).waitFor();
}
async function saveXMark(touch = false) {
  await page.getByRole("button", { name: "Add X mark", exact: true })[touch ? "tap" : "click"]();
  await waitForSaved();
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
async function assertDraftWithinStage() {
  const draft = await page
    .getByRole("button", { name: "Move draft text", exact: true })
    .boundingBox();
  const stage = await page.locator(".editor-review-stage").boundingBox();
  const composer = await page.locator(".editor-content-composer").boundingBox();
  assert.ok(draft && stage && composer);
  assert.ok(
    draft.x >= stage.x - 1 &&
      draft.y >= stage.y - 1 &&
      draft.x + draft.width <= stage.x + stage.width + 1 &&
      draft.y + draft.height <= Math.min(stage.y + stage.height, composer.y) + 1,
    `Draft must remain visible above the composer: ${JSON.stringify({ draft, stage, composer })}`
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
  await resetFitWidth(true);
}

try {
  await assertRouteIsolation();
  const formPath = join(directory, "forms.pdf");
  await writeFile(formPath, formBytes());
  await openFiles([formPath]);
  assert.equal(await page.getByRole("button", { name: /Review|Edit PDF/ }).count(), 0);
  await page.getByTestId("editor-download-options-button").click();
  assert.equal(
    await page.getByTestId("editor-compress-button").getAttribute("aria-disabled"),
    "false"
  );
  const compressed = await downloadFrom("editor-compress-button", "compressed.pdf");
  assert.equal(engine.open(compressed).count, 1);

  await chooseTool("Document");
  assert.equal(
    await page.getByRole("navigation", { name: "Workspace views" }).getByRole("button").count(),
    2
  );
  assert.equal(await page.getByRole("group", { name: "PDF tools" }).getByRole("button").count(), 3);
  assert.equal(await page.getByRole("button", { name: /^(Rotate|Duplicate|Delete)$/ }).count(), 0);
  assert.equal(await page.locator(".editor-content-tool-context").count(), 0);
  await chooseTool("Add text");
  assert.equal(await page.getByRole("button", { name: "Place text", exact: true }).count(), 0);
  assert.equal(
    await page.getByRole("button", { name: "Choose from list", exact: true }).count(),
    0
  );
  assert.equal(await page.locator(".editor-content-toolbar").count(), 0);
  await placeText();
  await applyText("Added line", "Add text");
  await travelHistory("add text");
  assert.equal(
    (await viewerOutput("undo-added.pdf")).content.text.some((run) => run.text === "Added line"),
    false
  );
  await travelHistory("add text", true);
  assert.equal(
    (await viewerOutput("redo-added.pdf")).content.text.some((run) => run.text === "Added line"),
    true
  );
  await placeText(0.35, 0.4);
  await page.getByRole("button", { name: "Rotate draft text 90 degrees", exact: true }).click();
  await applyText("Turned", "Add text");
  await chooseTool("Edit text");
  await page.getByRole("button", { name: "Edit Original phrase", exact: true }).click();
  await applyText("New phrase", "Replace text");
  await page.getByRole("button", { name: "Edit New phrase", exact: true }).click();
  assert.equal(await page.getByLabel("Text", { exact: true }).inputValue(), "New phrase");
  assert.equal(
    await page.getByRole("button", { name: "Replace text", exact: true }).isDisabled(),
    true
  );
  await travelHistory("replace text");
  assert.equal(
    await page.locator(".editor-content-composer").count(),
    0,
    "Undo must close a clean original-text inspector instead of retaining stale content"
  );
  await page.getByRole("button", { name: "Edit Original phrase", exact: true }).waitFor();
  assert.equal((await viewerOutput("undo-replaced.pdf")).content.text[0].text, "Original phrase");
  await travelHistory("replace text", true);
  await page.getByRole("button", { name: "Edit New phrase", exact: true }).waitFor();
  await chooseTool("Fill forms");
  await page.getByText("3 interactive fields", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Check Agree", exact: true }).click();
  await page.getByRole("button", { name: "Uncheck Agree", exact: true }).waitFor();
  await travelHistory("fill field");
  await page.getByRole("button", { name: "Check Agree", exact: true }).waitFor();
  assert.equal((await viewerOutput("undo-checkbox.pdf")).content.fields[1].checked, false);
  await travelHistory("fill field", true);
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
  await page.getByRole("button", { name: "Fill Color", exact: true }).click();
  assert.equal(await page.getByLabel("Color", { exact: true }).inputValue(), "Blue");
  assert.equal(
    await page.getByRole("button", { name: "Save field", exact: true }).isDisabled(),
    true
  );
  await travelHistory("fill field");
  assert.equal(
    await page.locator(".editor-content-composer").count(),
    0,
    "Undo must close a clean field inspector instead of retaining stale values"
  );
  assert.equal(
    (await viewerOutput("undo-clean-color-inspector.pdf")).content.fields[2].value,
    "Red"
  );
  await page.getByRole("button", { name: "Fill Color", exact: true }).click();
  assert.equal(await page.getByLabel("Color", { exact: true }).inputValue(), "Red");
  await travelHistory("fill field", true);
  assert.equal(
    await page.locator(".editor-content-composer").count(),
    0,
    "Redo must also refresh a clean field inspector"
  );
  assert.equal(
    (await viewerOutput("redo-clean-color-inspector.pdf")).content.fields[2].value,
    "Blue"
  );
  await page.getByRole("button", { name: "Place form text", exact: true }).click();
  await placeText(0.3, 0.75, false, "Fill blank on page");
  assert.match(
    await page.locator(".editor-content-preview text").getAttribute("transform"),
    /^rotate\(0 /,
    "Entering form filling starts horizontal despite a prior Add text rotation"
  );
  await applyText("Manual answer", "Fill text");
  await page.getByRole("button", { name: "Place X mark", exact: true }).click();
  await placeText(0.8, 0.7, false, "Place X mark on page");
  await saveXMark();
  await placeText(0.8, 0.8, false, "Place X mark on page");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Fill existing fields", exact: true }).click();
  await page.getByRole("button", { name: "Fill Name", exact: true }).click();
  assert.equal(await page.getByLabel("Name", { exact: true }).inputValue(), "Alice");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.screenshot({ path: join(directory, "editing.png"), fullPage: true });
  await backToPages();
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
    ["New phrase", "Added line", "Turned", "Manual answer", "X"]
  );
  assert.equal(content.fields[0].value, "Alice");
  assert.equal(content.fields[1].checked, true);
  assert.equal(content.fields[2].value, "Blue");
  const turned = content.text.find((run) => run.text === "Turned");
  assert.ok(turned?.bounds);
  assert.ok(
    turned.bounds.height > turned.bounds.width * 2,
    "Exported text must retain 90° rotation"
  );
  assert.equal(turned.editable, false, "Original rotated-text replacement stays unsupported");

  await backToPages();
  await page.getByRole("button", { name: "Duplicate page 1", exact: true }).click();
  await page.getByRole("button", { name: "Page 2", exact: true }).waitFor();
  await travelHistory("duplicate page");
  assert.equal(await page.getByTestId("editor-page-tile").count(), 1);
  await travelHistory("duplicate page", true);
  assert.equal(await page.getByTestId("editor-page-tile").count(), 2);
  await chooseTool("Document");
  await page
    .getByRole("combobox", { name: "Go to page", exact: true })
    .selectOption({ label: "2" });
  await page.getByRole("heading", { name: "Page 2", exact: true }).waitFor();
  await chooseTool("Fill forms");
  await page.getByRole("button", { name: "Fill Name", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Copy only");
  await page.getByRole("button", { name: "Save field", exact: true }).click();
  await waitForSaved();
  await travelHistory("fill field");
  const undoCopy = (await viewerOutput("undo-copy-field.pdf")).document;
  assert.equal(engine.content(undoCopy.id, 1).fields[0].value, "Alice");
  assert.equal(engine.content(undoCopy.id, 2).fields[0].value, "Alice");
  await travelHistory("fill field", true);
  const duplicated = engine.open(
    await downloadFrom(
      "editor-download-button",
      "duplicated.pdf",
      page.getByRole("dialog").getByRole("button", { name: /^Download PDF/ })
    )
  );
  await backToPages();
  assert.equal(await page.getByTestId("editor-selection-title").innerText(), "1 selected");
  const extractedCopy = engine.open(await downloadFrom("editor-download-button", "copy.pdf"));
  assert.equal(extractedCopy.count, 1);
  assert.equal(engine.content(extractedCopy.id, 1).fields[0].value, "Copy only");
  assert.equal(duplicated.count, 2);
  const originalFields = engine.content(duplicated.id, 1).fields;
  const copiedFields = engine.content(duplicated.id, 2).fields;
  assert.equal(
    originalFields[0].value,
    "Alice",
    "Editing a copied field must preserve the original page"
  );
  assert.equal(copiedFields[0].value, "Copy only");
  assert.notEqual(originalFields[0].name, copiedFields[0].name);
  assert.deepEqual(
    engine.content(duplicated.id, 2).text.map((run) => run.text),
    ["New phrase", "Added line", "Turned", "Manual answer", "X"]
  );

  await page.getByTestId("editor-files-button").click();
  await page.getByTestId("editor-file-remove").click();
  await page
    .getByRole("button", { name: "Choose PDF or image files, or drop them here", exact: true })
    .waitFor();
  await travelHistory("remove file");
  assert.equal(await page.getByTestId("editor-page-tile").count(), 2);
  await chooseTool("Document");
  const restoredRemoved = (await viewerOutput("undo-removed-original-and-copy.pdf")).document;
  assert.equal(engine.content(restoredRemoved.id, 1).fields[0].value, "Alice");
  assert.equal(engine.content(restoredRemoved.id, 2).fields[0].value, "Copy only");
  await backToPages();

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
  await travelHistory("add files");
  assert.equal(await page.getByTestId("editor-page-tile").count(), 2);
  await travelHistory("add files", true);
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
  await page.goto(`${origin}/pdfium/`);
  await page.locator("input[type=file]").first().setInputFiles(encryptedPath);
  await page.getByLabel("PDF password").waitFor();
  assert.equal(
    await page
      .locator(".password-modal-backdrop")
      .evaluate((node) => getComputedStyle(node).position),
    "fixed"
  );
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
  const flatCommands = [
    "BT /F1 20 Tf 40 740 Td (Registration form) Tj ET",
    "BT /F1 12 Tf 40 690 Td (Name) Tj ET",
    "170 660 350 30 re S",
    "BT /F1 12 Tf 65 620 Td (I agree) Tj ET",
    "40 615 16 16 re S",
    "170 560 m 450 560 l S",
  ].join("\n");
  const flatPath = join(directory, "flat-form.pdf");
  await writeFile(
    flatPath,
    createPdfBytes([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      `<< /Length ${flatCommands.length} >>\nstream\n${flatCommands}\nendstream`,
    ])
  );
  await openFiles([flatPath]);
  await chooseTool("Fill forms", true);
  await page.getByText("Tap a blank to fill.", { exact: true }).waitFor();
  await assertMobileToolPicker();
  assert.equal(
    await page.getByRole("region", { name: "Page content" }).getAttribute("data-tool"),
    "forms",
    "Flat form filling stays inside the Fill forms tool"
  );
  assert.equal(
    await page.getByRole("button", { name: "Fill existing fields", exact: true }).count(),
    0
  );
  assert.equal(await page.locator(".editor-content-composer").count(), 0);
  const toolContext = page.locator(".editor-content-tool-context");
  assert.equal(
    await toolContext.getAttribute("role"),
    null,
    "Static instructions must not be live status"
  );
  const instructionBounds = await toolContext.boundingBox();
  const stageBounds = await page.locator(".editor-review-stage").boundingBox();
  assert.ok(instructionBounds && stageBounds);
  assert.ok(
    Math.abs(instructionBounds.x - stageBounds.x) <= 1 &&
      Math.abs(instructionBounds.width - stageBounds.width) <= 1 &&
      Math.abs(instructionBounds.y - stageBounds.y) <= 1,
    "Tool instructions must attach to the full width of the document stage"
  );
  assert.equal(await page.locator(".editor-content-guidance").count(), 0);
  const flatSuggestionCount = engine.content(
    engine.open(new Uint8Array(await readFile(flatPath))).id,
    1
  ).suggestions;
  assert.equal(flatSuggestionCount.filter((item) => item.kind === "text").length, 2);
  assert.equal(flatSuggestionCount.filter((item) => item.kind === "checkbox").length, 1);
  assert.equal(
    await page.getByRole("button", { name: "Fill suggested blank", exact: true }).count(),
    2
  );
  await page.getByRole("button", { name: "Fill suggested blank", exact: true }).first().tap();
  await assertDraftWithinStage();
  await applyText("Completed on phone", "Fill text");
  await travelHistory("fill blank", false, true);
  assert.equal(
    (await viewerOutput("undo-flat-answer.pdf")).content.text.some(
      (run) => run.text === "Completed on phone"
    ),
    false
  );
  await travelHistory("fill blank", true, true);
  await page.getByRole("button", { name: "Mark suggested checkbox", exact: true }).tap();
  assert.equal(await page.getByRole("textbox").count(), 0);
  await assertDraftWithinStage();
  await saveXMark(true);
  await travelHistory("mark checkbox", false, true);
  assert.equal(
    (await viewerOutput("undo-flat-mark.pdf")).content.text.some((run) => run.text === "X"),
    false
  );
  await travelHistory("mark checkbox", true, true);
  await page.getByRole("button", { name: "Place form text", exact: true }).tap();
  await placeText(0.3, 0.4, true, "Fill blank on page");
  await page.getByLabel("Text", { exact: true }).fill("Cancelled answer");
  await page.getByRole("button", { name: "Cancel", exact: true }).tap();
  await page.getByRole("button", { name: "Place form text", exact: true }).tap();
  await page.screenshot({ path: join(directory, "mobile-flat-form.png"), fullPage: true });
  await backToPages(true);
  const completedFlat = engine.open(
    await downloadFrom("editor-download-button", "completed-flat-form.pdf")
  );
  const flatContent = engine.content(completedFlat.id, 1);
  assert.deepEqual(
    flatContent.text.map((run) => run.text),
    ["Registration form", "Name", "I agree", "Completed on phone", "X"]
  );
  assert.deepEqual(
    flatContent.fields,
    [],
    "Filling a flat form adds page content, not interactive fields"
  );

  const rotate = page.getByRole("button", { name: "Rotate page 1 90 degrees", exact: true });
  const initialButtonStyle = await rotate.evaluate((button) => ({
    background: getComputedStyle(button).backgroundColor,
    shadow: getComputedStyle(button).boxShadow,
  }));
  await rotate.tap();
  const tappedButtonStyle = await rotate.evaluate((button) => ({
    background: getComputedStyle(button).backgroundColor,
    shadow: getComputedStyle(button).boxShadow,
  }));
  assert.deepEqual(
    tappedButtonStyle,
    initialButtonStyle,
    "Touch commands must return to idle styling rather than keep hover or pressed shading"
  );
  assert.equal(
    await rotate.evaluate((button) => button.matches(":focus-visible")),
    false,
    "Tapping must not create a keyboard-only focus ring"
  );
  await travelHistory("rotate page", false, true);
  const undoRotation = engine.open(
    await downloadFrom("editor-download-button", "undo-mobile-rotation.pdf")
  );
  assert.equal(engine.info(undoRotation.id, 1, 0).rotation, 0);
  await travelHistory("rotate page", true, true);
  const redoRotation = engine.open(
    await downloadFrom("editor-download-button", "redo-mobile-rotation.pdf")
  );
  assert.equal(engine.info(redoRotation.id, 1, 0).rotation, 90);
  await travelHistory("rotate page", false, true);
  await page.getByRole("button", { name: "Mark page 1 for deletion", exact: true }).tap();
  assert.equal(
    await page.getByTestId("editor-page-tile").getAttribute("data-marked-for-deletion"),
    "true"
  );
  await travelHistory("delete page", false, true);
  assert.equal(
    await page.getByTestId("editor-page-tile").getAttribute("data-marked-for-deletion"),
    "false"
  );
  assert.equal(
    await page.getByRole("button", { name: "Redo delete page", exact: true }).isEnabled(),
    true
  );
  await rotate.tap();
  assert.equal(
    await page.getByRole("button", { name: "Redo", exact: true }).isDisabled(),
    true,
    "A new edit discards redo history"
  );

  const scanPath = join(directory, "image-only-form.pdf");
  await writeFile(
    scanPath,
    engine.images([
      { kind: "jpeg", bytes: new Uint8Array(await readFile(jpegPath)), orientation: 6 },
    ])
  );
  assert.deepEqual(
    engine.content(engine.open(new Uint8Array(await readFile(scanPath))).id, 1).suggestions,
    []
  );
  await openFiles([scanPath]);
  await chooseTool("Fill forms", true);
  await page.getByText("Tap a blank to fill.", { exact: true }).waitFor();
  await placeText(0.15, 0.3, true, "Fill blank on page");
  await applyText("Scan answer", "Fill text");
  await backToPages(true);
  const completedScan = engine.open(
    await downloadFrom("editor-download-button", "completed-image-form.pdf")
  );
  assert.deepEqual(
    engine.content(completedScan.id, 1).text.map((run) => run.text),
    ["Scan answer"]
  );
  assert.deepEqual(engine.content(completedScan.id, 1).fields, []);

  await openFiles([blankPath]);
  await chooseTool("Add text", true);
  await page.getByText("Tap the page to place text.", { exact: true }).waitFor();
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
  await resetFitWidth(true);
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
    await page.getByRole("button", { name: "Back to pages", exact: true }).isDisabled(),
    true
  );
  await page
    .locator(".editor-content-composer")
    .getByRole("button", { name: "Cancel", exact: true })
    .tap();
  await page.getByRole("status").filter({ hasText: "Draft cancelled" }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Back to pages", exact: true }).isEnabled(),
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
  await assertDraftWithinStage();
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
  await page.getByRole("heading", { name: "Page 2", exact: true }).waitFor();
  await page.getByRole("button", { name: "Previous page", exact: true }).tap();
  await page.getByRole("heading", { name: "Page 1", exact: true }).waitFor();
  await page.screenshot({ path: join(directory, "mobile.png"), fullPage: true });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true
  );
  await backToPages(true);
  const mobilePDF = engine.open(await downloadFrom("editor-download-button", "mobile.pdf"));
  assert.equal(mobilePDF.count, 2);
  assert.deepEqual(
    engine.content(mobilePDF.id, 1).text.map((run) => run.text),
    ["Mobile"]
  );
  assert.deepEqual(engine.content(mobilePDF.id, 2).text, []);

  await openFiles([formPath]);
  await chooseTool("Edit text", true);
  const beforeEdit = await page.locator(".editor-review-stage").evaluate((stage) => ({
    width: stage.querySelector(".editor-review-page").clientWidth,
    left: stage.scrollLeft,
    top: stage.scrollTop,
  }));
  await page.getByRole("button", { name: "Edit Original phrase", exact: true }).tap();
  await page.getByLabel("Text", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByLabel("Text", { exact: true })
      .evaluate((input) => document.activeElement === input),
    true
  );
  await page.waitForFunction(
    (width) => document.querySelector(".editor-review-page").clientWidth > width * 1.05,
    beforeEdit.width
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).tap();
  await page.waitForFunction((view) => {
    const stage = document.querySelector(".editor-review-stage");
    const frame = stage.querySelector(".editor-review-page");
    return (
      Math.abs(frame.clientWidth - view.width) <= 1 &&
      Math.abs(stage.scrollLeft - view.left) <= 1 &&
      Math.abs(stage.scrollTop - view.top) <= 1
    );
  }, beforeEdit);
  await chooseTool("Fill forms", true);
  await page.getByRole("button", { name: "Check Agree", exact: true }).tap();
  await page.getByRole("button", { name: "Uncheck Agree", exact: true }).waitFor();
  await page.getByRole("button", { name: "Fill Name", exact: true }).tap();
  await page.getByLabel("Name", { exact: true }).fill("Phone");
  await page.screenshot({ path: join(directory, "mobile-forms.png"), fullPage: true });
  await page.getByRole("button", { name: "Save field", exact: true }).tap();
  await waitForSaved();
  await backToPages(true);
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
    `PASS ${browserName}: universal workspace, direct text placement/rotation/replacement, undo/redo exported edits and independent duplicates, vector form suggestions, native forms and guided navigation, PNG ZIP, mixed files, file removal, add files, password export, compression, mobile zoom/flat and image form completion/cancelled drafts/native field isolation/short viewport/landscape, and privacy. Artifacts: ${directory}\n`
  );
} catch (error) {
  await page.screenshot({ path: join(directory, "failure.png"), fullPage: true });
  process.stderr.write(`Browser errors: ${JSON.stringify(errors)}. Artifacts: ${directory}\n`);
  throw error;
} finally {
  engine.dispose();
  await browser.close();
}
