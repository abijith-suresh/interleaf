import { Effect, Exit, Fiber } from "effect";
import { runFork, runPromise } from "effect/Effect";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { PDFPasswordRequiredError } from "../../types/interfaces";
import { PDFService } from "../pdf-service";

const getDocument = vi.hoisted(() => vi.fn<() => LoadingTask>());
vi.mock("pdfjs-dist", () => ({ getDocument, GlobalWorkerOptions: { workerSrc: "" } }));

type LoadingTask = {
  promise: Promise<unknown>;
  destroy: Mock<() => Promise<void>>;
};

function makePage(width = 100, height = 200) {
  return {
    rotate: 0,
    getViewport: vi.fn(({ scale = 1, rotation = 0 }) =>
      rotation === 90 || rotation === 270
        ? { width: height * scale, height: width * scale }
        : { width: width * scale, height: height * scale }
    ),
    cleanup: vi.fn(() => true),
    render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
  };
}

function makeDocument(page = makePage()) {
  return {
    numPages: 5,
    getPage: vi.fn(async (_pageNumber: number) => page),
    cleanup: vi.fn(async () => {}),
  };
}

function makeTask(promise: Promise<unknown>): LoadingTask {
  return { promise, destroy: vi.fn(async () => {}) };
}

function pendingLoad() {
  const pending = Promise.withResolvers<unknown>();
  const task = makeTask(pending.promise);
  task.destroy.mockImplementation(async () => pending.reject(new Error("load cancelled")));
  return { ...pending, task };
}

function pendingRender() {
  const pending = Promise.withResolvers<void>();
  return { ...pending, cancel: vi.fn(() => pending.resolve()) };
}

describe("PDFService", () => {
  let service: PDFService;
  let file: File;
  let page: ReturnType<typeof makePage>;
  let pdf: ReturnType<typeof makeDocument>;
  let task: LoadingTask;

  beforeEach(() => {
    page = makePage();
    pdf = makeDocument(page);
    task = makeTask(Promise.resolve(pdf));
    getDocument.mockReset().mockReturnValue(task);
    file = new File(["%PDF"], "source.pdf", { type: "application/pdf" });
    service = new PDFService();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as CanvasRenderingContext2D
    );
  });

  afterEach(async () => {
    await runPromise(service.dispose());
    vi.restoreAllMocks();
  });

  it("tracks the active PDF's page count", async () => {
    expect(service.getPageCount()).toBe(0);
    pdf.numPages = 2;
    await runPromise(service.loadPDF(file));
    expect(service.getPageCount()).toBe(2);
  });

  it("returns page dimensions for the requested rotation", async () => {
    const widePage = makePage(300, 150);
    pdf.getPage.mockResolvedValue(widePage);
    await expect(runPromise(service.getPageSize(file, 1, 90))).resolves.toEqual({
      width: 150,
      height: 300,
    });
    expect(pdf.getPage).toHaveBeenCalledExactlyOnceWith(1);
    expect(widePage.cleanup).toHaveBeenCalledTimes(1);
  });

  it("reads the source page rotation and cleans the page", async () => {
    page.rotate = 90;
    await expect(runPromise(service.getPageRotation(file, 1))).resolves.toBe(90);
    expect(page.cleanup).toHaveBeenCalledTimes(1);
  });

  it("reuses a resident PDF across sequential and concurrent loads", async () => {
    await Promise.all([runPromise(service.loadPDF(file)), runPromise(service.loadPDF(file))]);
    await runPromise(service.loadPDF(file));
    expect(getDocument).toHaveBeenCalledTimes(1);
  });

  it("releases one file while keeping another cached", async () => {
    const otherFile = new File(["%PDF"], "other.pdf", { type: "application/pdf" });
    const otherTask = makeTask(Promise.resolve(makeDocument()));
    getDocument.mockReturnValueOnce(task).mockReturnValueOnce(otherTask);
    await runPromise(service.loadPDF(file));
    await runPromise(service.loadPDF(otherFile));
    await runPromise(service.releaseFile(file));
    expect(service.getPageCount()).toBe(5);
    expect(task.destroy).toHaveBeenCalledTimes(1);
    expect(otherTask.destroy).not.toHaveBeenCalled();
    await runPromise(service.loadPDF(otherFile));
    expect(getDocument).toHaveBeenCalledTimes(2);
    await runPromise(service.loadPDF(file));
    expect(getDocument).toHaveBeenCalledTimes(3);
  });

  it.each(["release", "reset"] as const)(
    "cancels pending loads on %s, cleans late documents, and allows a reload",
    async (action) => {
      const pending = pendingLoad();
      pending.task.destroy.mockResolvedValue(undefined);
      getDocument.mockReturnValueOnce(pending.task);
      const load = runFork(service.loadPDF(file));
      await vi.waitFor(() => expect(getDocument).toHaveBeenCalledTimes(1));

      const cleanup = runPromise(
        action === "release" ? service.releaseFile(file) : service.reset()
      );
      pending.resolve(pdf);
      await expect(runPromise(Fiber.join(load))).rejects.toMatchObject({
        operation: "release-file",
        file,
      });
      await cleanup;
      expect(pending.task.destroy).toHaveBeenCalledTimes(1);
      expect(pdf.cleanup).toHaveBeenCalledTimes(1);
      expect(service.getPageCount()).toBe(0);
      await runPromise(service.loadPDF(file));
      expect(getDocument).toHaveBeenCalledTimes(2);
    }
  );

  it.each(["release", "reset"] as const)(
    "reports late document cleanup failure during %s",
    async (action) => {
      const pending = pendingLoad();
      pending.task.destroy.mockResolvedValue(undefined);
      pdf.cleanup.mockRejectedValue(new Error("late cleanup failed"));
      getDocument.mockReturnValueOnce(pending.task);
      const load = runFork(service.loadPDF(file));
      await vi.waitFor(() => expect(getDocument).toHaveBeenCalledOnce());

      const cleanup = runPromise(
        action === "release" ? service.releaseFile(file) : service.reset()
      );
      const failure = expect(cleanup).rejects.toMatchObject({ operation: "cleanup-pdf-js", file });
      await vi.waitFor(() => expect(pending.task.destroy).toHaveBeenCalledOnce());
      pending.resolve(pdf);

      await failure;
      await expect(runPromise(Fiber.join(load))).rejects.toMatchObject({
        operation: "release-file",
      });
      expect(pdf.cleanup).toHaveBeenCalledOnce();
    }
  );

  it("waits for duplicate cleanup and retains the first successful document", async () => {
    const first = pendingLoad();
    const second = pendingLoad();
    const duplicate = makeDocument();
    const cleanup = Promise.withResolvers<void>();
    duplicate.cleanup.mockReturnValue(cleanup.promise);
    getDocument.mockReturnValueOnce(first.task).mockReturnValueOnce(second.task);
    const firstLoad = runFork(service.loadPDF(file));
    const secondLoad = runFork(service.loadPDFWithPassword(file, "password"));
    await vi.waitFor(() => expect(getDocument).toHaveBeenCalledTimes(2));
    first.resolve(pdf);
    await runPromise(Fiber.join(firstLoad));
    second.resolve(duplicate);
    await vi.waitFor(() => expect(duplicate.cleanup).toHaveBeenCalledTimes(1));
    expect(secondLoad.pollUnsafe()).toBeUndefined();
    expect(pdf.cleanup).not.toHaveBeenCalled();
    expect(first.task.destroy).not.toHaveBeenCalled();
    cleanup.resolve();
    await runPromise(Fiber.join(secondLoad));
    expect(second.task.destroy).toHaveBeenCalledTimes(1);
    await runPromise(service.releaseFile(file));
    expect(pdf.cleanup).toHaveBeenCalledTimes(1);
    expect(first.task.destroy).toHaveBeenCalledTimes(1);
  });

  it("keeps a shared load alive when one consumer is interrupted", async () => {
    const pending = pendingLoad();
    getDocument.mockReturnValueOnce(pending.task);
    const first = runFork(service.loadPDF(file));
    const second = runFork(service.loadPDF(file));
    await vi.waitFor(() => expect(getDocument).toHaveBeenCalledTimes(1));
    await runPromise(Fiber.interrupt(first));
    pending.resolve(pdf);
    await runPromise(Fiber.join(second));
    expect(service.getPageCount()).toBe(5);
    expect(pending.task.destroy).not.toHaveBeenCalled();
  });

  it.each([false, true])("reset destroys a pending load, detached=%s", async (detached) => {
    const pending = pendingLoad();
    getDocument.mockReturnValueOnce(pending.task);
    const load = runFork(service.loadPDF(file));
    await vi.waitFor(() => expect(getDocument).toHaveBeenCalledTimes(1));
    if (detached) await runPromise(Fiber.interrupt(load));
    expect(pending.task.destroy).not.toHaveBeenCalled();
    await runPromise(service.reset());
    await runPromise(Fiber.await(load));
    expect(pending.task.destroy).toHaveBeenCalledTimes(1);
  });

  it.each([1, 2])(
    "reset reports destruction failures and cancels all %s pending loads",
    async (count) => {
      const loads = Array.from({ length: count }, () => pendingLoad());
      for (const load of loads) {
        load.task.destroy.mockImplementation(async () => {
          load.reject(new Error("load cancelled"));
          throw new Error("worker destroy failed");
        });
        getDocument.mockReturnValueOnce(load.task);
      }
      const fibers = [runFork(service.loadPDF(file))];
      if (count === 2) fibers.push(runFork(service.loadPDFWithPassword(file, "password")));
      await vi.waitFor(() => expect(getDocument).toHaveBeenCalledTimes(count));
      await expect(runPromise(service.reset())).rejects.toMatchObject({
        operation: "destroy-pdf-js",
        file,
      });
      await Promise.all(fibers.map((fiber) => runPromise(Fiber.await(fiber))));
      for (const load of loads) expect(load.task.destroy).toHaveBeenCalledTimes(1);
    }
  );

  it.each([false, true])(
    "cleans failed loads and allows retries, destruction fails=%s",
    async (destroyFails) => {
      const failedTask = makeTask(Promise.resolve(pdf));
      if (destroyFails) failedTask.destroy.mockRejectedValue(new Error("worker destroy failed"));
      getDocument.mockImplementationOnce(() => {
        failedTask.promise = Promise.reject(new Error("invalid PDF"));
        return failedTask;
      });
      await expect(runPromise(service.loadPDF(file))).rejects.toMatchObject({
        operation: destroyFails ? "destroy-pdf-js" : "load-pdf-js",
        file,
      });
      expect(failedTask.destroy).toHaveBeenCalledTimes(1);
      await runPromise(service.loadPDF(file));
      expect(service.getPageCount()).toBe(5);
      expect(getDocument).toHaveBeenCalledTimes(2);
    }
  );

  it.each([
    { password: undefined, reason: "needs-password" },
    { password: "wrong", reason: "wrong-password" },
  ] as const)("maps PDF.js password errors to $reason", async ({ password, reason }) => {
    getDocument.mockImplementationOnce(() =>
      makeTask(
        Promise.reject(Object.assign(new Error("Password required"), { name: "PasswordException" }))
      )
    );
    await expect(
      runPromise(
        password === undefined ? service.loadPDF(file) : service.loadPDFWithPassword(file, password)
      )
    ).rejects.toMatchObject({ name: "PDFPasswordRequiredError", reason, file });
  });

  it("uses the supplied password and forgets it on reset", async () => {
    await runPromise(service.loadPDFWithPassword(file, "623"));
    expect(getDocument).toHaveBeenCalledExactlyOnceWith({
      data: new Uint8Array(await file.arrayBuffer()),
      password: "623",
    });
    expect(service.getPassword(file)).toBe("623");
    expect(service.getPageCount()).toBe(5);
    await runPromise(service.renderPage(file, 1, document.createElement("canvas")));
    await runPromise(service.reset());
    expect(service.getPageCount()).toBe(0);
    expect(service.getPassword(file)).toBeUndefined();
    getDocument.mockImplementationOnce(() =>
      makeTask(
        Promise.reject(Object.assign(new Error("Password required"), { name: "PasswordException" }))
      )
    );
    await expect(
      runPromise(service.renderPage(file, 1, document.createElement("canvas")))
    ).rejects.toBeInstanceOf(PDFPasswordRequiredError);
    expect(getDocument).toHaveBeenLastCalledWith({
      data: new Uint8Array(await file.arrayBuffer()),
    });
  });

  it("renders the requested source even after another file becomes active", async () => {
    const wide = new File(["%PDF"], "wide.pdf", { type: "application/pdf" });
    getDocument
      .mockReturnValueOnce(task)
      .mockReturnValueOnce(makeTask(Promise.resolve(makeDocument(makePage(300, 150)))));
    await runPromise(service.loadPDF(file));
    await runPromise(service.loadPDF(wide));
    const portraitCanvas = document.createElement("canvas");
    const wideCanvas = document.createElement("canvas");
    await Promise.all([
      runPromise(service.renderPage(file, 1, portraitCanvas, 1, 0)),
      runPromise(service.renderPage(wide, 1, wideCanvas, 1, 0)),
    ]);
    expect([portraitCanvas.width, portraitCanvas.height]).toEqual([100, 200]);
    expect([wideCanvas.width, wideCanvas.height]).toEqual([300, 150]);
  });

  it("renders the requested page at the requested scale and rotation", async () => {
    const canvas = document.createElement("canvas");
    await runPromise(service.renderPage(file, 2, canvas, 2, 90));
    expect([canvas.width, canvas.height]).toEqual([400, 200]);
    expect(pdf.getPage).toHaveBeenCalledExactlyOnceWith(2);
    expect(page.cleanup).toHaveBeenCalledTimes(1);
  });

  it("limits page acquisition and rendering to two concurrent pages", async () => {
    const renders = [pendingRender(), pendingRender(), pendingRender()];
    const pages = renders.map((render) => {
      const page = makePage();
      page.render.mockReturnValue(render);
      return page;
    });
    pdf.getPage.mockImplementation(async (number) => pages[number - 1]);
    const fibers = [1, 2, 3].map((number) =>
      runFork(service.renderPage(file, number, document.createElement("canvas")))
    );
    await vi.waitFor(() => expect(pages[1].render).toHaveBeenCalledTimes(1));
    expect(pdf.getPage).toHaveBeenCalledTimes(2);
    expect(pages[2].render).not.toHaveBeenCalled();
    renders[0].resolve();
    await vi.waitFor(() => expect(pages[2].render).toHaveBeenCalledTimes(1));
    expect(pages[0].cleanup).toHaveBeenCalledTimes(1);
    renders[1].resolve();
    renders[2].resolve();
    await Promise.all(fibers.map((fiber) => runPromise(Fiber.join(fiber))));
    for (const page of pages) expect(page.cleanup).toHaveBeenCalledTimes(1);
  });

  it("reports a page metadata cleanup failure", async () => {
    page.cleanup.mockReturnValue(false);
    await expect(runPromise(service.getPageRotation(file, 1))).rejects.toMatchObject({
      operation: "get-page-rotation",
      file,
    });
  });

  it.each(["document", "worker"] as const)(
    "reports %s cleanup failure and attempts both cleanups",
    async (failure) => {
      await runPromise(service.loadPDF(file));
      if (failure === "document")
        pdf.cleanup.mockRejectedValue(new Error("document cleanup failed"));
      else task.destroy.mockRejectedValue(new Error("worker destroy failed"));
      await expect(runPromise(service.releaseFile(file))).rejects.toMatchObject({
        operation: failure === "document" ? "cleanup-pdf-js" : "destroy-pdf-js",
        file,
      });
      expect(pdf.cleanup).toHaveBeenCalledTimes(1);
      expect(task.destroy).toHaveBeenCalledTimes(1);
    }
  );

  it("propagates the same cleanup failure to concurrent release callers", async () => {
    const cleanup = Promise.withResolvers<void>();
    pdf.cleanup.mockReturnValue(cleanup.promise);
    await runPromise(service.loadPDF(file));
    const first = runFork(service.releaseFile(file));
    await vi.waitFor(() => expect(pdf.cleanup).toHaveBeenCalledTimes(1));
    const second = runFork(service.releaseFile(file));
    cleanup.reject(new Error("document cleanup failed"));
    for (const fiber of [first, second]) {
      await expect(runPromise(Fiber.join(fiber))).rejects.toMatchObject({
        operation: "cleanup-pdf-js",
        file,
      });
    }
    expect(pdf.cleanup).toHaveBeenCalledTimes(1);
    expect(task.destroy).toHaveBeenCalledTimes(1);
  });

  it("finishes resident cleanup even when the release is interrupted", async () => {
    const cleanup = Promise.withResolvers<void>();
    pdf.cleanup.mockReturnValue(cleanup.promise);
    await runPromise(service.loadPDF(file));
    const release = runFork(service.releaseFile(file));
    await vi.waitFor(() => expect(pdf.cleanup).toHaveBeenCalledTimes(1));
    const interruption = runFork(Fiber.interrupt(release));
    await runPromise(Effect.yieldNow);
    expect(interruption.pollUnsafe()).toBeUndefined();
    cleanup.resolve();
    await runPromise(Fiber.join(interruption));
    expect(pdf.cleanup).toHaveBeenCalledTimes(1);
    expect(task.destroy).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])(
    "cancels an interrupted render and preserves cleanup results, cleanup succeeds=%s",
    async (succeeds) => {
      const render = pendingRender();
      page.render.mockReturnValue(render);
      page.cleanup.mockReturnValue(succeeds);
      const fiber = runFork(service.renderPage(file, 1, document.createElement("canvas")));
      await vi.waitFor(() => expect(page.render).toHaveBeenCalledTimes(1));
      await runPromise(Fiber.interrupt(fiber));
      expect(render.cancel).toHaveBeenCalledTimes(1);
      expect(page.cleanup).toHaveBeenCalledTimes(1);
      if (!succeeds)
        await expect(runPromise(Fiber.join(fiber))).rejects.toMatchObject({
          operation: "render-page",
          file,
        });
    }
  );

  it("reports page cleanup failures during release and still closes the document", async () => {
    const render = pendingRender();
    page.render.mockReturnValue(render);
    page.cleanup.mockReturnValue(false);
    const fiber = runFork(service.renderPage(file, 1, document.createElement("canvas")));
    await vi.waitFor(() => expect(page.render).toHaveBeenCalledTimes(1));
    await expect(runPromise(service.releaseFile(file))).rejects.toMatchObject({
      operation: "render-page",
      file,
    });
    expect(pdf.cleanup).toHaveBeenCalledTimes(1);
    expect(task.destroy).toHaveBeenCalledTimes(1);
    await runPromise(Fiber.await(fiber));
  });

  it("awaits cancelled rendering and page cleanup before closing the document", async () => {
    const render = pendingRender();
    render.cancel.mockImplementation(() => {});
    page.render.mockReturnValue(render);
    const fiber = runFork(service.renderPage(file, 1, document.createElement("canvas")));
    await vi.waitFor(() => expect(page.render).toHaveBeenCalledTimes(1));
    const release = runFork(service.releaseFile(file));
    await vi.waitFor(() => expect(render.cancel).toHaveBeenCalledTimes(1));
    expect(pdf.cleanup).not.toHaveBeenCalled();
    expect(page.cleanup).not.toHaveBeenCalled();
    render.resolve();
    await runPromise(Fiber.join(release));
    expect(page.cleanup).toHaveBeenCalledTimes(1);
    expect(pdf.cleanup).toHaveBeenCalledTimes(1);
    expect(page.cleanup.mock.invocationCallOrder[0]).toBeLessThan(
      pdf.cleanup.mock.invocationCallOrder[0]
    );
    await runPromise(Fiber.await(fiber));
  });

  it("awaits a late metadata page and cleans it before closing the document", async () => {
    const pending = Promise.withResolvers<ReturnType<typeof makePage>>();
    pdf.getPage.mockReturnValue(pending.promise);
    const metadata = runFork(service.getPageRotation(file, 1));
    await vi.waitFor(() => expect(pdf.getPage).toHaveBeenCalledTimes(1));
    const release = runFork(service.releaseFile(file));
    await runPromise(Effect.yieldNow);
    expect(pdf.cleanup).not.toHaveBeenCalled();
    pending.resolve(page);
    await runPromise(Fiber.join(release));
    expect(Exit.isFailure(await runPromise(Fiber.await(metadata)))).toBe(true);
    expect(page.cleanup).toHaveBeenCalledTimes(1);
    expect(page.cleanup.mock.invocationCallOrder[0]).toBeLessThan(
      pdf.cleanup.mock.invocationCallOrder[0]
    );
  });

  it.each(["load", "render"] as const)(
    "rejects a stale %s operation started after release begins",
    async (operation) => {
      const cleanup = Promise.withResolvers<void>();
      pdf.cleanup.mockReturnValue(cleanup.promise);
      await runPromise(service.loadPDF(file));
      const stale =
        operation === "load"
          ? service.loadPDF(file)
          : service.renderPage(file, 1, document.createElement("canvas"));
      const release = runFork(service.releaseFile(file));
      await vi.waitFor(() => expect(pdf.cleanup).toHaveBeenCalledTimes(1));
      const fiber = runFork(stale);
      cleanup.resolve();
      await runPromise(Fiber.join(release));
      await expect(runPromise(Fiber.join(fiber))).rejects.toMatchObject({
        operation: operation === "load" ? "load-pdf" : "render-page",
        file,
      });
      expect(getDocument).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    { action: "release", operation: "load" },
    { action: "release", operation: "render" },
    { action: "reset", operation: "render" },
  ] as const)("holds a new $operation behind $action cleanup", async ({ action, operation }) => {
    const cleanup = Promise.withResolvers<void>();
    pdf.cleanup.mockReturnValue(cleanup.promise);
    await runPromise(service.loadPDF(file));
    const release = runFork(action === "release" ? service.releaseFile(file) : service.reset());
    await vi.waitFor(() => expect(pdf.cleanup).toHaveBeenCalledTimes(1));
    const next = runFork(
      operation === "load"
        ? service.loadPDF(file)
        : service.renderPage(file, 1, document.createElement("canvas"))
    );
    await runPromise(Effect.yieldNow);
    expect(next.pollUnsafe()).toBeUndefined();
    expect(getDocument).toHaveBeenCalledTimes(1);
    cleanup.resolve();
    await runPromise(Fiber.join(release));
    await runPromise(Fiber.join(next));
    expect(getDocument).toHaveBeenCalledTimes(2);
  });

  it("cancels queued renders without acquiring their pages", async () => {
    const renders: ReturnType<typeof pendingRender>[] = [];
    page.render.mockImplementation(() => {
      const render = pendingRender();
      renders.push(render);
      return render;
    });
    const fibers = [1, 2, 3].map((number) =>
      runFork(service.renderPage(file, number, document.createElement("canvas")))
    );
    await vi.waitFor(() => expect(page.render).toHaveBeenCalledTimes(2));
    await runPromise(service.releaseFile(file));
    expect(pdf.getPage).toHaveBeenCalledTimes(2);
    for (const render of renders) expect(render.cancel).toHaveBeenCalledTimes(1);
    expect(page.cleanup).toHaveBeenCalledTimes(2);
    expect(pdf.cleanup).toHaveBeenCalledTimes(1);
    for (const fiber of fibers) {
      expect(Exit.isFailure(await runPromise(Fiber.await(fiber)))).toBe(true);
    }
  });

  it("reset cancels active renders for every source before document cleanup", async () => {
    const otherFile = new File(["%PDF"], "other.pdf", { type: "application/pdf" });
    const otherPage = makePage();
    const otherPdf = makeDocument(otherPage);
    const renders = [pendingRender(), pendingRender()];
    page.render.mockReturnValue(renders[0]);
    otherPage.render.mockReturnValue(renders[1]);
    getDocument.mockReturnValueOnce(task).mockReturnValueOnce(makeTask(Promise.resolve(otherPdf)));
    const fibers = [file, otherFile].map((source) =>
      runFork(service.renderPage(source, 1, document.createElement("canvas")))
    );
    await vi.waitFor(() => expect(otherPage.render).toHaveBeenCalledTimes(1));
    await runPromise(service.reset());
    for (const [index, document] of [pdf, otherPdf].entries()) {
      expect(renders[index].cancel).toHaveBeenCalledTimes(1);
      expect(document.cleanup).toHaveBeenCalledTimes(1);
      expect(renders[index].cancel.mock.invocationCallOrder[0]).toBeLessThan(
        document.cleanup.mock.invocationCallOrder[0]
      );
    }
    await Promise.all(fibers.map((fiber) => runPromise(Fiber.await(fiber))));
  });

  it("cleans the page after a rendering failure", async () => {
    page.render.mockImplementationOnce(() => ({
      promise: Promise.reject(new Error("render failed")),
      cancel: vi.fn(),
    }));
    await expect(
      runPromise(service.renderPage(file, 1, document.createElement("canvas")))
    ).rejects.toThrow("render failed");
    expect(page.cleanup).toHaveBeenCalledTimes(1);
  });

  it("cleans the page when the canvas has no 2D context", async () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    await expect(
      runPromise(service.renderPage(file, 1, document.createElement("canvas")))
    ).rejects.toThrow("Could not get canvas context");
    expect(page.render).not.toHaveBeenCalled();
    expect(page.cleanup).toHaveBeenCalledTimes(1);
  });
});
