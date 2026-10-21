import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { Effect } from "effect";
import { createSignal } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { makePDFRuntime } from "../../../services/pdf-runtime";
import type { PageState } from "../../../types/interfaces";

const validate = vi.hoisted(() => vi.fn());
vi.mock("../../../services/pdf-text", () => ({ validateAddedText: validate }));
vi.mock("../../../services/pdf-service", () => ({
  PDFService: class {
    getPageGeometry = () =>
      Effect.succeed({
        bounds: [0, 0, 400, 600],
        userUnit: 1,
        width: 400,
        height: 600,
        transform: [1, 0, 0, -1, 0, 600],
      });
    getPageRotation = () => Effect.succeed(0);
    reset = () => Effect.void;
    dispose = () => Effect.void;
  },
}));

import EditorAdditionsEditor from "../EditorAdditionsEditor";

afterEach(() => vi.restoreAllMocks());

it.each(["failure", "success", "busy", "navigation", "disposal"])(
  "pending validation preserves later external focus after %s",
  async (outcome) => {
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
      new DOMRect(0, 0, 400, 600),
    ] as unknown as DOMRectList);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 400, 600)
    );
    const pending = Promise.withResolvers<void>();
    validate.mockReset().mockReturnValue(pending.promise);
    const runtime = makePDFRuntime();
    const page: PageState = {
      id: "page",
      sourceFile: new File(["pdf"], "source.pdf"),
      sourcePageNumber: 1,
      rotation: 0,
      markedForDeletion: false,
      addedText: [{ id: "saved", text: "Saved", x: 100, y: 100, fontSize: 16, rotation: 0 }],
    };
    const [current, setCurrent] = createSignal(page);
    const [busy, setBusy] = createSignal(false);
    const toolbar = document.createElement("div");
    const header = document.createElement("div");
    const stage = document.createElement("section");
    const external = document.createElement("button");
    document.body.append(toolbar, header, stage, external);
    const onChange = vi.fn();
    const view = render(() => (
      <EditorAdditionsEditor
        page={current()}
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
    try {
      fireEvent.click(screen.getByRole("button", { name: "Select additions" }));
      const hit = await screen.findByRole("button", { name: "Edit added text: Saved" });
      hit.focus();
      fireEvent.click(hit);
      const input = screen.getByLabelText("Added text", { exact: true });
      await waitFor(() => expect(input).toHaveFocus());
      fireEvent.submit(input.closest("form")!);
      await waitFor(() => expect(validate).toHaveBeenCalledOnce());
      external.focus();
      if (outcome === "busy") setBusy(true);
      if (outcome === "navigation") setCurrent({ ...page, id: "other-page" });
      if (outcome === "disposal") view.unmount();
      if (outcome === "failure") pending.reject(new Error("Invalid text"));
      else pending.resolve();
      await pending.promise.catch(() => undefined);
      await waitFor(() => {
        if (outcome === "failure")
          expect(screen.getByRole("alert")).toHaveTextContent("Invalid text");
        else if (outcome === "success") expect(onChange).toHaveBeenCalledOnce();
        else if (outcome === "busy") {
          expect(screen.getByRole("alert")).toHaveTextContent("Save your text when it finishes");
          expect(onChange).not.toHaveBeenCalled();
        }
        expect(external).toHaveFocus();
      });
      if (outcome === "navigation" || outcome === "disposal")
        expect(onChange).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      await runtime.dispose();
      for (const element of [toolbar, header, stage, external]) element.remove();
    }
  }
);

it.each(["text", "checkmark"] as const)("busy Save cannot commit a new %s draft", async (kind) => {
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
    new DOMRect(0, 0, 400, 600),
  ] as unknown as DOMRectList);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 400, 600)
  );
  validate.mockReset().mockResolvedValue(undefined);
  const runtime = makePDFRuntime();
  const [busy, setBusy] = createSignal(false);
  const toolbar = document.createElement("div"),
    header = document.createElement("div"),
    stage = document.createElement("section");
  document.body.append(toolbar, header, stage);
  let gesture: import("../EditorAdditionsEditor").AdditionsGesture | null = null;
  const onChange = vi.fn(),
    onCheckmarksChange = vi.fn();
  const view = render(() => (
    <EditorAdditionsEditor
      page={{
        id: "page",
        sourceFile: new File(["pdf"], "source.pdf"),
        sourcePageNumber: 1,
        rotation: 0,
        markedForDeletion: false,
      }}
      runtime={runtime}
      toolbar={toolbar}
      header={header}
      stage={stage}
      ready
      disabled={busy()}
      onChange={onChange}
      onCheckmarksChange={onCheckmarksChange}
      onEditing={() => {}}
      registerTap={() => {}}
      registerGesture={(value) => {
        gesture = value;
      }}
    />
  ));
  try {
    fireEvent.click(
      screen.getByRole("button", { name: kind === "text" ? "Add text" : "Checkmark" })
    );
    await waitFor(() =>
      expect(document.querySelector(".editor-text-layer")).toHaveAttribute(
        "data-geometry-ready",
        "true"
      )
    );
    stage.addEventListener("keydown", (event) => gesture?.key(event));
    fireEvent.keyDown(stage, { key: "Enter" });
    if (kind === "text")
      fireEvent.input(screen.getByLabelText("Added text", { exact: true }), {
        target: { value: "New text" },
      });
    const save = screen.getByRole("button", { name: `Save ${kind}` });
    const form = save.closest("form");
    if (!form) throw new Error("Missing addition settings form");
    setBusy(true);
    fireEvent.submit(form);
    await Promise.resolve();
    expect(onChange).not.toHaveBeenCalled();
    expect(onCheckmarksChange).not.toHaveBeenCalled();
    expect(validate).not.toHaveBeenCalled();
    setBusy(false);
    expect(onChange).not.toHaveBeenCalled();
    expect(onCheckmarksChange).not.toHaveBeenCalled();
    fireEvent.submit(form);
    const committed = kind === "text" ? onChange : onCheckmarksChange;
    await waitFor(() => expect(committed).toHaveBeenCalledTimes(1));
    expect(committed.mock.calls[0][1]).toHaveLength(1);
    expect(committed.mock.calls[0][2]).toBe(`Add ${kind}`);
  } finally {
    view.unmount();
    await runtime.dispose();
    for (const element of [toolbar, header, stage]) element.remove();
  }
});
