import { Effect, Fiber } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PageState } from "../../types/interfaces";
import { PDFService } from "../pdf-service";

const mocks = vi.hoisted(() => ({ getDocument: vi.fn(), dispose: vi.fn(), build: vi.fn() }));
vi.mock("pdfjs-dist", () => ({ getDocument: mocks.getDocument, GlobalWorkerOptions: {} }));
vi.mock("../pdf-operations-service", () => ({
  PDFOperationsService: class {
    buildPDF = mocks.build;
    dispose = mocks.dispose;
  },
}));

const textPage: PageState = {
  id: "page",
  sourceFile: new File(["source"], "source.pdf"),
  sourcePageNumber: 1,
  rotation: 90,
  markedForDeletion: false,
  addedText: [{ id: "text", text: "Hello", x: 10, y: 40, fontSize: 16, rotation: 0 }],
};

afterEach(() => vi.restoreAllMocks());

describe.each(["text", "checkmark"])("temporary edited-page rendering with %s", (kind) => {
  const page: PageState =
    kind === "text"
      ? textPage
      : {
          ...textPage,
          addedText: undefined,
          addedCheckmarks: [{ id: "tick", x: 10, y: 40, size: 16, rotation: 0 }],
        };
  it.each(["interrupt", "release", "reset", "dispose"] as const)(
    "settles cancellation and cleanup before document destruction on %s",
    async (operation) => {
      const service = new PDFService();
      const render = Promise.withResolvers<void>();
      const started = Promise.withResolvers<void>();
      const events: string[] = [];
      const cancel = vi.fn(() => {
        events.push("cancel");
      });
      const proxy = {
        getViewport: () => ({ width: 100, height: 200 }),
        render: () => {
          started.resolve();
          return { promise: render.promise, cancel };
        },
        cleanup: () => {
          events.push("page cleanup");
          return true;
        },
      };
      const destroy = vi.fn(async () => {
        events.push("destroy");
      });
      mocks.getDocument.mockReturnValue({
        promise: Promise.resolve({
          getPage: async () => proxy,
          cleanup: async () => {
            events.push("document cleanup");
          },
        }),
        destroy,
      });
      mocks.build.mockReturnValue(
        Effect.succeed({ data: new Uint8Array([1]), suggestedFileName: "edited.pdf" })
      );
      mocks.dispose.mockImplementation(() =>
        Effect.sync(() => {
          events.push("operations dispose");
        })
      );
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
        {} as CanvasRenderingContext2D
      );
      const fiber = Effect.runFork(
        service.renderPageState(page, document.createElement("canvas"), 1, 90)
      );
      await started.promise;
      const interruption =
        operation === "interrupt"
          ? Effect.runPromise(Fiber.interrupt(fiber))
          : Effect.runPromise(
              operation === "release"
                ? service.releaseFile(page.sourceFile)
                : operation === "reset"
                  ? service.reset()
                  : service.dispose()
            );
      await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
      expect(destroy).not.toHaveBeenCalled();
      render.resolve();
      await interruption;
      expect(events).toEqual([
        "cancel",
        "page cleanup",
        "document cleanup",
        "destroy",
        "operations dispose",
      ]);
      expect(mocks.build.mock.calls.at(-1)?.[0][0]).toMatchObject({
        sourceFile: page.sourceFile,
        rotation: 0,
        addedText: page.addedText,
        ...(page.addedCheckmarks ? { addedCheckmarks: page.addedCheckmarks } : {}),
      });
      await Effect.runPromise(service.dispose());
      expect(destroy).toHaveBeenCalledOnce();
    }
  );

  it("keeps the outer render registered after same-source metadata queries during generation", async () => {
    const service = new PDFService();
    const render = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const cancel = vi.fn(() => render.resolve());
    const generatedDestroyed = vi.fn(async () => {});
    const sourceDestroyed = vi.fn(async () => {});
    mocks.getDocument.mockImplementation(({ data }: { data: ArrayBuffer }) => ({
      promise: Promise.resolve({
        getPage: async () => ({
          rotate: 0,
          view: [0, 0, 100, 200],
          userUnit: 1,
          getViewport: () => ({ width: 100, height: 200, transform: [1, 0, 0, -1, 0, 200] }),
          render: () => {
            started.resolve();
            return { promise: render.promise, cancel };
          },
          cleanup: () => true,
        }),
        cleanup: async () => {},
      }),
      destroy: data.byteLength === 1 ? generatedDestroyed : sourceDestroyed,
    }));
    mocks.build.mockReturnValue(
      service
        .getPageGeometry(page.sourceFile, 1)
        .pipe(Effect.as({ data: new Uint8Array([1]), suggestedFileName: "edited.pdf" }))
    );
    mocks.dispose.mockReturnValue(Effect.void);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as CanvasRenderingContext2D
    );
    const fiber = Effect.runFork(
      service.renderPageState(page, document.createElement("canvas"), 1, 0)
    );
    try {
      await started.promise;
      await Effect.runPromise(service.reset());
      expect(cancel).toHaveBeenCalledOnce();
      expect(generatedDestroyed).toHaveBeenCalledOnce();
      expect(sourceDestroyed).toHaveBeenCalledOnce();
    } finally {
      render.resolve();
      await Effect.runPromise(Fiber.interrupt(fiber));
      await Effect.runPromise(service.dispose());
    }
  });

  it("bounds concurrent PDF generation before any derived bitmap is allocated", async () => {
    const service = new PDFService();
    const before = mocks.build.mock.calls.length;
    const disposed = mocks.dispose.mock.calls.length;
    mocks.build.mockReturnValue(Effect.never);
    mocks.dispose.mockReturnValue(Effect.void);
    const fibers = [1, 2, 3].map(() =>
      Effect.runFork(service.renderPageState(page, document.createElement("canvas"), 1, 0))
    );
    await vi.waitFor(() => expect(mocks.build).toHaveBeenCalledTimes(before + 2));
    await Effect.runPromise(Fiber.interrupt(fibers[2]));
    await Promise.all(fibers.slice(0, 2).map((fiber) => Effect.runPromise(Fiber.interrupt(fiber))));
    expect(mocks.dispose).toHaveBeenCalledTimes(disposed + 2);
    await Effect.runPromise(service.dispose());
  });

  it("disposes generation resources on build failure without opening a derived document", async () => {
    const service = new PDFService();
    const before = mocks.getDocument.mock.calls.length;
    mocks.build.mockReturnValue(Effect.fail(new Error("Cannot copy source")));
    mocks.dispose.mockReturnValue(Effect.void);
    const disposals = mocks.dispose.mock.calls.length;
    await expect(
      Effect.runPromise(service.renderPageState(page, document.createElement("canvas"), 1, 0))
    ).rejects.toThrow("Cannot copy source");
    expect(mocks.getDocument).toHaveBeenCalledTimes(before);
    expect(mocks.dispose).toHaveBeenCalledTimes(disposals + 1);
    await Effect.runPromise(service.dispose());
  });
});
