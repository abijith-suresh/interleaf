import { Effect } from "effect";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { answerField } from "../../controllers/editor-field-state";
import { createPageStates } from "../../controllers/editor-page-state";
import type { PageState } from "../../types/interfaces";
import { PDFService } from "../pdf-service";
import { textFieldFixture } from "./pdf-field-fixtures";
import { makePDFDocument, makePDFPage } from "./pdf-fixtures";

const pdfjs = vi.hoisted(() => ({
  workers: 0,
  loads: [] as { data: Uint8Array; worker: unknown }[],
}));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  PDFWorker: class {
    constructor() {
      pdfjs.workers++;
    }
    destroy() {}
  },
  getDocument: (params: { data: Uint8Array; worker: unknown }) => {
    pdfjs.loads.push(params);
    return {
      promise: Promise.resolve(
        makePDFDocument({
          ...makePDFPage(340, 460),
          getViewport: ({ scale = 1 }) => ({
            width: 340 * scale,
            height: 460 * scale,
            transform: [scale, 0, 0, -scale, 0, 460 * scale],
          }),
        })
      ),
      destroy: async () => {},
    };
  },
}));

let service: PDFService;

beforeEach(() => {
  pdfjs.workers = 0;
  pdfjs.loads = [];
  service = new PDFService();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    {} as CanvasRenderingContext2D
  );
});

afterEach(async () => {
  await Effect.runPromise(service.dispose());
  vi.restoreAllMocks();
});

const render = (page: PageState) =>
  Effect.runPromise(service.renderPageState(page, document.createElement("canvas"), 1, 0));

it("renders a page without a widget for the answered field from its source", async () => {
  const fixture = await textFieldFixture();
  const source = new File([new Uint8Array(fixture.bytes)], "form.pdf", { type: "application/pdf" });
  // The other field has a widget only on page 2, but the answer is copied to both pages.
  const pages = createPageStates(source, 2);
  const answered = answerField(pages, pages[0].id, fixture.otherRef, "Answer");
  expect(answered.every((page) => page.fieldAnswers?.length === 1)).toBe(true);
  const load = vi.spyOn(PDFDocument, "load");

  await render(answered[0]);
  // Only the field inspection parses the source; nothing is built.
  expect(load).toHaveBeenCalledOnce();
  expect(pdfjs.loads.map(({ data }) => data.byteLength)).toEqual([source.size]);

  for (let index = 0; index < 3; index++) await render(answered[1]);
  // One parse for the cached export source, one private copy for the single build.
  expect(load).toHaveBeenCalledTimes(3);
  expect(pdfjs.loads).toHaveLength(2);
  expect(pdfjs.loads[1].data.byteLength).not.toBe(source.size);
  expect(pdfjs.workers).toBe(1);
  expect(new Set(pdfjs.loads.map(({ worker }) => worker)).size).toBe(1);
});

it("reuses the parsed source when another edited page of the same file is built", async () => {
  const fixture = await textFieldFixture();
  const source = new File([new Uint8Array(fixture.bytes)], "form.pdf", { type: "application/pdf" });
  const [first, second] = createPageStates(source, 2).map((page) => ({
    ...page,
    addedCheckmarks: [{ id: "tick", x: 40, y: 40, size: 16, rotation: 0 }],
  }));
  const load = vi.spyOn(PDFDocument, "load");

  await render(first);
  expect(load).toHaveBeenCalledTimes(2);
  await render(second);
  expect(load).toHaveBeenCalledTimes(3);

  await Effect.runPromise(service.releaseFile(source));
  await render(first);
  expect(load).toHaveBeenCalledTimes(5);
});
