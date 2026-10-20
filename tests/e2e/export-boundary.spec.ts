import { readFile, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { createServer, type ViteDevServer } from "vite";
import { exportCrossPageButtonFixture } from "../../src/services/__tests__/pdf-export-fixtures";
import type {
  checkAdditions,
  checkButtonFailure,
  checkDestinations,
  checkFormExports,
  checkIndirectRoles,
} from "./fixtures/export-boundary";

let server: ViteDevServer, url: string;
test.beforeAll(async () => {
  server = await createServer({
    configFile: false,
    cacheDir: `node_modules/.vite-export-boundary-tests/${test.info().project.name}`,
    plugins: [
      {
        name: "boundary-test",
        configureServer(s) {
          s.middlewares.use("/boundary-test", (_req, res) => {
            res.setHeader("Content-Type", "text/html");
            res.end("<!doctype html><title>Export boundary test</title>");
          });
        },
      },
    ],
    server: { host: "127.0.0.1", port: 0 },
    optimizeDeps: { include: ["effect", "pdfjs-dist", "pdf-lib", "fflate"] },
  });
  await server.listen();
  url = server.resolvedUrls?.local[0] ?? "";
});
test.afterAll(async () => {
  await server?.close();
});

test("saved exports retain widgets/AP/pixels while excluding omitted page objects and answers", async ({
  page,
}, info) => {
  await page.goto(`${url}boundary-test`);
  const result: Awaited<ReturnType<typeof checkFormExports>> = await page.evaluate(async () => {
    const path = "/tests/e2e/fixtures/export-boundary.ts";
    return (await import(path)).checkFormExports();
  });
  for (const item of result.results) {
    expect(item.nativeMatches, item.name).toBe(true);
    expect(item.jsMatches, item.name).toBe(true);
    expect(item.pages).toBe(item.expectedPages);
    expect(item.orphanKids).toBe(false);
    expect(item.provenance).toBe(false);
    const keepsP2 = !["p1", "merge"].includes(item.name);
    expect(item.leakedAnswer).toBe(keepsP2);
    expect(item.leakedContent).toBe(keepsP2);
    for (const kind of ["before", "after"] as const) {
      const path = info.outputPath(`${item.name}-${kind}.pdf`);
      await writeFile(path, new Uint8Array(item[kind]));
      await info.attach(`${item.name}-${kind}`, { path, contentType: "application/pdf" });
    }
  }
  expect(result.results.find((r) => r.name === "detached")?.values).toEqual([
    ["Alice", "Alice"],
    ["Detached", "Detached"],
    ["Alice"],
  ]);
  expect(result.scopes).toEqual({
    markedLeaks: false,
    selectedLeaks: false,
    restoredAnswer: true,
    restoredPages: 2,
  });
});
test("direct and named destinations agree with actual saved output Page references", async ({
  page,
}) => {
  await page.goto(`${url}boundary-test`);
  const results: Awaited<ReturnType<typeof checkDestinations>> = await page.evaluate(async () => {
    const path = "/tests/e2e/fixtures/export-boundary.ts";
    return (await import(path)).checkDestinations();
  });
  for (const result of results) {
    expect(result.pages).toBe(result.layout.length);
    expect(result.provenance).toBe(false);
    expect(result.destinations).toEqual(
      result.layout.filter((n) => n === 1).map(() => result.layout.indexOf(2))
    );
    expect(result.external.every((url) => url === "https://example.com/")).toBe(true);
    expect(result.remote.every((url) => url?.includes("other.pdf"))).toBe(true);
    if (!result.layout.includes(2)) expect(result.leakedContent).toBe(false);
  }
});
test("cross-page button Opt fails clearly rather than changing a saved answer", async ({
  page,
}, info) => {
  await page.goto(`${url}boundary-test`);
  const result: Awaited<ReturnType<typeof checkButtonFailure>> = await page.evaluate(async () => {
    const path = "/tests/e2e/fixtures/export-boundary.ts";
    return (await import(path)).checkButtonFailure();
  });
  expect(result.before).toBe("Second");
  expect(result.unsafe).toBe("First");
  expect(result.error).toEqual({
    operation: "reconcile-export",
    message: "This PDF has linked choice fields that cannot be preserved in this export.",
  });
  for (const kind of ["sourceBytes", "beforeBytes", "unsafeBytes"] as const) {
    const path = info.outputPath(`radio-${kind}.pdf`);
    await writeFile(path, new Uint8Array(result[kind]));
    await info.attach(kind, { path, contentType: "application/pdf" });
  }
});
test("retained forms and saved text/checkmarks keep pixels and physical geometry", async ({
  page,
}, info) => {
  await page.goto(`${url}boundary-test`);
  const result: Awaited<ReturnType<typeof checkAdditions>> = await page.evaluate(async () => {
    const path = "/tests/e2e/fixtures/export-boundary.ts";
    return (await import(path)).checkAdditions();
  });
  if (result.diagnostics) {
    for (const key of ["sourceBytes", "beforeBytes", "afterBytes"] as const) {
      const path = info.outputPath(`additions-${key}.pdf`);
      await writeFile(path, new Uint8Array(result.diagnostics[key]));
      await info.attach(key, { path, contentType: "application/pdf" });
    }
    for (const key of ["beforePngs", "afterPngs"] as const)
      for (const [index, png] of result.diagnostics[key].entries()) {
        const path = info.outputPath(`additions-${key}-page-${index + 1}.png`);
        await writeFile(path, Buffer.from(png.split(",")[1], "base64"));
        await info.attach(`${key}-${index + 1}`, { path, contentType: "image/png" });
      }
    const { sourceBytes, beforeBytes, afterBytes, beforePngs, afterPngs, ...metadata } =
      result.diagnostics;
    await info.attach("additions-render-metadata", {
      body: JSON.stringify(metadata, null, 2),
      contentType: "application/json",
    });
  }
  expect(result.after).toEqual(result.before);
  expect(result.nativeMatches).toBe(true);
  expect(result.after[1].text).toContain("Saved text");
  expect(result.after[0].text).not.toContain("Saved text");
  expect(result.native.pageObjects).toBe(3);
  expect(result.native.orphanKids).toBe(false);
});
test("an unsupported linked choice export offers no partial download", async ({ page }) => {
  await page.goto("/app");
  await page.getByTestId("editor-upload-input").setInputFiles({
    name: "linked-choices.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await exportCrossPageButtonFixture()),
  });
  await expect(page.getByTestId("editor-download-button")).toBeVisible();
  const downloads: string[] = [];
  page.on("download", (download) => downloads.push(download.suggestedFilename()));
  await page.getByTestId("editor-download-button").click();
  await expect(page.getByTestId("editor-status-message")).toHaveText(
    "linked-choices.pdf: This PDF has linked choice fields that cannot be preserved in this export. Select pages from other files or remove this file, then try again."
  );
  await expect(page.getByTestId("editor-toast")).toHaveText(
    "linked-choices.pdf: This PDF has linked choice fields that cannot be preserved in this export. Select pages from other files or remove this file, then try again."
  );
  await expect(page.getByTestId("editor-download-button")).toBeEnabled();
  expect(downloads).toEqual([]);
});

for (const width of [1280, 320])
  test(`merged linked-choice error names the source and permits safe recovery at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/app");
    const safe = await PDFDocument.create();
    safe.addPage([400, 500]);
    safe.addPage([410, 500]);
    await page.getByTestId("editor-upload-input").setInputFiles([
      { name: "source.pdf", mimeType: "application/pdf", buffer: Buffer.from(await safe.save()) },
      {
        name: "radio-source.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(await exportCrossPageButtonFixture()),
      },
    ]);
    const tiles = page.getByTestId("editor-page-tile");
    await expect(tiles).toHaveCount(4);
    const downloads: string[] = [];
    page.on("download", (download) => downloads.push(download.suggestedFilename()));
    await page.getByTestId("editor-download-button").click();
    const message =
      "radio-source.pdf: This PDF has linked choice fields that cannot be preserved in this export. Select pages from other files or remove this file, then try again.";
    await expect(page.getByTestId("editor-status-message")).toHaveText(message);
    await expect(page.getByTestId("editor-toast")).toHaveText(message);
    await expect(page.getByTestId("editor-download-button")).toBeEnabled();
    expect(downloads).toEqual([]);
    await tiles.nth(0).click();
    await tiles.nth(1).click();
    const download = page.waitForEvent("download");
    await page.getByTestId("editor-download-button").click();
    const path = await (await download).path();
    if (!path) throw Error("Missing recovered download");
    const pdf = await PDFDocument.load(await readFile(path));
    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getPages().map((p) => p.getWidth())).toEqual([400, 410]);
    expect(downloads).toHaveLength(1);
    await expect(page.getByTestId("editor-status-message")).toHaveText("Export started.");
  });

test("indirect role names cannot bypass omitted widget/page reconciliation", async ({
  page,
}, info) => {
  await page.goto(`${url}boundary-test`);
  const result: Awaited<ReturnType<typeof checkIndirectRoles>> = await page.evaluate(async () => {
    const path = "/tests/e2e/fixtures/export-boundary.ts";
    return (await import(path)).checkIndirectRoles();
  });
  for (const item of result.widgets) {
    for (const kind of ["input", "output"] as const) {
      const path = info.outputPath(`widget-${item.indirect ? "indirect" : "direct"}-${kind}.pdf`);
      await writeFile(path, new Uint8Array(item[kind]));
      await info.attach(path, { path, contentType: "application/pdf" });
    }
    expect(item.retainedMatches).toBe(true);
    expect(item.pages).toBe(1);
    expect(item.widgets).toBe(1);
    expect(item.orphanKids).toBe(false);
    expect(item.answerRecovered).toBe(false);
    expect(item.values).toEqual([{ name: "group.keep", value: "Retained answer" }]);
  }
  for (const item of result.pages) {
    const path = info.outputPath(`page-${item.indirect ? "indirect" : "direct"}-input.pdf`);
    await writeFile(path, new Uint8Array(item.input));
    await info.attach(path, { path, contentType: "application/pdf" });
    expect(item.sourcePages).toBe(1);
    expect(item.sourceRetainedText).toBe(true);
    expect(item.emitted).toBe(false);
    expect(item.error).toEqual({
      operation: "reconcile-export",
      message: "Unsupported omitted Page reference at /CustomPage",
    });
  }
  for (const item of result.indexing) {
    expect(item.sourceTextMatches).toBe(true);
    expect(item.unchanged).toBe(true);
    const inputPath = info.outputPath(
      `index-${item.indirect ? "indirect" : "direct"}-${item.layout.join("-")}-input.pdf`
    );
    await writeFile(inputPath, new Uint8Array(item.input));
    await info.attach(inputPath, { path: inputPath, contentType: "application/pdf" });
    if (item.indirect) {
      expect(item.output).toBeUndefined();
      expect(item.error).toEqual({
        operation: "reconcile-export",
        sourceMatches: true,
        message: "This PDF's page order cannot be safely copied.",
      });
    } else {
      expect(item.error).toBeUndefined();
      expect(item.text).toEqual(
        item.layout.map(
          (n) => [["ONE"], ["REQUESTED_PAGE_TWO_37e2"], ["OMITTED_PAGE_THREE_912ab"]][n - 1]
        )
      );
      const path = info.outputPath(`index-direct-${item.layout.join("-")}-output.pdf`);
      await writeFile(path, new Uint8Array(item.output!));
      await info.attach(path, { path, contentType: "application/pdf" });
    }
  }
});
