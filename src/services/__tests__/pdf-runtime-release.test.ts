import { Effect } from "effect";
import { afterEach, expect, it, vi } from "vitest";
import { makePDFRuntime, PDFProcessing } from "../pdf-runtime";
import { createPageState, createPdfFile } from "./pdf-fixtures";

const pdfjs = vi.hoisted(() => ({
  cleanup: vi.fn(async () => {}),
  destroy: vi.fn(async () => {}),
  operationsImported: vi.fn(),
}));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: () => ({
    promise: Promise.resolve({ numPages: 1, cleanup: pdfjs.cleanup }),
    destroy: pdfjs.destroy,
  }),
}));

vi.mock("../pdf-operations-service", async (importOriginal) => {
  pdfjs.operationsImported();
  return importOriginal();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it("a captured release uses the current real operations cache on every execution", async () => {
  const runtime = makePDFRuntime();
  const file = await createPdfFile("source.pdf", [{ width: 200, height: 300 }]);
  const read = vi.spyOn(file, "arrayBuffer");
  const build = PDFProcessing.use((service) => service.buildPDF([createPageState(file, 1)]));

  try {
    await runtime.runPromise(PDFProcessing.use((service) => service.loadPDF(file)));
    const release = await runtime.runPromise(
      Effect.map(PDFProcessing, (service) => service.releaseFile(file))
    );
    expect(pdfjs.cleanup).not.toHaveBeenCalled();
    await runtime.runPromise(release);
    expect(pdfjs.cleanup).toHaveBeenCalledTimes(1);
    expect(pdfjs.destroy).toHaveBeenCalledTimes(1);
    expect(pdfjs.operationsImported).not.toHaveBeenCalled();
    expect(await runtime.runPromise(PDFProcessing.use((service) => service.getPageCount))).toBe(0);

    await runtime.runPromise(build);
    expect(pdfjs.operationsImported).toHaveBeenCalledTimes(1);
    const cachedReads = read.mock.calls.length;
    await runtime.runPromise(build);
    // Each export reads one private copy even when the source is cached.
    expect(read).toHaveBeenCalledTimes(cachedReads + 1);

    await runtime.runPromise(release);
    await runtime.runPromise(build);
    expect(read).toHaveBeenCalledTimes(cachedReads + 3);

    await runtime.runPromise(release);
    await runtime.runPromise(build);
    expect(read).toHaveBeenCalledTimes(cachedReads + 5);
    expect(pdfjs.operationsImported).toHaveBeenCalledTimes(1);

    await runtime.runPromise(PDFProcessing.use((service) => service.clearCache));
    await runtime.runPromise(build);
    expect(read).toHaveBeenCalledTimes(cachedReads + 7);
  } finally {
    await runtime.dispose();
  }
});

it("evicts the real operations cache even when PDF.js cleanup fails", async () => {
  const runtime = makePDFRuntime();
  const file = await createPdfFile("source.pdf", [{ width: 200, height: 300 }]);
  const read = vi.spyOn(file, "arrayBuffer");
  const build = PDFProcessing.use((service) => service.buildPDF([createPageState(file, 1)]));

  try {
    await runtime.runPromise(PDFProcessing.use((service) => service.loadPDF(file)));
    const release = await runtime.runPromise(
      Effect.map(PDFProcessing, (service) => service.releaseFile(file))
    );
    await runtime.runPromise(build);
    const cachedReads = read.mock.calls.length;
    pdfjs.cleanup.mockRejectedValueOnce(new Error("cleanup failed"));

    const error = await runtime.runPromise(Effect.flip(release));
    expect(error).toMatchObject({ operation: "cleanup-pdf-js", file, message: "cleanup failed" });
    expect(pdfjs.destroy).toHaveBeenCalledTimes(1);
    expect(await runtime.runPromise(PDFProcessing.use((service) => service.getPageCount))).toBe(0);
    await runtime.runPromise(build);
    expect(read).toHaveBeenCalledTimes(cachedReads + 2);
  } finally {
    await runtime.dispose();
  }
});
