import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import provenance from "./fixtures/pdfium-core-provenance.json" with { type: "json" };
import type { checkFieldImport } from "./fixtures/pdfium-fields";

let server: ViteDevServer;
let url: string;

test.beforeAll(async () => {
  const bytes = await readFile("node_modules/@embedpdf/engine-runtime-wasm32/lib/embedpdf.wasm");
  expect(bytes.byteLength).toBe(provenance.maintainedSuccessor.wasmBytes);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    provenance.maintainedSuccessor.wasmSha256
  );
  server = await createServer({
    configFile: false,
    cacheDir: `node_modules/.vite-pdfium-fields/${test.info().project.name}`,
    plugins: [
      {
        name: "field-probe",
        configureServer(server) {
          server.middlewares.use("/field-probe", (_request, response) => {
            response.setHeader("Content-Type", "text/html");
            response.end(
              "<!doctype html><title>PDFium inherited field preservation evidence</title>"
            );
          });
        },
      },
    ],
    server: { host: "127.0.0.1", port: 0 },
    optimizeDeps: {
      include: [
        "effect",
        "pdf-lib",
        "pdfjs-dist",
        "@embedpdf/engine-runtime",
        "@embedpdf/engine-runtime-wasm32",
      ],
    },
  });
  await server.listen();
  url = server.resolvedUrls?.local[0] ?? "";
});
test.afterAll(async () => {
  await server?.close();
});

test("saved inherited fields: main baseline, successor import deficit and direct-save control", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${url}field-probe`);
  const result: Awaited<ReturnType<typeof checkFieldImport>> = await page.evaluate(async () => {
    const path = "/tests/e2e/fixtures/pdfium-fields.ts";
    return (await import(path)).checkFieldImport();
  });
  await test.info().attach("successor-field-preservation.json", {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  });
  expect(result.rows.map((row) => row.scenario)).toEqual([
    "full",
    "extract-second",
    "reorder",
    "merge-two",
    "repeat-import",
  ]);
  for (const source of result.sourceGroups) {
    expect(source.groups).toHaveLength(2);
    for (const group of source.groups) {
      expect(group.siblings).toBe(2);
      expect(group.visibleMembers).toHaveLength(2);
      expect(group.reciprocal).toEqual([true, true]);
    }
  }
  for (const row of result.rows) {
    await test.step(row.scenario, async () => {
      expect(row.lifetime.closedBeforeResponse).toBe(true);
      expect(row.lifetime.closedDocuments).toBe(row.lifetime.openedDocuments);
      expect(row.baseline.fields).toEqual(row.expectedFields);
      // Main calls copyPages separately per page. Its copied parents retain
      // both Kids but each selected page receives its own parent graph.
      expect(row.baseline.grouping.groups).toHaveLength(row.expectedFields.length * 2);
      for (const group of row.baseline.grouping.groups) {
        expect(group.siblings).toBe(2);
        expect(group.visibleMembers).toHaveLength(1);
        expect(group.reciprocal).toEqual([true]);
      }
      for (const output of row.outputs) {
        if (output.variant === "direct-save") {
          expect(output.fields).toEqual(row.baseline.fields);
          expect(output.grouping).toEqual(result.sourceGroups[0]);
        } else if (output.variant === "model-adoption") {
          expect(output.fields).toEqual(row.baseline.fields);
          expect(output.grouping).toEqual(result.sourceGroups[0]);
          expect(output.diagnostics).toEqual({
            duplicateNameRejected: true,
            linkedParentUnavailable: true,
          });
        } else {
          // Explicit opt-in requires migration parity and intentionally fails
          // against this pin. Default verification records its exact deficit.
          if (process.env.PDFIUM_FIELDS_REQUIRE_PARITY === "1") {
            expect(
              output.fields,
              `${row.scenario}/${output.variant}: inherited metadata parity`
            ).toEqual(row.baseline.fields);
            expect(output.grouping, `${row.scenario}/${output.variant}: grouping parity`).toEqual(
              row.baseline.grouping
            );
          } else {
            expect(output.fields).toEqual(
              row.expectedFields.map((fields) =>
                fields.map(() => ({ name: "", value: null, type: null, hasAppearance: true }))
              )
            );
            expect(output.grouping.groups).toEqual([]);
            for (const widgets of output.grouping.widgets)
              for (const widget of widgets)
                expect(widget).toEqual({ group: null, siblings: 0, reciprocal: false });
          }
        }
        for (const image of output.appearance) {
          expect([image.width, image.height]).toEqual([300, 400]);
          expect(image.totalChannels).toBe(480_000);
          expect(image.inkPixels).toBeGreaterThan(100);
          if (output.variant === "model-adoption")
            expect(image.differingChannels).toBeGreaterThan(0);
          else expect(image.differingChannels).toBe(0);
        }
      }
    });
  }
  expect(errors).toEqual([]);
});
