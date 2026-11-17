import { expect, test } from "@playwright/test";
import type { checkClearedFields } from "./fixtures/cleared-fields";
import { type DevServer, startDevServer } from "./fixtures/dev-server";

let server: DevServer;
test.beforeAll(async () => {
  server = await startDevServer("cleared-fields", test.info());
});
test.afterAll(async () => {
  await server?.close();
});
test("explicit clear shadows inherited values in saved bytes; undo restores absence and original source", async ({
  page,
}, info) => {
  await page.goto(server.url);
  const result: Awaited<ReturnType<typeof checkClearedFields>> = await page.evaluate(async () => {
    const path = "/tests/e2e/fixtures/cleared-fields.ts";
    return (await import(path)).checkClearedFields();
  });
  expect(result.explicitEmpty).toEqual([
    { fieldRef: result.fieldRef, value: "" },
    { fieldRef: result.fieldRef, value: "" },
  ]);
  expect(result.noOverride).toBe(true);
  expect(result.originalFile).toBe(true);
  expect(result.originalGroup).toBe(true);
  expect(result.widgets).toHaveLength(3);
  for (const [key, expected] of [
    ["original", "INHERITED"],
    ["cleared", ""],
    ["undo", "INHERITED"],
  ] as const) {
    const output = result[key];
    expect(output.native.pageObjects).toBe(2);
    expect(output.native.widgetObjects).toBe(6);
    expect(output.native.orphanKids).toBe(false);
    expect(
      output.pages
        .flatMap((page) => page.annotations)
        .filter((annotation) => annotation.name === "person.answer")
        .map((annotation) => [annotation.type, annotation.value])
    ).toEqual(Array.from({ length: 3 }, () => ["Tx", expected]));
    expect(
      output.native.pages
        .flatMap((page) => page.annotations)
        .filter((annotation) => annotation.name === "person.answer")
        .map((annotation) => [annotation.type, annotation.value])
    ).toEqual(Array.from({ length: 3 }, () => ["/Tx", expected]));
  }
  expect(result.cleared.pages[0].pixels).not.toBe(result.original.pages[0].pixels);
  expect(result.undo.pages.map((page) => page.pixels)).toEqual(
    result.original.pages.map((page) => page.pixels)
  );
  for (const name of ["locked", "accepted"]) {
    const before = result.original.pages[0].annotations.filter(
        (annotation) => annotation.name === name
      ),
      after = result.cleared.pages[0].annotations.filter((annotation) => annotation.name === name);
    expect(before).toHaveLength(1);
    expect(after).toEqual(before);
  }
  await info.attach("cleared.pdf", {
    body: Buffer.from(result.bytes),
    contentType: "application/pdf",
  });
});
