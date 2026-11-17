import { expect, test } from "@playwright/test";
import { type DevServer, startDevServer } from "./fixtures/dev-server";
import type { checkFieldHeight } from "./fixtures/field-height";

let server: DevServer;
test.beforeAll(async () => {
  server = await startDevServer("field-height", test.info());
});
test.afterAll(async () => {
  await server?.close();
});
for (const height of [18, 26])
  test(`saved ${height}pt widget keeps complete glyph pixels at fixed12pt`, async ({
    page,
  }, info) => {
    await page.goto(server.url);
    const result: Awaited<ReturnType<typeof checkFieldHeight>> = await page.evaluate(
      async (height) => {
        const path = "/tests/e2e/fixtures/field-height.ts";
        return (await import(path)).checkFieldHeight(height);
      },
      height
    );
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
