import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { Effect } from "effect";
import { createSignal } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { makePDFRuntime } from "../../../services/pdf-runtime";
import type { PageState } from "../../../types/interfaces";

const validate = vi.hoisted(() => vi.fn());
vi.mock("../../../services/pdf-operations-service", () => ({
  PDFOperationsService: class {
    getFields = () =>
      Effect.succeed({
        widgets: [
          {
            widgetRef: "14 0 R",
            fieldRef: "13 0 R",
            pageNumber: 1,
            label: "Answer",
            value: "Before",
            rect: [10, 10, 200, 40],
          },
        ],
      });
    validateFieldAnswer = validate;
    clearCache = () => Effect.void;
    dispose = () => Effect.void;
  },
}));

import EditorFieldsEditor from "../EditorFieldsEditor";

afterEach(() => vi.restoreAllMocks());
it.each(["failure", "success", "navigation", "disposal"])(
  "pending field validation preserves external focus after %s",
  async (outcome) => {
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
      new DOMRect(0, 0, 400, 600),
    ] as unknown as DOMRectList);
    const pending = Promise.withResolvers<void>();
    validate
      .mockReset()
      .mockReturnValue(Effect.tryPromise({ try: () => pending.promise, catch: (cause) => cause }));
    const runtime = makePDFRuntime();
    const original: PageState = {
      id: "page",
      sourceFile: new File(["pdf"], "same.pdf"),
      sourcePageNumber: 1,
      rotation: 0,
      markedForDeletion: false,
      fieldGroupId: "group",
    };
    const [page, setPage] = createSignal(original);
    const toolbar = document.createElement("div"),
      stage = document.createElement("section"),
      external = document.createElement("button");
    document.body.append(toolbar, stage, external);
    const onChange = vi.fn();
    const view = render(() => (
      <EditorFieldsEditor
        page={page()}
        groupPageNumbers={[1, 2]}
        runtime={runtime}
        toolbar={toolbar}
        stage={stage}
        geometry={{
          bounds: [0, 0, 400, 600],
          userUnit: 1,
          width: 400,
          height: 600,
          transform: [1, 0, 0, -1, 0, 600],
        }}
        rotation={0}
        onOpen={() => {}}
        onClose={() => {}}
        focusInput={(input) => input.focus()}
        onChange={onChange}
      />
    ));
    try {
      const hit = await screen.findByRole("button", { name: "Fill field: Answer" });
      hit.focus();
      fireEvent.click(hit);
      const input = screen.getByRole("textbox", { name: "Answer for Answer" });
      await waitFor(() => expect(input).toHaveFocus());
      fireEvent.input(input, { target: { value: "After" } });
      const form = input.closest("form");
      if (!form) throw Error("Missing field form");
      fireEvent.submit(form);
      await waitFor(() =>
        expect(validate).toHaveBeenCalledWith(
          original.sourceFile,
          { fieldRef: "13 0 R", value: "After" },
          [1, 2]
        )
      );
      external.focus();
      if (outcome === "navigation") setPage({ ...original, id: "next" });
      if (outcome === "disposal") view.unmount();
      if (outcome === "failure") pending.reject(new Error("Does not fit"));
      else pending.resolve();
      await pending.promise.catch(() => undefined);
      await waitFor(() => {
        if (outcome === "failure")
          expect(screen.getByRole("alert")).toHaveTextContent("Does not fit");
        if (outcome === "success") expect(onChange).toHaveBeenCalledWith("page", "13 0 R", "After");
        expect(external).toHaveFocus();
      });
      if (outcome === "navigation" || outcome === "disposal")
        expect(onChange).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      await runtime.dispose();
      for (const element of [toolbar, stage, external]) element.remove();
    }
  }
);
