import { writeFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { exportCrossPageButtonFixture } from "../../src/services/__tests__/pdf-export-fixtures";
import { type DevServer, startDevServer } from "./fixtures/dev-server";
import { captureDownload } from "./fixtures/download";
import type {
  checkAdditions,
  checkCountsAndResourceNames,
  checkFormExports,
  checkIndirectRoles,
  checkOptionalNullActions,
} from "./fixtures/export-boundary";
import { clickSelectionAction } from "./fixtures/toolbar";

let server: DevServer;
test.beforeAll(async () => {
  server = await startDevServer("export-boundary", test.info());
});
test.afterAll(async () => {
  await server?.close();
});

test("saved exports retain widgets/AP/pixels while excluding omitted page objects and answers", async ({
  page,
}, info) => {
  await page.goto(server.url);
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
});
test("retained forms and saved text/checkmarks keep pixels and physical geometry", async ({
  page,
}, info) => {
  await page.goto(server.url);
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
// Extract to PDF sits under More selection actions on phones.
async function extractSelection(page: Page) {
  await clickSelectionAction(page, "editor-extract-button");
}

test("an unsupported linked choice export offers no partial download", async ({ page }) => {
  await page.goto("/app");
  await page.getByTestId("editor-upload-input").setInputFiles({
    name: "linked-choices.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await exportCrossPageButtonFixture()),
  });
  await expect(page.getByTestId("editor-download-menu-button")).toBeVisible();
  // Exporting one page of the group would prune a positional radio option.
  await page.getByTestId("editor-page-tile").nth(1).click();
  const downloads: string[] = [];
  page.on("download", (download) => downloads.push(download.suggestedFilename()));
  await extractSelection(page);
  await expect(page.getByTestId("editor-status-message")).toHaveText(
    "linked-choices.pdf: This PDF has linked choice fields that cannot be preserved in this export. Extract pages from other files, or remove this file, then try again."
  );
  await expect(page.getByTestId("editor-toast")).toHaveText(
    "linked-choices.pdf: This PDF has linked choice fields that cannot be preserved in this export. Extract pages from other files, or remove this file, then try again."
  );
  await expect(page.getByTestId("editor-extract-button")).toHaveAttribute("aria-disabled", "false");
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
    // Exporting one page of the group would prune a positional radio option.
    await tiles.nth(0).click();
    await tiles.nth(3).click();
    await extractSelection(page);
    const message =
      "radio-source.pdf: This PDF has linked choice fields that cannot be preserved in this export. Extract pages from other files, or remove this file, then try again.";
    await expect(page.getByTestId("editor-status-message")).toHaveText(message);
    await expect(page.getByTestId("editor-toast")).toHaveText(message);
    await expect(page.getByTestId("editor-extract-button")).toHaveAttribute(
      "aria-disabled",
      "false"
    );
    expect(downloads).toEqual([]);
    await tiles.nth(3).click();
    await tiles.nth(1).click();
    const { bytes: pdfBytes } = await captureDownload(page, () => extractSelection(page));
    const pdf = await PDFDocument.load(pdfBytes);
    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getPages().map((p) => p.getWidth())).toEqual([400, 410]);
    expect(downloads).toHaveLength(1);
    await expect(page.getByTestId("editor-status-message")).toHaveText("Export started.");
  });

test("indirect role names cannot bypass omitted widget reconciliation", async ({ page }, info) => {
  await page.goto(server.url);
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
});

test("subtree Counts cannot substitute workspace pages and resource/AP lookup names preserve pixels", async ({
  page,
}, info) => {
  await page.goto(server.url);
  const result: Awaited<ReturnType<typeof checkCountsAndResourceNames>> = await page.evaluate(
    async () => {
      const path = "/tests/e2e/fixtures/export-boundary.ts";
      return (await import(path)).checkCountsAndResourceNames();
    }
  );
  for (const entry of result.counts) {
    expect(entry.sourceOrders).toHaveLength(3);
    for (const order of entry.sourceOrders) {
      expect(order.pages).toBe(4);
      expect(order.text).toBe(result.countText[entry.correct ? 1 : 2]);
    }
    if (entry.correct) {
      expect(entry.error).toBeUndefined();
      expect(entry.text).toEqual(entry.layout.map((n) => [result.countText[n - 1]]));
      const path = info.outputPath(
        `count-${entry.indirect ? "indirect" : "direct"}-${entry.layout.join("-")}.pdf`
      );
      await writeFile(path, new Uint8Array(entry.output!));
      await info.attach(path, { path, contentType: "application/pdf" });
    } else {
      expect(entry.output).toBeUndefined();
      expect(entry.error).toEqual({
        operation: "reconcile-export",
        sourceMatches: true,
        message: "This PDF's page order cannot be safely copied.",
      });
    }
  }
  for (const entry of result.resources) {
    expect(entry.metadataEqual).toBe(true);
    expect(entry.jsEqual).toBe(true);
    expect(entry.pixelsEqual).toBe(true);
    expect(entry.pages).toBe(1);
    expect(entry.orphanKids).toBe(false);
    if (entry.checkbox) expect(entry.values).toEqual([entry.key]);
    else expect(entry.text).toEqual([`Valid font resource ${entry.key}`]);
    for (const kind of ["input", "before", "after"] as const) {
      const path = info.outputPath(
        `${entry.checkbox ? "checkbox" : "font"}-${entry.key}-${kind}.pdf`
      );
      await writeFile(path, new Uint8Array(entry[kind]));
      await info.attach(path, { path, contentType: "application/pdf" });
    }
  }
});

test("optional null actions preserve saved text/widgets/AP and omitted-target safety", async ({
  page,
}, info) => {
  await page.goto(server.url);
  const result: Awaited<ReturnType<typeof checkOptionalNullActions>> = await page.evaluate(
    async () => {
      const path = "/tests/e2e/fixtures/export-boundary.ts";
      return (await import(path)).checkOptionalNullActions();
    }
  );
  for (const entry of result.results) {
    for (const kind of ["input", "before", "after"] as const) {
      const path = info.outputPath(`null-${entry.context}-${entry.kind}-${kind}.pdf`);
      await writeFile(path, new Uint8Array(entry[kind]));
      await info.attach(path, { path, contentType: "application/pdf" });
    }
    if (entry.diagnostics)
      await info.attach(`null-${entry.context}-${entry.kind}-mismatch`, {
        body: JSON.stringify(entry.diagnostics),
        contentType: "application/json",
      });
    expect(entry.metadataEqual).toBe(true);
    expect(entry.jsEqual).toBe(true);
    expect(entry.pixelsEqual).toBe(true);
    expect(entry.text).toEqual(["Retained content"]);
    expect(entry.values).toEqual(["Retained answer"]);
    expect(entry.pages).toBe(1);
    expect(entry.widgets).toBe(1);
    expect(entry.orphanKids).toBe(false);
  }
  expect(result.omitted.pages).toBe(1);
  expect(result.omitted.visiblePages).toBe(1);
  expect(result.omitted.leaked).toBe(false);
  expect(result.omitted.inactive).toBe(true);
  const path = info.outputPath("null-next-omitted-output.pdf");
  await writeFile(path, new Uint8Array(result.omitted.output));
  await info.attach(path, { path, contentType: "application/pdf" });
});
