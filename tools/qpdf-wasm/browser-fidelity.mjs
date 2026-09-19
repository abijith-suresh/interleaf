import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("WARNING: interleaf input.pdf")) {
      errors.push(message.text());
    }
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
    if (document.numPages !== output.expectedPages) {
      throw new Error(`${output.name}: unexpected page count`);
    }

    const firstPage = await document.getPage(1);
    if (output.text) {
      const textContent = await firstPage.getTextContent();
      const pageText = textContent.items.map((item) => item.str ?? "").join("");
      if (!pageText.includes(output.text)) {
        throw new Error(`${output.name}: expected page text was not preserved`);
      }
    }

    if (output.structured) {
      const annotations = await firstPage.getAnnotations({ intent: "display" });
      const fieldTypes = annotations.map((annotation) => annotation.fieldType);
      if (!fieldTypes.includes("Tx") || !fieldTypes.includes("Sig")) {
        throw new Error(`${output.name}: form fields were not preserved`);
      }

      const hasRect = (annotation, expected) =>
        Array.isArray(annotation?.rect) &&
        annotation.rect.length === expected.length &&
        annotation.rect.every((value, index) => Math.abs(value - expected[index]) < 0.01);
      const textField = annotations.find((annotation) => annotation.fieldType === "Tx");
      if (textField?.fieldValue !== "Interleaf" || !hasRect(textField, [10, 10, 200, 30])) {
        throw new Error(`${output.name}: text form value or geometry was not preserved`);
      }

      const signatureField = annotations.find((annotation) => annotation.fieldType === "Sig");
      if (!signatureField || !hasRect(signatureField, [10, 40, 200, 60])) {
        throw new Error(`${output.name}: unsigned signature field geometry was not preserved`);
      }

      const note = annotations.find((annotation) => annotation.subtype === "Text");
      if (note?.contentsObj?.str !== "fixture note" || !hasRect(note, [10, 78, 32, 100])) {
        throw new Error(`${output.name}: text annotation content or geometry was not preserved`);
      }

      const outline = await document.getOutline();
      if (!outline?.some((item) => item.title === "Fidelity outline")) {
        throw new Error(`${output.name}: outline was not preserved`);
      }
    }

    if (output.image) {
      const operators = await firstPage.getOperatorList();
      const imageOperators = [
        OPS.paintImageMaskXObject,
        OPS.paintImageXObject,
        OPS.paintInlineImageXObject,
      ];
      if (!operators.fnArray.some((operator) => imageOperators.includes(operator))) {
        throw new Error(`${output.name}: image operator was not preserved`);
      }

      const imageIndex = operators.fnArray.findIndex((operator) =>
        imageOperators.includes(operator)
      );
      const imageId = operators.argsArray[imageIndex]?.[0];
      const imageData = typeof imageId === "string" ? firstPage.objs.get(imageId) : null;
      const pixels = imageData?.data;
      if (
        imageData?.width !== 1 ||
        imageData?.height !== 1 ||
        !pixels ||
        pixels[0] !== 255 ||
        pixels[1] !== 0 ||
        pixels[2] !== 0 ||
        (pixels.length > 3 && pixels[3] !== 255)
      ) {
        throw new Error(`${output.name}: decoded image pixels were not preserved`);
      }
    }

    if (output.encrypted) {
      await expectPasswordFailure(output.bytes, undefined, `${output.name}: missing password`);
      await expectPasswordFailure(output.bytes, "wrong", `${output.name}: wrong password`);
    }

    await loadingTask.destroy();
  }
} finally {
  await browser.close();
}

async function expectPasswordFailure(bytes, password, label) {
  const loadingTask = getDocument({
    data: Uint8Array.from(bytes),
    disableWorker: true,
    password,
  });

  try {
    await loadingTask.promise;
    throw new Error(`${label}: encrypted output opened unexpectedly`);
  } catch (error) {
    if (error?.name !== "PasswordException") throw error;
  } finally {
    try {
      await loadingTask.destroy();
    } catch {
      // PDF.js may already have disposed the rejected loading task.
    }
  }
}
