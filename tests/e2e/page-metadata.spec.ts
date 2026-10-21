import { expect, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import type { checkPageMetadata } from "./fixtures/page-metadata";

let server: ViteDevServer;
let url: string;

test.beforeAll(async () => {
  // Serve the service fixture only in tests, with real PDF.js and its worker.
  server = await createServer({
    configFile: false,
    cacheDir: `node_modules/.vite-page-metadata/${test.info().project.name}`,
    plugins: [
      {
        name: "metadata-fixture",
        configureServer(server) {
          server.middlewares.use("/metadata-test", (_request, response) => {
            response.setHeader("Content-Type", "text/html");
            response.end("<!doctype html><title>PDF metadata test</title>");
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

test("coalesces real PDF.js geometry reads and preserves rendering and exports", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${url}metadata-test`);
  const result: Awaited<ReturnType<typeof checkPageMetadata>> = await page.evaluate(async () => {
    const path = "/tests/e2e/fixtures/page-metadata.ts";
    const { checkPageMetadata } = await import(path);
    return checkPageMetadata();
  });
  expect(result.actual).toEqual(result.expected);
  expect(result.metadataReads).toBe(33);
  expect(result.metadataAcquisitions).toBe(3);
  for (const error of result.invalidRotations) {
    expect(error.actual).toBe(error.expected);
    expect(error.actual).toContain("Invalid rotation");
  }
  for (const render of result.rendered) expect(render.actual).toEqual(render.expected);
  expect(result.pdfPages).toEqual(result.expectedPdfPages);
  expect(result.pngs).toHaveLength(3);
  expect(result.pngs.map((png) => png.size)).toEqual(
    result.rendered.map((render) => render.expected)
  );
  expect(errors).toEqual([]);
  await test.info().attach("metadata-acquisitions.json", {
    body: JSON.stringify({
      reads: result.metadataReads,
      pageAcquisitions: result.metadataAcquisitions,
    }),
    contentType: "application/json",
  });
});
