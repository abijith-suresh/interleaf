import { Effect, Fiber } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PageState, PDFFields } from "../../types/interfaces";
import { PDFService } from "../pdf-service";
import { makePDFDocument, makePDFPage } from "./pdf-fixtures";

const mocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  build: vi.fn(),
  getFields: vi.fn(),
  releaseFile: vi.fn(),
  clearCache: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("pdfjs-dist", () => ({
  getDocument: mocks.getDocument,
  GlobalWorkerOptions: {},
  PDFWorker: class {
    destroy() {}
  },
}));
vi.mock("../pdf-operations-service", () => ({
  PDFOperationsService: class {
    buildPDF = mocks.build;
    getFields = mocks.getFields;
    releaseFile = mocks.releaseFile;
    clearCache = mocks.clearCache;
    dispose = mocks.dispose;
  },
}));

const hello = { id: "text", text: "Hello", x: 10, y: 40, fontSize: 16, rotation: 0 };

const textPage: PageState = {
  id: "page",
  sourceFile: new File(["source"], "source.pdf"),
  sourcePageNumber: 1,
  rotation: 90,
  markedForDeletion: false,
  addedText: [hello],
};

const fieldPage: PageState = {
  ...textPage,
  addedText: undefined,
  fieldGroupId: "group",
  fieldAnswers: [{ fieldRef: "12 0 R", value: "Answer" }],
};

function fieldsOn(pageNumber: number): PDFFields {
  return {
    widgets: [
      {
        widgetRef: "13 0 R",
        fieldRef: "12 0 R",
        pageNumber,
        label: "Name",
        value: "",
        rect: [0, 0, 100, 20],
      },
    ],
  };
}

function built(byte = 1) {
  return Effect.succeed({ data: new Uint8Array([byte]), suggestedFileName: "edited.pdf" });
}

function documentTask(events: string[] = []) {
  const destroy = vi.fn(async () => {
    events.push("destroy");
  });
  return {
    task: {
      promise: Promise.resolve(
        makePDFDocument({
          ...makePDFPage(),
          getViewport: () => ({ width: 100, height: 200, transform: [1, 0, 0, -1, 0, 200] }),
        })
      ),
      destroy,
    },
    destroy,
  };
}

beforeEach(() => {
  mocks.getFields.mockReturnValue(Effect.succeed(fieldsOn(1)));
  mocks.releaseFile.mockReturnValue(Effect.void);
  mocks.clearCache.mockReturnValue(Effect.void);
  mocks.dispose.mockReturnValue(Effect.void);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    {} as CanvasRenderingContext2D
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe.each(["text", "checkmark", "field"])("edited-page rendering with %s", (kind) => {
  const page: PageState =
    kind === "text"
      ? textPage
      : kind === "field"
        ? fieldPage
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
      mocks.build.mockReturnValue(built());
      mocks.dispose.mockImplementation(() =>
        Effect.sync(() => {
          events.push("operations dispose");
        })
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
      // A cancelled render keeps its built page for the next render.
      const settled = ["cancel", "page cleanup"];
      const destroyed = [...settled, "document cleanup", "destroy"];
      expect(events).toEqual(
        operation === "interrupt"
          ? settled
          : operation === "dispose"
            ? [...destroyed, "operations dispose"]
            : destroyed
      );
      if (operation === "release")
        expect(mocks.releaseFile).toHaveBeenCalledExactlyOnceWith(page.sourceFile);
      if (operation === "reset") expect(mocks.clearCache).toHaveBeenCalledOnce();
      expect(mocks.build.mock.calls.at(-1)?.[0][0]).toMatchObject({
        sourceFile: page.sourceFile,
        rotation: 0,
        addedText: page.addedText,
        ...(page.addedCheckmarks ? { addedCheckmarks: page.addedCheckmarks } : {}),
      });
      await Effect.runPromise(service.dispose());
      expect(destroy).toHaveBeenCalledOnce();
      expect(mocks.dispose).toHaveBeenCalledOnce();
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
      service.getPageGeometry(page.sourceFile, 1).pipe(Effect.andThen(built()))
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
    mocks.build.mockReturnValue(Effect.never);
    const pages = [1, 2, 3].map((sourcePageNumber) => ({ ...page, sourcePageNumber }));
    mocks.getFields.mockImplementation(() =>
      Effect.succeed({ widgets: pages.flatMap((page) => fieldsOn(page.sourcePageNumber).widgets) })
    );
    const fibers = pages.map((page) =>
      Effect.runFork(service.renderPageState(page, document.createElement("canvas"), 1, 0))
    );
    await vi.waitFor(() => expect(mocks.build).toHaveBeenCalledTimes(2));
    await Effect.runPromise(Effect.yieldNow);
    expect(mocks.build).toHaveBeenCalledTimes(2);
    await Effect.runPromise(Fiber.interrupt(fibers[0]));
    await vi.waitFor(() => expect(mocks.build).toHaveBeenCalledTimes(3));
    await Promise.all(fibers.slice(1).map((fiber) => Effect.runPromise(Fiber.interrupt(fiber))));
    expect(mocks.getDocument).not.toHaveBeenCalled();
    await Effect.runPromise(service.dispose());
  });

  it("opens no derived document after a build failure and retries the build", async () => {
    const service = new PDFService();
    mocks.build.mockReturnValue(Effect.fail(new Error("Cannot copy source")));
    for (let attempt = 1; attempt <= 2; attempt++) {
      await expect(
        Effect.runPromise(service.renderPageState(page, document.createElement("canvas"), 1, 0))
      ).rejects.toThrow("Cannot copy source");
      expect(mocks.build).toHaveBeenCalledTimes(attempt);
    }
    expect(mocks.getDocument).not.toHaveBeenCalled();
    await Effect.runPromise(service.dispose());
  });

  it("builds an unchanged edited page once for every render and rotation", async () => {
    const service = new PDFService();
    mocks.build.mockReturnValue(built());
    mocks.getDocument.mockImplementation(() => documentTask().task);
    const renders = [0, 90, 180].map((rotation) =>
      service.renderPageState({ ...page, rotation }, document.createElement("canvas"), 1, rotation)
    );
    await Effect.runPromise(Effect.all(renders, { concurrency: "unbounded" }));
    await Effect.runPromise(Effect.all(renders));

    expect(mocks.build).toHaveBeenCalledOnce();
    expect(mocks.getDocument).toHaveBeenCalledOnce();
    await Effect.runPromise(service.dispose());
  });

  it("builds again after the additions change or the source is released", async () => {
    const service = new PDFService();
    const derived: ReturnType<typeof documentTask>[] = [];
    mocks.build.mockReturnValue(built());
    mocks.getDocument.mockImplementation(() => {
      const next = documentTask();
      derived.push(next);
      return next.task;
    });
    const changed: PageState =
      kind === "text"
        ? { ...page, addedText: [{ ...hello, text: "Changed" }] }
        : kind === "field"
          ? { ...page, fieldAnswers: [{ fieldRef: "12 0 R", value: "Changed" }] }
          : { ...page, addedCheckmarks: [{ id: "tick", x: 20, y: 40, size: 16, rotation: 0 }] };
    const render = (state: PageState) =>
      Effect.runPromise(service.renderPageState(state, document.createElement("canvas"), 1, 0));

    await render(page);
    await render(changed);
    await render(page);
    expect(mocks.build).toHaveBeenCalledTimes(2);

    await Effect.runPromise(service.releaseFile(page.sourceFile));
    expect(derived.map(({ destroy }) => destroy.mock.calls.length)).toEqual([1, 1]);
    await render(page);
    expect(mocks.build).toHaveBeenCalledTimes(3);
    await Effect.runPromise(service.dispose());
  });
});

describe("edited-page rendering cache", () => {
  it("renders the source page when no answered field has a widget on it", async () => {
    const service = new PDFService();
    const canvas = document.createElement("canvas");
    mocks.getFields.mockReturnValue(Effect.succeed(fieldsOn(2)));
    mocks.getDocument.mockImplementation(() => documentTask().task);

    await Effect.runPromise(service.renderPageState(fieldPage, canvas, 1, 0));

    expect(mocks.getFields).toHaveBeenCalledExactlyOnceWith(fieldPage.sourceFile);
    expect(mocks.build).not.toHaveBeenCalled();
    expect(mocks.getDocument).toHaveBeenCalledOnce();
    expect(mocks.getDocument.mock.calls[0][0].data).toEqual(
      new Uint8Array(await fieldPage.sourceFile.arrayBuffer())
    );
    expect(canvas.width).toBe(100);
    await Effect.runPromise(service.dispose());
  });

  it("builds only with the answers that have a widget on the page", async () => {
    const service = new PDFService();
    mocks.build.mockReturnValue(built());
    mocks.getDocument.mockImplementation(() => documentTask().task);
    const page: PageState = {
      ...fieldPage,
      addedText: textPage.addedText,
      fieldAnswers: [...(fieldPage.fieldAnswers ?? []), { fieldRef: "20 0 R", value: "Other" }],
    };

    await Effect.runPromise(service.renderPageState(page, document.createElement("canvas"), 1, 0));

    expect(mocks.build.mock.calls[0][0][0].fieldAnswers).toEqual(fieldPage.fieldAnswers);
    expect(mocks.build.mock.calls[0][0][0].addedText).toEqual(textPage.addedText);
    await Effect.runPromise(service.dispose());
  });

  it("builds with every answer when the fields cannot be read", async () => {
    const service = new PDFService();
    mocks.getFields.mockReturnValue(Effect.fail(new Error("unreadable")));
    mocks.build.mockReturnValue(built());
    mocks.getDocument.mockImplementation(() => documentTask().task);

    await Effect.runPromise(
      service.renderPageState(fieldPage, document.createElement("canvas"), 1, 0)
    );

    expect(mocks.build.mock.calls[0][0][0].fieldAnswers).toEqual(fieldPage.fieldAnswers);
    await Effect.runPromise(service.dispose());
  });

  it("uses the runtime's editing support without owning it", async () => {
    const operations = { buildPDF: mocks.build, getFields: mocks.getFields };
    const service = new PDFService({ operations: Effect.succeed(operations) });
    mocks.build.mockReturnValue(built());
    mocks.getDocument.mockImplementation(() => documentTask().task);

    await Effect.runPromise(
      service.renderPageState(textPage, document.createElement("canvas"), 1, 0)
    );
    await Effect.runPromise(service.releaseFile(textPage.sourceFile));
    await Effect.runPromise(service.reset());
    await Effect.runPromise(service.dispose());

    expect(mocks.build).toHaveBeenCalledOnce();
    expect(mocks.releaseFile).not.toHaveBeenCalled();
    expect(mocks.clearCache).not.toHaveBeenCalled();
    expect(mocks.dispose).not.toHaveBeenCalled();
  });

  it("evicts the least recently used built pages beyond its limit", async () => {
    const service = new PDFService();
    const derived: ReturnType<typeof documentTask>[] = [];
    mocks.build.mockImplementation(() => built());
    mocks.getDocument.mockImplementation(() => {
      const next = documentTask();
      derived.push(next);
      return next.task;
    });
    const render = (sourcePageNumber: number) =>
      Effect.runPromise(
        service.renderPageState(
          { ...textPage, sourcePageNumber },
          document.createElement("canvas"),
          1,
          0
        )
      );

    for (let pageNumber = 1; pageNumber <= 32; pageNumber++) await render(pageNumber);
    await render(1);
    await render(33);
    expect(derived.map(({ destroy }) => destroy.mock.calls.length)).toEqual([
      0,
      1,
      ...Array(31).fill(0),
    ]);
    await render(1);
    expect(mocks.build).toHaveBeenCalledTimes(33);
    await Effect.runPromise(service.dispose());
  });
});
