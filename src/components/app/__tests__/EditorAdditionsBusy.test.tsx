import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { Effect } from "effect";
import { unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { batch, createSignal } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { expect, it, vi } from "vitest";
import {
  emptyOrganizationHistory,
  recordOrganization,
  snapshotOrganization,
} from "../../../controllers/editor-history";
import { createPageStates } from "../../../controllers/editor-page-state";
import { inspectExport } from "../../../services/__tests__/pdf-export-inspection";
import { PDFImageExportService } from "../../../services/pdf-image-export-service";
import { PDFOperationsService } from "../../../services/pdf-operations-service";
import { makePDFRuntime } from "../../../services/pdf-runtime";
import * as pdfText from "../../../services/pdf-text";
import type { AddedText, PageState } from "../../../types/interfaces";
import EditorAdditionsEditor from "../EditorAdditionsEditor";

const geometry = {
  bounds: [0, 0, 400, 600] as const,
  userUnit: 1,
  width: 400,
  height: 600,
  transform: [1, 0, 0, -1, 0, 600] as const,
};
vi.mock("../../../services/pdf-service", () => ({
  PDFService: class {
    getPageGeometry = () => Effect.succeed(geometry);
    getPageRotation = () => Effect.succeed(0);
    reset = () => Effect.void;
    dispose = () => Effect.void;
  },
}));

it.each([
  ["PDF", "retry"],
  ["PDF", "cancel"],
  ["PNG", "retry"],
  ["PNG", "cancel"],
  ["PDF", "finish before validation"],
] as const)("held manual validation during %s export supports %s", async (format, action) => {
  const source = await PDFDocument.create();
  source.addPage([400, 600]).drawText("Original");
  const bytes = new Uint8Array(await source.save());
  const file = new File([bytes], "source.pdf");
  const pending = Promise.withResolvers<void>(),
    validated = Promise.withResolvers<void>(),
    reached = Promise.withResolvers<void>(),
    resume = Promise.withResolvers<void>();
  const validate = pdfText.validateAddedText;
  let hold = true;
  const validation = vi.spyOn(pdfText, "validateAddedText").mockImplementation(async (...args) => {
    const result = await validate(...args);
    if (!hold) return result;
    hold = false;
    validated.resolve();
    await pending.promise;
    return result;
  });
  const read = file.arrayBuffer.bind(file);
  let reads = 0;
  vi.spyOn(file, "arrayBuffer").mockImplementation(async () => {
    if (++reads === 2) {
      reached.resolve();
      await resume.promise;
    }
    return read();
  });
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
    new DOMRect(0, 0, 400, 600),
  ] as unknown as DOMRectList);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 400, 600)
  );
  const runtime = makePDFRuntime();
  const operations = new PDFOperationsService({
    renderPage: () => Effect.void,
    getPageGeometry: () => Effect.succeed(geometry),
  });
  const [pages, setPages] = createStore(createPageStates(file, 1));
  const [busy, setBusy] = createSignal(false),
    [history, setHistory] = createSignal(emptyOrganizationHistory());
  const onChange = vi.fn((pageId: string, texts: readonly AddedText[], label: string) => {
    const before = snapshotOrganization(pages, new Set(), pages[0].id);
    batch(() => {
      setPages(
        reconcile(
          pages.map((page) => (page.id === pageId ? { ...page, addedText: [...texts] } : page)),
          { key: "id" }
        )
      );
      setHistory(
        recordOrganization(
          history(),
          label,
          before,
          snapshotOrganization(pages, new Set(), pages[0].id)
        )
      );
    });
  });
  // jsdom cannot rasterize. These bytes expose which committed state the real PNG
  // archive service handed to the renderer; browser tests cover the actual pixels.
  const raster = (page: Pick<PageState, "addedText">, canvas: HTMLCanvasElement) =>
    Effect.sync(() => {
      canvas.dataset.content = page.addedText?.map((text) => text.text).join(" ") ?? "Original";
    });
  const images = new PDFImageExportService({
    getPageRotation: () =>
      Effect.promise(async () => {
        reached.resolve();
        await resume.promise;
        return 0;
      }),
    renderPage: (_file, _number, canvas) => raster({}, canvas),
    renderPageState: (page, canvas) => raster(page, canvas),
  });
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    callback
  ) {
    callback(new Blob([this.dataset.content ?? ""], { type: "image/png" }));
  });
  const toolbar = document.createElement("div"),
    header = document.createElement("div"),
    stage = document.createElement("section"),
    external = document.createElement("button");
  document.body.append(toolbar, header, stage, external);
  const view = render(() => (
    <EditorAdditionsEditor
      page={pages[0]}
      runtime={runtime}
      toolbar={toolbar}
      header={header}
      stage={stage}
      ready
      disabled={busy()}
      onChange={onChange}
      onEditing={() => {}}
      registerTap={() => {}}
      registerGesture={() => {}}
    />
  ));
  let exported: Promise<string> | undefined;
  async function exportContent() {
    if (format === "PDF")
      return (await inspectExport((await Effect.runPromise(operations.buildPDF(pages))).data))
        .serialized;
    const result = await Effect.runPromise(images.exportImages(pages));
    return new TextDecoder().decode(
      unzipSync(new Uint8Array(await result.data.arrayBuffer()))["page-001.png"]
    );
  }
  try {
    fireEvent.click(screen.getByRole("button", { name: "Add text" }));
    await waitFor(() =>
      expect(document.querySelector(".editor-text-layer")).toHaveAttribute(
        "data-geometry-ready",
        "true"
      )
    );
    setPages(0, "addedText", [
      { id: "saved", text: "Before", x: 100, y: 100, fontSize: 16, rotation: 0 },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Select additions" }));
    const hit = await screen.findByRole("button", { name: "Edit added text: Before" });
    hit.focus();
    fireEvent.click(hit);
    const input = screen.getByLabelText("Added text", { exact: true });
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.input(input, { target: { value: "After" } });
    fireEvent.input(screen.getByLabelText("Text size in points"), { target: { value: "18" } });
    fireEvent.click(screen.getByRole("button", { name: "Rotate text 90 degrees" }));
    const form = input.closest("form");
    if (!form) throw new Error("Missing text settings form");
    fireEvent.submit(form);
    await validated.promise;
    expect(validation).toHaveBeenCalledTimes(1);
    setBusy(true);
    exported = exportContent();
    const completion = exported.then(
      (value) => ({ value }),
      (error: unknown) => ({ error })
    );
    await reached.promise;
    if (action === "finish before validation") {
      resume.resolve();
      const result = await completion;
      if (!("value" in result)) throw result.error;
      setBusy(false);
    }
    external.focus();
    pending.resolve();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Saving…" })).not.toBeInTheDocument()
    );
    expect(external).toHaveFocus();
    if (action !== "finish before validation") {
      expect(onChange).not.toHaveBeenCalled();
      expect(history().undo).toHaveLength(0);
      expect(pages[0].addedText?.[0].text).toBe("Before");
      expect(input).toHaveValue("After");
      expect(screen.getByLabelText("Text size in points")).toHaveValue(18);
      expect(screen.getByRole("button", { name: "Drag text to move it" })).toHaveStyle({
        transform: "rotate(-270deg) translateY(-78%)",
      });
      expect(screen.getByRole("alert")).toHaveTextContent("Save your text when it finishes");
      resume.resolve();
      const result = await completion;
      if (!("value" in result)) throw result.error;
      if (format === "PDF") {
        expect(result.value).toContain("4265666F7265");
        expect(result.value).not.toContain("4166746572");
      } else expect(result.value).toBe("Before");
      setBusy(false);
      await Promise.resolve();
      expect(onChange).not.toHaveBeenCalled();
      if (action === "cancel") {
        input.focus();
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        await waitFor(() =>
          expect(screen.getByRole("button", { name: "Edit added text: Before" })).toHaveFocus()
        );
        expect(onChange).not.toHaveBeenCalled();
        expect(history().undo).toHaveLength(0);
        return;
      }
      fireEvent.submit(form);
    }
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(history().undo).toHaveLength(1);
    expect(history().redo).toHaveLength(0);
    expect(pages[0].addedText?.map((text) => text.text)).toEqual(["After"]);
    expect(pages[0].addedText?.[0]).toMatchObject({ fontSize: 18, rotation: 270 });
    expect(pages[0].sourceFile).toBe(file);
    expect(new Uint8Array(await read())).toEqual(bytes);
    const saved = await exportContent();
    if (format === "PDF") {
      expect(saved).toContain("4166746572");
      expect(saved).not.toContain("4265666F7265");
    } else expect(saved).toBe("After");
    const untouched = await Effect.runPromise(
      operations.buildPDF(pages.map((page) => ({ ...page, addedText: undefined })))
    );
    const original = await inspectExport(untouched.data);
    expect(original.serialized).not.toContain("4166746572");
    expect(original.serialized).not.toContain("4265666F7265");
  } finally {
    pending.resolve();
    resume.resolve();
    await exported?.catch(() => undefined);
    view.unmount();
    await runtime.dispose();
    await Effect.runPromise(operations.dispose());
    for (const element of [toolbar, header, stage, external]) element.remove();
    vi.restoreAllMocks();
  }
});
