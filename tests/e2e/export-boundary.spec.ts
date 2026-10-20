import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { exportCrossPageButtonFixture } from "../../src/services/__tests__/pdf-export-fixtures";
import type {
  checkAdditions,
  checkButtonFailure,
  checkDestinations,
  checkFormExports,
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
}) => {
  await page.goto(`${url}boundary-test`);
  const result: Awaited<ReturnType<typeof checkAdditions>> = await page.evaluate(async () => {
    const path = "/tests/e2e/fixtures/export-boundary.ts";
    return (await import(path)).checkAdditions();
  });
  expect(result.after).toEqual(result.before);
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
    "This PDF has linked choice fields that cannot be preserved in this export."
  );
  await expect(page.getByTestId("editor-toast")).toHaveText(
    "This PDF has linked choice fields that cannot be preserved in this export."
  );
  await expect(page.getByTestId("editor-download-button")).toBeEnabled();
  expect(downloads).toEqual([]);
});
