import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { makeQpdfProcessing, type QpdfWorkerPort } from "../qpdf-processing";

// Runs the deployed qpdf worker script and WASM module in a Node worker thread.
// The bootstrap supplies the two browser globals that the worker uses.
const BOOTSTRAP = `
const { parentPort, workerData } = require("node:worker_threads");
const { readFile } = require("node:fs/promises");
globalThis.fetch = async (url) =>
  new Response(await readFile(new URL(url)), { headers: { "Content-Type": "application/wasm" } });
globalThis.self = {
  addEventListener(type, listener) {
    if (type === "message") parentPort.on("message", (data) => listener({ data }));
  },
  postMessage(message, transfer) {
    parentPort.postMessage(message, transfer);
  },
};
import(workerData.url);
`;

// Vitest runs from the repository root.
const workerUrl = pathToFileURL(join(process.cwd(), "public/qpdf/qpdf-worker.js"));

function nodeWorker(url: string | URL): QpdfWorkerPort {
  const worker = new Worker(BOOTSTRAP, { eval: true, workerData: { url: String(url) } });
  const handlers = new Map<unknown, (value: unknown) => void>();
  return {
    postMessage: (message, transfer) => worker.postMessage(message, transfer as ArrayBuffer[]),
    addEventListener(type: "message" | "error", listener: (event: never) => void) {
      const handler = (value: unknown) =>
        listener(
          (type === "message" ? { data: value } : { error: value, message: String(value) }) as never
        );
      handlers.set(listener, handler);
      worker.on(type, handler);
    },
    removeEventListener(type: "message" | "error", listener: unknown) {
      const handler = handlers.get(listener);
      if (handler) worker.off(type, handler);
      handlers.delete(listener);
    },
    terminate: () => void worker.terminate(),
  } as QpdfWorkerPort;
}

export function makeNodeQpdfProcessing() {
  return makeQpdfProcessing({ workerUrl, workerFactory: nodeWorker });
}

export function readQpdfFixture(name: string): File {
  const bytes = Buffer.from(
    readFileSync(join(process.cwd(), `tools/qpdf-wasm/fixtures/${name}.b64`), "utf8"),
    "base64"
  );
  return new File([bytes], `${name}.pdf`, { type: "application/pdf" });
}
