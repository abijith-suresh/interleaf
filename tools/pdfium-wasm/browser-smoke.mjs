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
const { chromium } = await import(
  runnerPath
    ? pathToFileURL(join(runnerPath, "node_modules/playwright/index.mjs")).href
    : "playwright"
);
const origin = process.argv[2] ?? "http://127.0.0.1:4873";
const directory = await mkdtemp(join(tmpdir(), "interleaf-pdfium-"));
const api = await init({
  wasmBinary: await readFile(
    new URL("../../node_modules/@embedpdf/pdfium/dist/pdfium.wasm", import.meta.url)
  ),
});
const engine = new PDFiumEngine(api);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
const errors = [];
const requests = [];
page.on("pageerror", (error) => errors.push(error.message));
context.on("request", (request) => requests.push({ url: request.url(), method: request.method() }));

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
  await page.getByRole("button", { name: button, exact: true }).last().click();
  await page.getByRole("status").filter({ hasText: "Change applied" }).waitFor();
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
  await applyText("Added line", "Add text");
  await page.getByRole("button", { name: "Edit text", exact: true }).click();
  await page.getByRole("button", { name: "Original phrase", exact: true }).click();
  await applyText("New phrase", "Replace text");
  await page.getByRole("button", { name: "Fill forms", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Alice");
  await page
    .locator("form")
    .filter({ has: page.getByLabel("Name", { exact: true }) })
    .getByRole("button", { name: "Apply field" })
    .click();
  await page.getByRole("status").filter({ hasText: "Change applied" }).waitFor();
  await page.getByLabel("Agree", { exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Change applied" }).waitFor();
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

  const blank = await createPdfFile("blank.pdf", [{ width: 200, height: 300 }]);
  const blankPath = join(directory, "blank.pdf");
  await writeFile(blankPath, new Uint8Array(await blank.arrayBuffer()));
  await page.setViewportSize({ width: 390, height: 844 });
  await openFiles([blankPath]);
  await page.getByRole("button", { name: "Review pages", exact: true }).click();
  await page.getByRole("button", { name: "Edit page", exact: true }).click();
  await page.getByLabel("Width", { exact: true }).fill("150");
  await applyText("Mobile", "Add text");
  await page.screenshot({ path: join(directory, "mobile.png"), fullPage: true });
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
    `PASS: browser editing, forms, PNG ZIP, mixed files, file removal, add files, password export, compression, mobile, and privacy. Artifacts: ${directory}\n`
  );
} catch (error) {
  await page.screenshot({ path: join(directory, "failure.png"), fullPage: true });
  process.stderr.write(`Browser errors: ${JSON.stringify(errors)}. Artifacts: ${directory}\n`);
  throw error;
} finally {
  engine.dispose();
  await browser.close();
}
