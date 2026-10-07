import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { init } from "@embedpdf/pdfium";
import type { PDFiumClient } from "../pdfium/client";
import { PDFiumEngine } from "../pdfium/engine";
import type { PDFiumCommand, PDFiumCommands } from "../pdfium/protocol";

const require = createRequire(import.meta.url);
const pdfium = require("@embedpdf/pdfium") as { init: typeof init };

export async function createTestEngine() {
  const wasmBinary = await readFile(require.resolve("@embedpdf/pdfium/pdfium.wasm"));
  const api = await pdfium.init({ wasmBinary });
  return { engine: new PDFiumEngine(api), api };
}

export function engineClient(engine: PDFiumEngine): Pick<PDFiumClient, "request" | "dispose"> {
  return {
    async request<K extends PDFiumCommand>(command: K, input: PDFiumCommands[K]["input"]) {
      // JSON-shaped protocol dispatch, using the real WASM engine instead of a mocked PDF API.
      const i = input as PDFiumCommands["render"]["input"] &
        PDFiumCommands["open"]["input"] &
        PDFiumCommands["edit"]["input"] &
        PDFiumCommands["build"]["input"] &
        PDFiumCommands["images"]["input"];
      let result: unknown;
      switch (command) {
        case "open":
          result = engine.open(i.bytes, i.password);
          break;
        case "close":
          result = engine.close(i.id);
          break;
        case "info":
          result = engine.info(i.id, i.page, i.rotation);
          break;
        case "render":
          result = engine.render(i.id, i.page, i.rotation, i.scale);
          break;
        case "content":
          result = engine.content(i.id, i.page);
          break;
        case "edit":
          result = engine.edit(i.id, i.page, i.edit);
          break;
        case "build":
          result = engine.build(i.pages);
          break;
        case "images":
          result = engine.images(i.images);
          break;
      }
      return result as PDFiumCommands[K]["output"];
    },
    dispose: () => engine.dispose(),
  };
}
