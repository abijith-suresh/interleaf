import { expect, test } from "@playwright/test";
import { type DevServer, startDevServer } from "./fixtures/dev-server";
import type { checkPageMetadata } from "./fixtures/page-metadata";

let server: DevServer;
test.beforeAll(async () => {
  server = await startDevServer("page-metadata", test.info());
});
test.afterAll(async () => {
  await server?.close();
});

test("coalesces real PDF.js geometry reads and preserves rendering and exports", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(server.url);
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
