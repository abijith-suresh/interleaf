import { init } from "@embedpdf/pdfium";
import wasmUrl from "@embedpdf/pdfium/pdfium.wasm?url";
import { PDFiumEngine, PDFiumPasswordError } from "./engine";
import type { PDFiumRequest, PDFiumResponse } from "./protocol";

// Resolve the binary to a bundled, same-origin asset. The package's CDN default is never used.
const engine = init({ locateFile: () => wasmUrl }).then((module) => new PDFiumEngine(module));
let queue: Promise<void> = Promise.resolve();

self.onmessage = (event: MessageEvent<PDFiumRequest>) => {
  const request = event.data;
  queue = queue.then(async () => {
    let response: PDFiumResponse;
    let transfers: Transferable[] = [];
    try {
      const pdf = await engine;
      let value: unknown;
      switch (request.command) {
        case "open":
          value = pdf.open(request.input.bytes, request.input.password);
          break;
        case "close":
          value = pdf.close(request.input.id);
          break;
        case "info":
          value = pdf.info(request.input.id, request.input.page, request.input.rotation);
          break;
        case "render": {
          const rendered = pdf.render(
            request.input.id,
            request.input.page,
            request.input.rotation,
            request.input.scale
          );
          value = rendered;
          transfers = [rendered.pixels.buffer];
          break;
        }
        case "content":
          value = pdf.content(request.input.id, request.input.page);
          break;
        case "edit":
          value = pdf.edit(request.input.id, request.input.page, request.input.edit);
          break;
        case "build": {
          const bytes = pdf.build(request.input.pages);
          value = bytes;
          transfers = [bytes.buffer];
          break;
        }
        case "images": {
          const bytes = pdf.images(request.input.images);
          value = bytes;
          transfers = [bytes.buffer];
          break;
        }
      }
      response = { sequence: request.sequence, ok: true, value };
    } catch (error) {
      response = {
        sequence: request.sequence,
        ok: false,
        message: error instanceof Error ? error.message : "PDF processing failed.",
        password: error instanceof PDFiumPasswordError,
      };
    }
    self.postMessage(response, { transfer: transfers });
  });
};
