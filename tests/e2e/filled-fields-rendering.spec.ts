import { expect, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import type { checkFilledFields } from "./fixtures/filled-fields";

let server: ViteDevServer, url: string;
test.beforeAll(async () => {
  server = await createServer({
    configFile: false,
    cacheDir: `node_modules/.vite-filled-fields/${test.info().project.name}`,
    plugins: [
      {
        name: "fields-test",
        configureServer(s) {
          s.middlewares.use("/fields-test", (_req, res) => {
            res.setHeader("Content-Type", "text/html");
            res.end("<!doctype html><title>Field test</title>");
          });
        },
      },
    ],
    server: { host: "127.0.0.1", port: 0 },
    optimizeDeps: { include: ["effect", "pdfjs-dist", "pdf-lib", "fflate"] },
  });
  await server.listen();
  url = server.resolvedUrls!.local[0];
});
test.afterAll(async () => {
  await server?.close();
});
for (const source of [0, 90, 180, 270])
  for (const turn of [0, 90, 180, 270]) {
    const unit = [1, 1.5, 2][((source + turn) / 90) % 3];
    test(`saved fields, separate scopes and exact generated pixels at unit ${unit}, intrinsic ${source}, workspace ${turn}`, async ({
      page,
    }, info) => {
      await page.goto(`${url}fields-test`);
      const result: Awaited<ReturnType<typeof checkFilledFields>> = await page.evaluate(
        async (args) => {
          const path = "/tests/e2e/fixtures/filled-fields.ts";
          return (await import(path)).checkFilledFields(...args);
        },
        [unit, source, turn]
      );
      expect(result.descriptors.widgets).toHaveLength(6);
      const target = result.descriptors.widgets.filter((w) => w.fieldRef === result.fieldRef);
      expect(target).toHaveLength(3);
      expect(target.map((w) => w.widgetRef)).toEqual(result.widgetRefs);
      expect(target.every((w) => w.reason === undefined)).toBe(true);
      expect(result.markedValue).toBe("SAVED");
      expect(result.independent.native.pageObjects).toBe(5);
      expect(result.independent.native.widgetObjects).toBe(18);
      expect(result.independent.native.orphanKids).toBe(false);
      expect(result.independent.native.hasAcroForm).toBe(false);
      const expected = [
        ["SAVED"],
        ["COPY", "COPY"],
        ["THIRD", "THIRD"],
        ["SAVED", "SAVED"],
        ["BOB", "BOB"],
      ];
      expect(
        result.independent.pages.map((p) =>
          p.annotations.filter((a) => a.name === "person.answer").map((a) => a.value)
        )
      ).toEqual(expected);
      expect(
        result.independent.native.pages.map((p) =>
          p.annotations.filter((a) => a.name === "person.answer").map((a) => a.value)
        )
      ).toEqual(expected);
      expect(
        result.independent.pages
          .flatMap((p) => p.annotations)
          .filter((a) => a.name === "person.answer")
          .map((a) => a.type)
      ).toEqual(Array(9).fill("Tx"));
      for (const name of ["locked", "accepted"]) {
        expect(result.independent.pages[3].annotations.filter((a) => a.name === name)).toHaveLength(
          1
        );
        expect(result.untouched.pages[0].annotations.filter((a) => a.name === name)).toHaveLength(
          1
        );
        expect(result.independent.pages[3].annotations.find((a) => a.name === name)).toEqual(
          result.untouched.pages[0].annotations.find((a) => a.name === name)
        );
      }
      for (const [index, render] of result.renders.entries())
        expect(render).toEqual(result.references[index]);
      expect(result.png).toEqual({
        size: result.references[2].size,
        pixels: result.references[2].pixels,
      });
      expect(result.originalValue).toEqual(["INHERITED", "INHERITED", "INHERITED"]);
      await info.attach("completed.pdf", {
        body: Buffer.from(result.bytes),
        contentType: "application/pdf",
      });
    });
  }
