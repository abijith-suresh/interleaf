import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { Effect } from "effect";
import { batch, createSignal } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { expect, it, vi } from "vitest";
import { answerField } from "../../../controllers/editor-field-state";
import {
  emptyOrganizationHistory,
  recordOrganization,
  snapshotOrganization,
} from "../../../controllers/editor-history";
import { createPageStates } from "../../../controllers/editor-page-state";
import { inspectExport } from "../../../services/__tests__/pdf-export-inspection";
import { textFieldFixture } from "../../../services/__tests__/pdf-field-fixtures";
import { PDFOperationsService } from "../../../services/pdf-operations-service";
import { makePDFRuntime } from "../../../services/pdf-runtime";
import type { PDFOperationResult } from "../../../types/interfaces";
import EditorFieldsEditor from "../EditorFieldsEditor";

it("held field validation cannot publish during a real export; draft retries atomically or cancels", async () => {
  const fixture = await textFieldFixture();
  const file = new File([new Uint8Array(fixture.bytes)], "same.pdf");
  const pending = Promise.withResolvers<void>(),
    validated = Promise.withResolvers<void>(),
    sourceRead = Promise.withResolvers<void>(),
    resume = Promise.withResolvers<void>();
  const read = file.arrayBuffer.bind(file);
  let exportReads = 0,
    gate = false,
    hold = true;
  vi.spyOn(file, "arrayBuffer").mockImplementation(async () => {
    if (gate && ++exportReads === 2) {
      sourceRead.resolve();
      await resume.promise;
    }
    return read();
  });
  const validate = PDFOperationsService.prototype.validateFieldAnswer;
  const spy = vi
    .spyOn(PDFOperationsService.prototype, "validateFieldAnswer")
    .mockImplementation(function (this: PDFOperationsService, ...args) {
      const validation = validate.apply(this, args);
      if (!hold) return validation;
      hold = false;
      return Effect.andThen(
        validation,
        Effect.promise(() => {
          validated.resolve();
          return pending.promise;
        })
      );
    });
  const runtime = makePDFRuntime(),
    exportService = new PDFOperationsService({ renderPage: () => Effect.void });
  const [pages, setPages] = createStore(createPageStates(file, 2));
  const [busy, setBusy] = createSignal(false),
    [history, setHistory] = createSignal(emptyOrganizationHistory());
  const toolbar = document.createElement("div"),
    stage = document.createElement("section");
  document.body.append(toolbar, stage);
  const onChange = vi.fn((pageId: string, ref: string, value: string) => {
    const before = snapshotOrganization(pages, new Set(), pages[0].id);
    batch(() => {
      setPages(reconcile(answerField(pages, pageId, ref, value), { key: "id" }));
      setHistory(
        recordOrganization(
          history(),
          "Fill field",
          before,
          snapshotOrganization(pages, new Set(), pages[0].id)
        )
      );
    });
  });
  const view = render(() => (
    <EditorFieldsEditor
      page={pages[0]}
      groupPageNumbers={[1, 2]}
      runtime={runtime}
      disabled={busy()}
      toolbar={toolbar}
      stage={stage}
      rotation={0}
      onOpen={() => {}}
      onClose={() => {}}
      focusInput={(input) => input.focus()}
      onChange={onChange}
      geometry={{
        bounds: [-20, -25, 290, 385],
        userUnit: 1,
        width: 310,
        height: 410,
        transform: [1, 0, 0, -1, 20, 385],
      }}
    />
  ));
  let exported: Promise<PDFOperationResult> | undefined;
  try {
    const hits = await screen.findAllByRole("button", { name: "Fill field: person.answer" });
    fireEvent.click(hits[0]);
    fireEvent.input(screen.getByRole("textbox"), { target: { value: "After" } });
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    // Wait until validation has read its own source before arming the export gate.
    await validated.promise;
    gate = true;
    setBusy(true);
    exported = Effect.runPromise(exportService.buildPDF(pages, { selectedIndices: [0] }));
    const completion = exported.then(
      (result) => ({ result }),
      (error: unknown) => ({ error })
    );
    await sourceRead.promise;
    pending.resolve();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Saving…" })).not.toBeInTheDocument()
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(history().undo).toHaveLength(0);
    expect(pages.every((page) => page.fieldAnswers === undefined && page.sourceFile === file)).toBe(
      true
    );
    expect(screen.getByRole("textbox")).toHaveValue("After");
    expect(screen.getByRole("alert")).toHaveTextContent("Save your answer when it finishes");
    resume.resolve();
    const completed = await completion;
    if (!("result" in completed)) throw completed.error;
    const original = await inspectExport(completed.result.data);
    expect(original.pageObjects).toBe(1);
    expect(original.widgetObjects).toBe(4);
    expect(
      original.pages[0].annotations.filter((a) => a.name === "person.answer").map((a) => a.value)
    ).toEqual(["INHERITED", "INHERITED"]);
    gate = false;
    setBusy(false);
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(history().undo).toHaveLength(1);
    expect(pages.map((page) => page.fieldAnswers)).toEqual([
      [{ fieldRef: fixture.fieldRef, value: "After" }],
      [{ fieldRef: fixture.fieldRef, value: "After" }],
    ]);
    fireEvent.click(hits[0]);
    fireEvent.input(screen.getByRole("textbox"), { target: { value: "Cancelled" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(history().undo).toHaveLength(1);
    fireEvent.click(hits[0]);
    expect(screen.getByRole("textbox")).toHaveValue("After");
  } finally {
    pending.resolve();
    resume.resolve();
    await exported?.catch(() => undefined);
    view.unmount();
    await runtime.dispose();
    await Effect.runPromise(exportService.dispose());
    toolbar.remove();
    stage.remove();
    vi.restoreAllMocks();
  }
});
