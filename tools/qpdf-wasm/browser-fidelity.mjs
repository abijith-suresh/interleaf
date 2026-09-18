import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("http://127.0.0.1:4173/fidelity.html");
  await page.waitForFunction(
    () => /^(PASS|FAIL):/.test(document.querySelector("#output")?.textContent ?? ""),
    undefined,
    { timeout: 180_000 }
  );

  const result = await page.locator("#output").textContent();
  if (!result?.startsWith("PASS:")) throw new Error(result ?? "fidelity test returned no result");
  if (errors.length > 0) throw new Error(`Browser reported errors: ${errors.join("; ")}`);

  const outputs = await page.evaluate(() => window.__fidelityOutputs);
  for (const output of outputs) {
    const loadingTask = getDocument({
      data: Uint8Array.from(output.bytes),
      disableWorker: true,
      password: output.password,
    });
    const document = await loadingTask.promise;
    if (document.numPages !== 1) throw new Error(`${output.name}: unexpected page count`);

    const firstPage = await document.getPage(1);
    if (output.name.includes("forms")) {
      const annotations = await firstPage.getAnnotations({ intent: "display" });
      const fieldTypes = annotations.map((annotation) => annotation.fieldType);
      if (!fieldTypes.includes("Tx") || !fieldTypes.includes("Sig")) {
        throw new Error(`${output.name}: form fields were not preserved`);
      }
      if (!annotations.some((annotation) => annotation.subtype === "Text")) {
        throw new Error(`${output.name}: text annotation was not preserved`);
      }
    }

    if (output.name.includes("image")) {
      const operators = await firstPage.getOperatorList();
      const imageOperators = [
        OPS.paintImageMaskXObject,
        OPS.paintImageXObject,
        OPS.paintInlineImageXObject,
      ];
      if (!operators.fnArray.some((operator) => imageOperators.includes(operator))) {
        throw new Error(`${output.name}: image operator was not preserved`);
      }
    }

    await loadingTask.destroy();
  }
} finally {
  await browser.close();
}
