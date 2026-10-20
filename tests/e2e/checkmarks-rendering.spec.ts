import { expect, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import type { checkAddedText } from "./fixtures/added-text";

let server: ViteDevServer;
let url: string;

test.beforeAll(async () => {
  // Serve the service fixture only in tests, with real PDF.js and its worker.
  server = await createServer({
    configFile: false,
    cacheDir: `node_modules/.vite-checkmarks/${test.info().project.name}`,
    plugins: [
      {
        name: "text-fixture",
        configureServer(server) {
          server.middlewares.use("/text-test", (_request, response) => {
            response.setHeader("Content-Type", "text/html");
            response.end("<!doctype html><title>Added text test</title>");
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

for (const unitIndex of [0, 1, 2])
  for (const encrypted of [false, true])
    for (const intrinsicIndex of [0, 1, 2, 3])
      test(`unit=${[1, 1.5, 2][unitIndex]} intrinsic=${intrinsicIndex * 90} checkmarks in preview, thumbnail, PDF and PNG share real PDF geometry and pixels, encrypted=${encrypted}`, async ({
        page,
      }) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(`${url}text-test`);
        const result: Awaited<ReturnType<typeof checkAddedText>> = await page.evaluate(
          async ({ encrypted, unitIndex, intrinsicIndex }) => {
            const path = "/tests/e2e/fixtures/added-text.ts";
            return (await import(path)).checkAddedText(encrypted, unitIndex, intrinsicIndex, true);
          },
          { encrypted, unitIndex, intrinsicIndex }
        );
        expect(result.maxRoundtripError).toBeLessThan(0.000001);
        expect(result.results).toHaveLength(4);
        for (const entry of result.results) {
          if (!encrypted) expect(entry.strings).toContain("Original");
          expect(entry.strings).toContain("Added 123");
          expect(entry.physicalSize).toBeCloseTo(16);
          expect(entry.placementError).toBeLessThan(0.000001);
          expect(entry.directionError).toBeLessThan(0.000001);
          expect(entry.nativeStrokeCount).toBe(2);
          expect(entry.nativeStrokeError).toBeLessThan(0.000001);
          expect(entry.addedInk).toBeGreaterThan(20);
          expect(entry.pixels).toBe(0);
          expect(entry.thumbnail).toBe(0);
        }
        expect(result.pngDifferences).toHaveLength(4);
        expect(result.pngDifferences.every((difference) => difference === 0)).toBe(true);
        expect(errors).toEqual([]);
      });
