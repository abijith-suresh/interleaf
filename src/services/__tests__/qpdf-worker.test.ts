import { Effect } from "effect";
import { PDFDocument } from "pdf-lib";
import { afterAll, describe, expect, it } from "vitest";
import { makeNodeQpdfProcessing, readQpdfFixture } from "./qpdf-node-worker";

// Runs the deployed worker and WASM module, not a fake worker.
describe("qpdf worker passwords", { timeout: 30_000 }, () => {
  const qpdf = makeNodeQpdfProcessing();
  afterAll(() => qpdf.close());

  const read = async (name: string) => new Uint8Array(await readQpdfFixture(name).arrayBuffer());

  it("decrypts an R3 PDF whose non-ASCII password is stored as single bytes", async () => {
    const input = await read("encrypted-128-bit-r3-latin1-password");

    const output = await Effect.runPromise(qpdf.decrypt(input.buffer, "é"));
    const doc = await PDFDocument.load(output);

    expect(doc.isEncrypted).toBe(false);
    expect(doc.getPageCount()).toBe(1);
  });

  it("compresses the same R3 PDF and keeps its encryption", async () => {
    const input = await read("encrypted-128-bit-r3-latin1-password");

    const result = await Effect.runPromise(qpdf.optimizeLosslessly(input, "é"));
    const doc = await PDFDocument.load(result.data, { ignoreEncryption: true });

    expect(doc.isEncrypted).toBe(true);
  });

  it.each(["encrypted-128-bit-r3-latin1-password", "encrypted-256-bit-r6"])(
    "rejects a wrong non-ASCII password for %s",
    async (name) => {
      const input = await read(name);

      await expect(Effect.runPromise(qpdf.decrypt(input.buffer, "è"))).rejects.toMatchObject({
        _tag: "QpdfProcessingError",
        operation: "decrypt",
        message: expect.stringContaining("invalid password"),
      });
    }
  );
});
