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
    const opened = Promise.withResolvers<void>();
    const closed = Promise.withResolvers<void>();
    request.mockImplementation((command: string) => {
      if (command === "open") {
        opened.resolve();
        return open.promise;
      }
      if (command === "close") closed.resolve();
      return Promise.resolve();
    });
    const loading = Effect.runFork(service.loadPDF(file));
    await opened.promise;
    await Effect.runPromise(service.reset());
    open.resolve({ id: 123, count: 1 });
    await closed.promise;
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
  it("captures undo checkpoints atomically and retains source passwords for compression", async () => {
    await Effect.runPromise(service.loadPDFWithPassword(file, "secret"));
    const previous = new Uint8Array([1, 2]);
    request.mockImplementation(async (command: string) => {
      if (command === "snapshot" || command === "editUndoable") return previous;
    });
    const checkpoint = await Effect.runPromise(service.snapshotDocument(file));
    expect(checkpoint).toEqual({ bytes: previous, password: "secret" });
    const edit = { kind: "form" as const, index: 0, value: "Alice" };
    const undo = await Effect.runPromise(service.editPageUndoable(file, 1, edit));
    expect(undo).toEqual(checkpoint);
    expect(request).toHaveBeenCalledWith("editUndoable", { id: 1, page: 1, edit });
    request.mockRejectedValueOnce(new Error("Overflow"));
    await expect(Effect.runPromise(service.editPageUndoable(file, 1, edit))).rejects.toMatchObject({
      message: "Overflow",
    });
  });

  it("restores serialized document state and returns an intact checkpoint for redo", async () => {
    await Effect.runPromise(service.loadPDFWithPassword(file, "secret"));
    const checkpoint = { bytes: new Uint8Array([1, 2, 3]), password: "secret" };
    const previous = new Uint8Array([4, 5, 6]);
    request.mockImplementation(async (command: string, input: { bytes?: Uint8Array }) => {
      if (command === "restore") {
        expect(input.bytes).not.toBe(checkpoint.bytes);
        expect(input.bytes).toEqual(checkpoint.bytes);
        return previous;
      }
    });
    const inverse = await Effect.runPromise(service.restoreDocument(file, checkpoint));
    expect(inverse).toEqual({ bytes: previous, password: "secret" });
    expect(checkpoint.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(service.getPassword(file)).toBe("secret");
    expect(request.mock.calls.filter(([command]) => command === "open")).toHaveLength(1);
  });

  it("reopens a removed encrypted source from decrypted checkpoint bytes under its original File identity", async () => {
    await Effect.runPromise(service.loadPDFWithPassword(file, "secret"));
    await Effect.runPromise(service.releaseFile(file));
    const checkpoint = { bytes: new Uint8Array([7, 8, 9]), password: "secret" };
    const fileReader = vi.spyOn(file, "arrayBuffer");
    request.mockImplementation(
      async (command: string, input: { bytes?: Uint8Array; password?: string }) => {
        if (command === "open") {
          expect(input.bytes).not.toBe(checkpoint.bytes);
          expect(input.bytes).toEqual(checkpoint.bytes);
          expect(input.password).toBeUndefined();
          return { id: 2, count: 3 };
        }
        if (command === "info") return { width: 100, height: 200, rotation: 0 };
      }
    );
    expect(await Effect.runPromise(service.restoreDocument(file, checkpoint))).toBeUndefined();
    expect(fileReader).not.toHaveBeenCalled();
    expect(service.getPageCount()).toBe(3);
    expect(service.getPassword(file)).toBe("secret");
    await Effect.runPromise(service.getPageSize(file, 1));
    expect(request).toHaveBeenCalledWith("info", { id: 2, page: 1, rotation: 0 });
    expect(checkpoint.bytes).toEqual(new Uint8Array([7, 8, 9]));
    await Effect.runPromise(service.releaseFile(file));
    expect(request).toHaveBeenCalledWith("close", { id: 2 });
    fileReader.mockRestore();
  });

  it("does not retain a failed restore override or replace the source password on failure", async () => {
    await Effect.runPromise(service.loadPDFWithPassword(file, "secret"));
    request.mockRejectedValueOnce(new Error("Invalid checkpoint"));
    await expect(
      Effect.runPromise(
        service.restoreDocument(file, { bytes: new Uint8Array([1]), password: "different" })
      )
    ).rejects.toMatchObject({ message: "Invalid checkpoint" });
    expect(service.getPassword(file)).toBe("secret");
    await Effect.runPromise(service.releaseFile(file));
    request.mockRejectedValueOnce(new Error("Invalid archive"));
    await expect(
      Effect.runPromise(service.restoreDocument(file, { bytes: new Uint8Array([9]) }))
    ).rejects.toMatchObject({ message: "Invalid archive" });
    request.mockImplementation(async (command: string, input: { bytes?: Uint8Array }) => {
      if (command === "open") {
        expect(input.bytes).toEqual(new Uint8Array(await file.arrayBuffer()));
        return { id: 3, count: 1 };
      }
    });
    await Effect.runPromise(service.loadPDF(file));
    expect(service.getPageCount()).toBe(1);
  });

  it("invalidates page dimensions and ignores a dimension response crossing restore", async () => {
    await Effect.runPromise(service.loadPDF(file));
    const measured = Promise.withResolvers<PDFiumCommands["info"]["output"]>();
    request.mockImplementationOnce(() => measured.promise);
    const before = Effect.runPromise(service.getPageSize(file, 1));
    await tick();
    request.mockResolvedValueOnce(new Uint8Array([1]));
    await Effect.runPromise(service.restoreDocument(file, { bytes: new Uint8Array([2]) }));
    request.mockResolvedValueOnce({ width: 600, height: 800, rotation: 0 });
    expect(await Effect.runPromise(service.getPageSize(file, 1))).toMatchObject({
      width: 600,
      height: 800,
    });
    measured.resolve({ width: 200, height: 300, rotation: 0 });
    await before;
    expect(await Effect.runPromise(service.getPageSize(file, 1))).toMatchObject({
      width: 600,
      height: 800,
    });
    expect(request.mock.calls.filter(([command]) => command === "info")).toHaveLength(2);
  });

  it("discards rendered pixels arriving after restore instead of repainting old document state", async () => {
    await Effect.runPromise(service.loadPDF(file));
    const rendered = Promise.withResolvers<PDFiumCommands["render"]["output"]>();
    request.mockImplementationOnce(() => rendered.promise);
    const canvas = document.createElement("canvas");
    const getContext = vi.spyOn(canvas, "getContext");
    const painting = Effect.runPromise(service.renderPage(file, 1, canvas));
    await tick();
    request.mockResolvedValueOnce(new Uint8Array([1]));
    await Effect.runPromise(service.restoreDocument(file, { bytes: new Uint8Array([2]) }));
    rendered.resolve({ width: 1, height: 1, pixels: new Uint8ClampedArray(4) });
    await painting;
    expect(getContext).not.toHaveBeenCalled();
  });

  it("waits for restore before release and clears restored password metadata after the mutation", async () => {
    await Effect.runPromise(service.loadPDFWithPassword(file, "secret"));
    const restoring = Promise.withResolvers<Uint8Array<ArrayBuffer>>();
    request.mockImplementationOnce(() => restoring.promise);
    const restored = Effect.runFork(
      service.restoreDocument(file, { bytes: new Uint8Array([1]), password: "secret" })
    );
    await tick();
    const releasing = Effect.runPromise(service.releaseFile(file));
    await tick();
    expect(request.mock.calls.filter(([command]) => command === "close")).toHaveLength(0);
    restoring.resolve(new Uint8Array([2]));
    await Effect.runPromise(Fiber.await(restored));
    await releasing;
    expect(service.getPassword(file)).toBeUndefined();
    expect(service.getPageCount()).toBe(0);
    expect(request).toHaveBeenCalledWith("close", { id: 1 });
  });

  it("closes a checkpoint reopened across reset and does not retain archived password metadata", async () => {
    const opening = Promise.withResolvers<PDFiumCommands["open"]["output"]>();
    const opened = Promise.withResolvers<void>();
    request.mockImplementation((command: string) => {
      if (command === "open") {
        opened.resolve();
        return opening.promise;
      }
      return Promise.resolve();
    });
    const restored = Effect.runFork(
      service.restoreDocument(file, { bytes: new Uint8Array([1]), password: "secret" })
    );
    await opened.promise;
    const reset = Effect.runPromise(Effect.exit(service.reset()));
    await tick();
    opening.resolve({ id: 99, count: 1 });
    expect((await reset)._tag).toBe("Failure");
    await Effect.runPromise(Fiber.await(restored));
    expect(request).toHaveBeenCalledWith("close", { id: 99 });
    expect(service.getPassword(file)).toBeUndefined();
    expect(service.getPageCount()).toBe(0);
  });
  it("invalidates both content and dimension caches after saved edits and document restores", async () => {
    await Effect.runPromise(service.loadPDF(file));
    let width = 200;
    let label = "Original";
    request.mockImplementation(async (command: string) => {
      if (command === "info") return { width, height: 300, rotation: 0 };
      if (command === "content")
        return { width, height: 300, text: [{ index: 0, text: label }], fields: [] };
      if (command === "editUndoable") {
        label = "Edited";
        return new Uint8Array([1]);
      }
      if (command === "restore") {
        label = "Original";
        width = 600;
        return new Uint8Array([2]);
      }
    });
    await Effect.runPromise(service.getPageSize(file, 1));
    expect((await Effect.runPromise(service.getPageContent(file, 1))).text[0].text).toBe(
      "Original"
    );
    await Effect.runPromise(
      service.editPageUndoable(file, 1, {
        kind: "replace",
        index: 0,
        text: "Edited",
        expectedText: "Original",
      })
    );
    expect((await Effect.runPromise(service.getPageContent(file, 1))).text[0].text).toBe("Edited");
    await Effect.runPromise(service.restoreDocument(file, { bytes: new Uint8Array([1]) }));
    expect((await Effect.runPromise(service.getPageContent(file, 1))).text[0].text).toBe(
      "Original"
    );
    expect(await Effect.runPromise(service.getPageSize(file, 1))).toMatchObject({ width: 600 });
    expect(request.mock.calls.filter(([command]) => command === "content")).toHaveLength(3);
    expect(request.mock.calls.filter(([command]) => command === "info")).toHaveLength(2);
  });
});
