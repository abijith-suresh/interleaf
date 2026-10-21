import { expect, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import type { checkFieldHeight } from "./fixtures/field-height";

let server: ViteDevServer, url: string;
test.beforeAll(async () => {
  server = await createServer({
    configFile: false,
    cacheDir: `node_modules/.vite-field-height/${test.info().project.name}`,
    server: { host: "127.0.0.1", port: 0 },
    optimizeDeps: { include: ["effect", "pdfjs-dist", "pdf-lib", "fflate"] },
    plugins: [
      {
        name: "field-height-test",
        configureServer(s) {
          s.middlewares.use("/field-height", (_request, response) => {
            response.setHeader("Content-Type", "text/html");
            response.end(
              '<html><body><script type="module">import {checkFieldHeight} from "/tests/e2e/fixtures/field-height.ts"; window.checkFieldHeight = checkFieldHeight;</script></body></html>'
            );
          });
        },
      },
    ],
  });
  await server.listen();
  url = server.resolvedUrls!.local[0];
});
test.afterAll(async () => {
  await server?.close();
});
for (const height of [18, 26])
  test(`saved ${height}pt widget keeps complete glyph pixels at fixed12pt`, async ({
    page,
  }, info) => {
    await page.goto(`${url}field-height`);
    await page.waitForFunction(() => "checkFieldHeight" in window);
    const result = await page.evaluate(async (height) => {
      const api = window as unknown as { checkFieldHeight: typeof checkFieldHeight };
      return api.checkFieldHeight(height);
    }, height);
    expect(result.actual.ink).toBeGreaterThan(500);
    expect(result.actual).toEqual(result.expected);
    expect(result.viewerMatches).toBe(true);
    expect(result.thumbnailMatches).toBe(true);
    expect(result.pngMatches).toBe(true);
    expect(result.inspected.native.pageObjects).toBe(1);
    expect(result.inspected.native.widgetObjects).toBe(1);
    expect(result.inspected.native.pages[0].annotations).toHaveLength(1);
    expect(result.inspected.native.pages[0].annotations[0]).toMatchObject({
      name: "Name",
      type: "/Tx",
      value: "gjpqyQ{}[]()|_",
    });
    expect(result.inspected.pages[0].annotations).toHaveLength(1);
    expect(result.inspected.pages[0].annotations[0]).toMatchObject({
      name: "Name",
      type: "Tx",
      value: "gjpqyQ{}[]()|_",
    });
    await info.attach("completed-height.pdf", {
      body: Buffer.from(result.bytes),
      contentType: "application/pdf",
    });
  });
