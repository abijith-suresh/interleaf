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
            rect: [10, 560, 200, 590],
          },
          {
            widgetRef: "15 0 R",
            fieldRef: "13 0 R",
            pageNumber: 1,
            label: "Answer",
            value: "Before",
            rect: [10, 520, 200, 550],
          },
          {
            widgetRef: "17 0 R",
            fieldRef: "16 0 R",
            pageNumber: 1,
            label: "Other",
            value: "Other before",
            rect: [10, 480, 200, 510],
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
        active
        onActivate={() => {}}
        hint={toolbar}
        focusInput={(input) => input.focus()}
        onChange={onChange}
      />
    ));
    try {
      const hit = (await screen.findAllByRole("button", { name: "Fill field: Answer" }))[0];
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
        if (outcome === "success")
          expect(onChange).toHaveBeenCalledWith("page", "13 0 R", "After", "Before");
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

it.each(["Save", "Cancel"])(
  "field navigation retains other terminal drafts after own %s",
  async (action) => {
    validate.mockReset().mockReturnValue(Effect.void);
    const runtime = makePDFRuntime();
    const [page, setPage] = createSignal<PageState>({
      id: "page",
      sourceFile: new File(["pdf"], "same.pdf"),
      sourcePageNumber: 1,
      rotation: 0,
      markedForDeletion: false,
      fieldGroupId: "group",
    });
    const toolbar = document.createElement("div"),
      stage = document.createElement("section");
    document.body.append(toolbar, stage);
    const onChange = vi.fn((_: string, fieldRef: string, value: string) =>
      setPage({ ...page(), fieldAnswers: [{ fieldRef, value }] })
    );
    const view = render(() => (
      <EditorFieldsEditor
        page={page()}
        groupPageNumbers={[1]}
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
        active
        onActivate={() => {}}
        hint={toolbar}
        focusInput={(input) => input.focus()}
        onChange={onChange}
      />
    ));
    try {
      const hits = await screen.findAllByRole("button", { name: "Fill field: Answer" });
      fireEvent.click(hits[0]);
      fireEvent.input(screen.getByRole("textbox"), { target: { value: "Draft A" } });
      fireEvent.click(screen.getByRole("button", { name: "Next field" }));
      expect(screen.getByRole("textbox")).toHaveValue("Draft A");
      fireEvent.keyDown(screen.getByRole("textbox"), { key: "ArrowDown", altKey: true });
      fireEvent.input(screen.getByRole("textbox"), { target: { value: "Draft B" } });
      if (action === "Save") fireEvent.submit(screen.getByRole("textbox").closest("form")!);
      else fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(screen.queryByRole("textbox")).not.toBeInTheDocument());
      fireEvent.click(hits[0]);
      expect(screen.getByRole("textbox")).toHaveValue("Draft A");
      fireEvent.click(screen.getByRole("button", { name: "Fill field: Other" }));
      expect(screen.getByRole("textbox")).toHaveValue(
        action === "Save" ? "Draft B" : "Other before"
      );
      fireEvent.click(hits[1]);
      expect(screen.getByRole("textbox")).toHaveValue("Draft A");
      expect(onChange).toHaveBeenCalledTimes(action === "Save" ? 1 : 0);
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      fireEvent.click(hits[0]);
      expect(screen.getByRole("textbox")).toHaveValue("Before");
      // An external history/group change invalidates ephemeral drafts.
      fireEvent.input(screen.getByRole("textbox"), { target: { value: "Stale" } });
      setPage({ ...page(), fieldGroupId: "restored" });
      fireEvent.click(hits[0]);
      expect(screen.getByRole("textbox")).toHaveValue("Before");
    } finally {
      view.unmount();
      await runtime.dispose();
      toolbar.remove();
      stage.remove();
    }
  }
);

it("reports the open answer and keeps other unsaved answers across history on the same page", async () => {
  validate.mockReset().mockReturnValue(Effect.void);
  const runtime = makePDFRuntime();
  const [page, setPage] = createSignal<PageState>({
    id: "page",
    sourceFile: new File(["pdf"], "same.pdf"),
    sourcePageNumber: 1,
    rotation: 0,
    markedForDeletion: false,
    fieldGroupId: "group",
  });
  const toolbar = document.createElement("div"),
    stage = document.createElement("section");
  document.body.append(toolbar, stage);
  const reports: boolean[] = [];
  const onChange = vi.fn((_: string, fieldRef: string, value: string) =>
    setPage({ ...page(), fieldAnswers: [{ fieldRef, value }] })
  );
  const view = render(() => (
    <EditorFieldsEditor
      page={page()}
      groupPageNumbers={[1]}
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
      active
      onActivate={() => {}}
      hint={toolbar}
      onDraftChange={(open) => reports.push(open)}
      focusInput={(input) => input.focus()}
      onChange={onChange}
    />
  ));
  const open = () => reports.at(-1);
  try {
    expect(open()).toBe(false);
    const hits = await screen.findAllByRole("button", { name: "Fill field: Answer" });
    fireEvent.click(hits[0]);
    expect(open()).toBe(true);
    fireEvent.input(screen.getByRole("textbox"), { target: { value: "Draft A" } });
    fireEvent.click(screen.getByRole("button", { name: "Fill field: Other" }));
    expect(open()).toBe(true);
    fireEvent.input(screen.getByRole("textbox"), { target: { value: "Saved B" } });
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);
    await waitFor(() => expect(screen.queryByRole("textbox")).not.toBeInTheDocument());
    expect(onChange).toHaveBeenCalledOnce();
    expect(open()).toBe(false);
    // Undo of the saved answer restores the page without changing its identity.
    setPage({ ...page(), fieldAnswers: [] });
    fireEvent.click(hits[0]);
    expect(screen.getByRole("textbox")).toHaveValue("Draft A");
    view.unmount();
    expect(open()).toBe(false);
  } finally {
    view.unmount();
    await runtime.dispose();
    toolbar.remove();
    stage.remove();
  }
});
