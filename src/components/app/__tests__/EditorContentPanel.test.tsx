import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import type { PDFRuntime } from "../../../services/pdf-runtime";
import type { PDFPageContent } from "../../../services/pdfium/protocol";
import type { PageState } from "../../../types/interfaces";
import EditorContentPanel from "../EditorContentPanel";
import EditorToolRail, { type EditorWorkspaceTool } from "../EditorToolRail";

const page: PageState = {
  id: "page",
  sourceFile: new File(["pdf"], "doc.pdf"),
  sourcePageNumber: 1,
  rotation: 0,
  markedForDeletion: false,
};
const content: PDFPageContent = {
  width: 300,
  height: 400,
  fields: [],
  text: [
    {
      index: 0,
      text: "Original phrase",
      fontSize: 12,
      editable: true,
      bounds: { x: 20, y: 30, width: 80, height: 12 },
    },
    {
      index: 1,
      text: "Slanted",
      fontSize: 12,
      editable: false,
      reason: "Slanted text cannot be replaced.",
    },
  ],
};
function setup(data = content) {
  const runPromise = vi.fn().mockResolvedValue(data),
    changed = vi.fn(),
    busy = vi.fn(),
    draft = vi.fn();
  const root = document.createElement("div");
  document.body.append(root);
  root.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 300,
    bottom: 400,
    width: 300,
    height: 400,
    toJSON: () => ({}),
  });
  const [mode, setMode] = createSignal<Exclude<EditorWorkspaceTool, "pages">>("add");
  const [locked, setLocked] = createSignal(false);
  const result = render(() => (
    <>
      <EditorToolRail
        activeTool={mode()}
        busy={locked()}
        onChooseTool={(tool) => {
          if (tool !== "pages") setMode(tool);
        }}
      />
      <EditorContentPanel
        mode={mode()}
        page={page}
        runtime={{ runPromise } as unknown as PDFRuntime}
        overlayRoot={root}
        onChange={changed}
        onBusy={busy}
        onDraft={(value) => {
          draft(value);
          setLocked(value);
        }}
      />
    </>
  ));
  return {
    runPromise,
    changed,
    busy,
    draft,
    root,
    unmount: () => {
      result.unmount();
      root.remove();
    },
  };
}
async function placeText() {
  const surface = await screen.findByRole("button", { name: "Place text on page" });
  await waitFor(() => expect(surface).toBeEnabled());
  fireEvent.keyDown(surface, { key: "Enter" });
  return screen.findByLabelText("Text");
}

describe("Direct page editing", () => {
  it("inserts at the pointer position and exposes no legacy placement controls", async () => {
    const { unmount } = setup();
    const surface = await screen.findByRole("button", { name: "Place text on page" });
    await waitFor(() => expect(surface).toBeEnabled());
    expect(screen.queryByRole("button", { name: "Place text" })).not.toBeInTheDocument();
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Choose from list" })).not.toBeInTheDocument();
    fireEvent.click(surface);
    expect(screen.queryByLabelText("Text")).not.toBeInTheDocument();
    for (const type of ["pointerdown", "pointerup"]) {
      surface.dispatchEvent(
        Object.assign(new Event(type, { bubbles: true }), {
          clientX: 90,
          clientY: 120,
          pointerId: 1,
          isPrimary: true,
        })
      );
    }
    const draft = screen.getByRole("button", { name: "Move draft text" });
    expect(Number.parseFloat(draft.style.left)).toBeCloseTo(30);
    expect(Number.parseFloat(draft.style.top)).toBeCloseTo(30);
    const input = screen.getByLabelText("Text");
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.input(input, { target: { value: "Cancel this" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel edit" }));
    expect(screen.queryByLabelText("Text")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fill forms" })).toBeEnabled();
    unmount();
  });
  it("rotates a text draft and nudges its placement without changing the text", async () => {
    const { unmount } = setup();
    const input = await placeText();
    fireEvent.input(input, { target: { value: "Side note" } });
    fireEvent.click(screen.getByRole("button", { name: "Rotate draft text 90 degrees" }));
    expect(screen.getByRole("button", { name: "Rotate draft text 90 degrees" })).toHaveTextContent(
      "90°"
    );
    const draft = screen.getByRole("button", { name: "Move draft text" });
    const initialLeft = Number.parseFloat(draft.style.left);
    fireEvent.keyDown(draft, { key: "ArrowRight", shiftKey: true });
    expect(Number.parseFloat(draft.style.left)).toBeGreaterThan(initialLeft);
    expect(input).toHaveValue("Side note");
    expect(document.querySelector(".editor-content-preview text")).toHaveAttribute(
      "transform",
      expect.stringContaining("rotate(90")
    );
    unmount();
  });
  it("keeps idle controls compact, previews a draft, and applies only its source page", async () => {
    const { changed, busy, unmount } = setup();
    expect(screen.queryByLabelText("Text")).not.toBeInTheDocument();
    const input = await placeText();
    expect(screen.getByText(/Helvetica/)).toBeInTheDocument();
    fireEvent.input(input, { target: { value: "Added" } });
    expect(document.querySelector(".editor-content-preview")).toHaveTextContent("Added");
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(changed).toHaveBeenCalledWith(page.sourceFile, 1));
    expect(busy.mock.calls).toEqual([[true], [false]]);
    expect(screen.getByText("Applied to this page.")).toHaveAttribute("role", "status");
    unmount();
  });
  it("selects original text through keyboard accessible page targets", async () => {
    const { unmount } = setup();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Place text on page" })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit text" }));
    expect(screen.queryByRole("button", { name: "Choose from list" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Slanted" })).not.toBeInTheDocument();
    const target = screen.getByRole("button", { name: "Edit Original phrase" });
    target.focus();
    expect(target).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Edit Original phrase" }));
    expect(screen.getByLabelText("Text")).toHaveValue("Original phrase");
    expect(screen.getByRole("button", { name: "Replace text" })).toBeDisabled();
    fireEvent.input(screen.getByLabelText("Text"), { target: { value: "New phrase" } });
    expect(screen.getByRole("button", { name: "Replace text" })).toBeEnabled();
    unmount();
  });
  it("preserves rejected text and prevents navigation away from a dirty draft", async () => {
    const { runPromise, changed, draft, unmount } = setup();
    const input = await placeText();
    runPromise.mockRejectedValueOnce(new Error("The text is too wide for this area."));
    fireEvent.input(input, { target: { value: "Overflow" } });
    expect(screen.getByRole("button", { name: "Fill forms" })).toBeDisabled();
    expect(draft).toHaveBeenLastCalledWith(true);
    fireEvent.submit(input.closest("form")!);
    await screen.findByRole("alert");
    expect(input).toHaveValue("Overflow");
    expect(changed).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByLabelText("Text")).not.toBeInTheDocument();
    expect(draft).toHaveBeenLastCalledWith(false);
    unmount();
  });
  it("fills a flat form without changing tools or creating a draft before placement", async () => {
    const { unmount, changed } = setup();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Place text on page" })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole("button", { name: "Fill forms" }));
    const cue = screen.getByText("Tap a blank to fill.");
    expect(cue.closest(".editor-content-tool-context")).toBeInTheDocument();
    expect(cue.closest('[role="status"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "Add text instead" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Text")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Place form text" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Fill blank on page" }), { key: "Enter" });
    const input = await screen.findByLabelText("Text");
    fireEvent.input(input, { target: { value: "Alice" } });
    fireEvent.click(screen.getByRole("button", { name: "Fill text" }));
    await waitFor(() => expect(changed).toHaveBeenCalledWith(page.sourceFile, 1));
    expect(screen.getByRole("region", { name: "Page content" })).toHaveAttribute(
      "data-tool",
      "forms"
    );
    expect(screen.getByRole("button", { name: "Fill blank on page" })).toBeEnabled();
    unmount();
  });
  it("starts form answers upright at a normal size after a rotated text edit", async () => {
    const { unmount } = setup();
    const input = await placeText();
    fireEvent.input(input, { target: { value: "Rotated note" } });
    fireEvent.click(screen.getByRole("button", { name: "Rotate draft text 90 degrees" }));
    fireEvent.input(screen.getByLabelText("Text size"), { target: { value: "48" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Fill forms" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Fill blank on page" }), { key: "Enter" });
    expect(screen.getByLabelText("Text size")).toHaveValue(14);
    expect(screen.getByRole("button", { name: "Rotate draft text 90 degrees" })).toHaveTextContent(
      "0°"
    );
    expect(document.querySelector(".editor-content-preview text")).toHaveAttribute(
      "transform",
      expect.stringContaining("rotate(0")
    );
    unmount();
  });
  it("creates an X draft without a text keyboard and cancellation leaves the PDF untouched", async () => {
    const { unmount, runPromise, changed, draft } = setup();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Place text on page" })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole("button", { name: "Fill forms" }));
    fireEvent.click(screen.getByRole("button", { name: "Place X mark" }));
    const surface = screen.getByRole("button", { name: "Place X mark on page" });
    const pointer = (type: string, x: number, id = 1, primary = true) =>
      surface.dispatchEvent(
        Object.assign(new Event(type, { bubbles: true }), {
          clientX: x,
          clientY: 60,
          pointerId: id,
          isPrimary: primary,
        })
      );
    pointer("pointerdown", 30);
    pointer("pointerup", 60);
    pointer("pointerdown", 30);
    pointer("pointerdown", 30, 2, false);
    pointer("pointerup", 30);
    expect(screen.queryByRole("button", { name: "Add X mark" })).not.toBeInTheDocument();
    fireEvent.keyDown(surface, { key: "Enter" });
    expect(screen.queryByLabelText("Text")).not.toBeInTheDocument();
    expect(document.querySelector(".editor-content-preview text")).toHaveTextContent("X");
    await waitFor(() => expect(screen.getByRole("button", { name: "Add X mark" })).toHaveFocus());
    expect(draft).toHaveBeenLastCalledWith(true);
    expect(changed).not.toHaveBeenCalled();
    expect(runPromise).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel edit" }));
    expect(screen.queryByRole("button", { name: "Add X mark" })).not.toBeInTheDocument();
    expect(changed).not.toHaveBeenCalled();
    expect(runPromise).toHaveBeenCalledTimes(1);
    expect(draft).toHaveBeenLastCalledWith(false);
    fireEvent.keyDown(screen.getByRole("button", { name: "Place X mark on page" }), {
      key: "Enter",
    });
    fireEvent.click(screen.getByRole("button", { name: "Add X mark" }));
    await waitFor(() => expect(changed).toHaveBeenCalledWith(page.sourceFile, 1));
    unmount();
  });
  it("does not offer native editing for read-only fields while allowing manual form answers", async () => {
    const { unmount, changed } = setup({
      ...content,
      fields: [
        {
          index: 0,
          fieldId: 0,
          flags: 0,
          name: "Locked name",
          type: 6,
          value: "Original",
          checked: false,
          exportValue: "",
          options: [],
          selectedOption: -1,
          readOnly: true,
          bounds: { x: 20, y: 30, width: 80, height: 12 },
        },
      ],
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Place text on page" })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole("button", { name: "Fill forms" }));
    expect(screen.queryByRole("button", { name: "Fill existing fields" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fill Locked name" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Place form text" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.queryByLabelText("Text")).not.toBeInTheDocument();
    expect(changed).not.toHaveBeenCalled();
    unmount();
  });
  it("ignores scroll and pinch gestures, and preserves text when repositioned", async () => {
    const { unmount } = setup();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Place text on page" })).toBeEnabled()
    );
    const surface = screen.getByRole("button", { name: "Place text on page" });
    const pointer = (type: string, x: number, id = 1, primary = true) =>
      surface.dispatchEvent(
        Object.assign(new Event(type, { bubbles: true }), {
          clientX: x,
          clientY: 60,
          pointerId: id,
          isPrimary: primary,
        })
      );
    pointer("pointerdown", 30);
    pointer("pointerup", 60);
    expect(screen.queryByLabelText("Text")).not.toBeInTheDocument();
    pointer("pointerdown", 30);
    pointer("pointerdown", 30, 2, false);
    pointer("pointerup", 30);
    expect(screen.queryByLabelText("Text")).not.toBeInTheDocument();
    pointer("pointerdown", 30);
    pointer("pointerup", 30);
    fireEvent.input(screen.getByLabelText("Text"), { target: { value: "Keep me" } });
    pointer("pointerdown", 90);
    pointer("pointerup", 90);
    expect(screen.getByLabelText("Text")).toHaveValue("Keep me");
    unmount();
  });
  it("saves a native field and advances to the next field without losing input", async () => {
    const fields = ["Name", "Address"].map((name, index) => ({
      index,
      fieldId: index,
      name,
      type: 6,
      value: "",
      checked: false,
      exportValue: "Yes",
      options: [],
      selectedOption: -1,
      flags: 0,
      readOnly: false,
      bounds: { x: 20, y: 60 + index * 30, width: 100, height: 20 },
    }));
    const { changed, unmount } = setup({ ...content, fields });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Place text on page" })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole("button", { name: "Fill forms" }));
    expect(screen.getByText("2 interactive fields")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add text instead" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Place form text" }));
    expect(screen.getByRole("button", { name: "Fill blank on page" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Fill Name" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Fill existing fields" }));
    expect(screen.queryByRole("button", { name: "Fill blank on page" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Fill Name" }));
    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "Alice" } });
    fireEvent.click(screen.getByRole("button", { name: "Save & next" }));
    await screen.findByLabelText("Address");
    expect(changed).toHaveBeenCalledWith(page.sourceFile, undefined);
    expect(screen.getByLabelText("Address")).toHaveFocus();
    unmount();
  });
  it("retains line breaks while editing a multiline native field", async () => {
    const field = {
      index: 0,
      fieldId: 0,
      name: "Address",
      type: 6,
      value: "First line\nSecond line",
      checked: false,
      exportValue: "Yes",
      options: [],
      selectedOption: -1,
      flags: 1 << 12,
      readOnly: false,
      bounds: { x: 20, y: 60, width: 100, height: 40 },
    };
    const { unmount } = setup({ ...content, fields: [field] });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Place text on page" })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole("button", { name: "Fill forms" }));
    fireEvent.click(screen.getByRole("button", { name: "Fill Address" }));
    const input = screen.getByLabelText("Address");
    expect(input.tagName).toBe("TEXTAREA");
    expect(input).toHaveValue("First line\nSecond line");
    fireEvent.input(input, { target: { value: "New line\nAnother line" } });
    expect(input).toHaveValue("New line\nAnother line");
    unmount();
  });
  it("keeps unselected radio options unchecked and skips unchanged fields", async () => {
    const fields = [
      {
        index: 2,
        fieldId: 8,
        name: "Before",
        type: 6,
        value: "",
        checked: false,
        exportValue: "Yes",
        options: [],
        selectedOption: -1,
        flags: 0,
        readOnly: false,
        bounds: { x: 20, y: 30, width: 100, height: 20 },
      },
      {
        index: 0,
        fieldId: 9,
        name: "Choice",
        type: 3,
        value: "A",
        checked: false,
        exportValue: "B",
        options: [],
        selectedOption: -1,
        flags: 0,
        readOnly: false,
        bounds: { x: 20, y: 60, width: 20, height: 20 },
      },
      {
        index: 1,
        fieldId: 10,
        name: "Name",
        type: 6,
        value: "",
        checked: false,
        exportValue: "Yes",
        options: [],
        selectedOption: -1,
        flags: 0,
        readOnly: false,
        bounds: { x: 20, y: 90, width: 100, height: 20 },
      },
    ];
    const { runPromise, changed, unmount } = setup({ ...content, fields });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Place text on page" })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole("button", { name: "Fill forms" }));
    fireEvent.click(screen.getByRole("button", { name: "Fill Before" }));
    fireEvent.click(screen.getByRole("button", { name: "Save & next" }));
    expect(screen.getByRole("radio")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Save field" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save & next" }));
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(changed).not.toHaveBeenCalled();
    expect(runPromise).toHaveBeenCalledTimes(1);
    unmount();
  });
});
