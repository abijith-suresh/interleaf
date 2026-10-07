import { Effect, Fiber } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFPasswordRequiredError } from "../../types/interfaces";
import { PDFService } from "../pdf-service";
import { PDFiumClientError } from "../pdfium/client";
import type { PDFiumCommands } from "../pdfium/protocol";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("PDFService worker lifecycle", () => {
  let service: PDFService;
  const request = vi.fn();
  const dispose = vi.fn();
  let file: File;
  beforeEach(() => {
    request.mockReset();
    dispose.mockReset();
    request.mockImplementation(async (command: string) =>
      command === "open" ? { id: 1, count: 5 } : undefined
    );
    service = new PDFService({ request, dispose });
    file = new File(["%PDF"], "source.pdf", { type: "application/pdf" });
  });
  afterEach(async () => {
    await Effect.runPromise(service.dispose());
  });

  it("loads each File once for rendering and export and retains separate file identities", async () => {
    await Effect.runPromise(service.loadPDF(file));
    await Effect.runPromise(service.loadPDF(file));
    expect(service.getPageCount()).toBe(5);
    expect(request.mock.calls.filter(([command]) => command === "open")).toHaveLength(1);
    const other = new File(["%PDF"], "source.pdf");
    await Effect.runPromise(service.loadPDF(other));
    expect(request.mock.calls.filter(([command]) => command === "open")).toHaveLength(2);
  });

  it("maps password failures, caches successful unlocks, and clears passwords on release", async () => {
    request.mockRejectedValueOnce(new PDFiumClientError("password", true));
    await expect(Effect.runPromise(service.loadPDF(file))).rejects.toEqual(
      new PDFPasswordRequiredError(file)
    );
    request.mockRejectedValueOnce(new PDFiumClientError("password", true));
    await expect(Effect.runPromise(service.loadPDFWithPassword(file, "bad"))).rejects.toEqual(
      new PDFPasswordRequiredError(file, "wrong-password")
    );
    await Effect.runPromise(service.loadPDFWithPassword(file, "secret"));
    expect(service.getPassword(file)).toBe("secret");
    await Effect.runPromise(service.loadPDF(file));
    await expect(Effect.runPromise(service.loadPDFWithPassword(file, "wrong"))).rejects.toEqual(
      new PDFPasswordRequiredError(file, "wrong-password")
    );
    await Effect.runPromise(service.releaseFile(file));
    expect(service.getPassword(file)).toBeUndefined();
    expect(service.getPageCount()).toBe(0);
    expect(request).toHaveBeenCalledWith("close", { id: 1 });
  });

  it("closes a native document if its open response arrives after reset", async () => {
    const open = Promise.withResolvers<PDFiumCommands["open"]["output"]>();
    request.mockImplementationOnce(() => open.promise);
    const loading = Effect.runFork(service.loadPDF(file));
    await tick();
    await Effect.runPromise(service.reset());
    open.resolve({ id: 123, count: 1 });
    await tick();
    expect(request).toHaveBeenCalledWith("close", { id: 123 });
    expect(service.getPageCount()).toBe(0);
    await Effect.runPromise(Fiber.await(loading));
  });

  it("does not paint a canvas after the render is interrupted", async () => {
    await Effect.runPromise(service.loadPDF(file));
    const rendered = Promise.withResolvers<PDFiumCommands["render"]["output"]>();
    request.mockImplementationOnce(() => rendered.promise);
    const canvas = document.createElement("canvas");
    const getContext = vi.spyOn(canvas, "getContext");
    const fiber = Effect.runFork(service.renderPage(file, 1, canvas));
    await tick();
    await Effect.runPromise(Fiber.interrupt(fiber));
    rendered.resolve({ width: 1, height: 1, pixels: new Uint8ClampedArray(4) });
    await tick();
    expect(getContext).not.toHaveBeenCalled();
  });

  it("passes edits to the shared document and waits for mutations before release", async () => {
    await Effect.runPromise(service.loadPDF(file));
    const mutation = Promise.withResolvers<void>();
    request.mockImplementationOnce(() => mutation.promise);
    const edit = { kind: "form" as const, index: 0, value: "Alice" };
    const fiber = Effect.runFork(service.editPage(file, 1, edit));
    await tick();
    const release = Effect.runPromise(service.releaseFile(file));
    await tick();
    expect(request.mock.calls.filter(([command]) => command === "close")).toHaveLength(0);
    mutation.resolve();
    await release;
    await Effect.runPromise(Fiber.await(fiber));
    expect(request).toHaveBeenCalledWith("edit", { id: 1, page: 1, edit });
    expect(request).toHaveBeenCalledWith("close", { id: 1 });
  });

  it("coalesces repeated inspection and caches dimensions across rotation requests", async () => {
    await Effect.runPromise(service.loadPDF(file));
    const content = { width: 200, height: 300, text: [], fields: [] };
    request.mockImplementation(async (command: string) =>
      command === "content" ? content : { width: 200, height: 300, rotation: 90 }
    );
    await Promise.all([
      Effect.runPromise(service.getPageContent(file, 1)),
      Effect.runPromise(service.getPageContent(file, 1)),
    ]);
    await Effect.runPromise(service.getPageContent(file, 1));
    expect(request.mock.calls.filter(([command]) => command === "content")).toHaveLength(1);
    expect(await Effect.runPromise(service.getPageRotation(file, 1))).toBe(90);
    expect(await Effect.runPromise(service.getPageSize(file, 1, 90))).toMatchObject({
      width: 300,
      height: 200,
    });
    expect(request.mock.calls.filter(([command]) => command === "info")).toHaveLength(1);
    await Effect.runPromise(service.editPage(file, 1, { kind: "form", index: 0, value: "New" }));
    await Effect.runPromise(service.getPageContent(file, 1));
    expect(request.mock.calls.filter(([command]) => command === "content")).toHaveLength(2);
  });

  it("reuses bounded preview pixels and discards them after successful and failed edits", async () => {
    await Effect.runPromise(service.loadPDF(file));
    const rendered = { width: 1, height: 1, pixels: new Uint8ClampedArray(4) };
    const putImageData = vi.fn();
    const canvas = document.createElement("canvas");
    vi.spyOn(canvas, "getContext").mockReturnValue({
      putImageData,
    } as unknown as CanvasRenderingContext2D);
    vi.stubGlobal("ImageData", class {});
    request.mockImplementation(async () => rendered);
    await Effect.runPromise(service.renderPage(file, 1, canvas));
    await Effect.runPromise(service.renderPage(file, 1, canvas));
    expect(request.mock.calls.filter(([command]) => command === "render")).toHaveLength(1);
    expect(putImageData).toHaveBeenCalledTimes(2);
    request.mockRejectedValueOnce(new Error("Rejected edit"));
    await expect(
      Effect.runPromise(service.editPage(file, 1, { kind: "form", index: 0, value: "Bad" }))
    ).rejects.toMatchObject({ message: "Rejected edit" });
    await Effect.runPromise(service.renderPage(file, 1, canvas));
    expect(request.mock.calls.filter(([command]) => command === "render")).toHaveLength(2);
    await Effect.runPromise(service.editPage(file, 1, { kind: "form", index: 0, value: "New" }));
    await Effect.runPromise(service.renderPage(file, 1, canvas));
    expect(request.mock.calls.filter(([command]) => command === "render")).toHaveLength(3);
    vi.unstubAllGlobals();
  });

  it("never caches an inspection response arriving across a mutation", async () => {
    await Effect.runPromise(service.loadPDF(file));
    const inspection = Promise.withResolvers<PDFiumCommands["content"]["output"]>();
    request.mockImplementationOnce(() => inspection.promise);
    const inspecting = Effect.runPromise(service.getPageContent(file, 1));
    await tick();
    await Effect.runPromise(service.editPage(file, 1, { kind: "form", index: 0, value: "New" }));
    inspection.resolve({ width: 200, height: 300, text: [], fields: [] });
    await inspecting;
    request.mockResolvedValue({ width: 200, height: 300, text: [], fields: [] });
    await Effect.runPromise(service.getPageContent(file, 1));
    expect(request.mock.calls.filter(([command]) => command === "content")).toHaveLength(2);
  });

  it("resets all documents and disposes the worker", async () => {
    await Effect.runPromise(service.loadPDF(file));
    await Effect.runPromise(service.reset());
    expect(service.getPageCount()).toBe(0);
    await Effect.runPromise(service.dispose());
    expect(dispose).toHaveBeenCalled();
  });
});
