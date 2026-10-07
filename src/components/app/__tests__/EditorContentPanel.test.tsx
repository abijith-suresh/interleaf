import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import type { PDFRuntime } from "../../../services/pdf-runtime";
import type { PDFPageContent } from "../../../services/pdfium/protocol";
import type { PageState } from "../../../types/interfaces";
import EditorContentPanel from "../EditorContentPanel";

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
  const result = render(() => (
    <EditorContentPanel
      page={page}
      runtime={{ runPromise } as unknown as PDFRuntime}
      overlayRoot={root}
      onChange={changed}
      onBusy={busy}
      onDraft={draft}
    />
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
  await screen.findByRole("button", { name: "Place text" });
  fireEvent.click(screen.getByRole("button", { name: "Place text" }));
  return screen.findByLabelText("Text");
}

describe("Direct page editing", () => {
  it("keeps idle controls compact, previews a draft, and applies only its source page", async () => {
    const { changed, busy, unmount } = setup();
    expect(screen.queryByLabelText("Text")).not.toBeInTheDocument();
    const input = await placeText();
    expect(screen.getByText(/Helvetica fallback/)).toBeInTheDocument();
    fireEvent.input(input, { target: { value: "Added" } });
    expect(document.querySelector(".editor-content-preview")).toHaveTextContent("Added");
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(changed).toHaveBeenCalledWith(page.sourceFile, 1));
    expect(busy.mock.calls).toEqual([[true], [false]]);
    expect(screen.getByRole("status")).toHaveTextContent("Applied to this page");
    unmount();
  });
  it("selects original text on the document and offers an accessible list", async () => {
    const { unmount } = setup();
    await screen.findByRole("button", { name: "Place text" });
    fireEvent.click(screen.getByRole("button", { name: "Edit text" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose from list" }));
    expect(screen.getByRole("button", { name: "Slanted" })).toBeDisabled();
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
  it("fills a flat form with positioned text instead of an empty field panel", async () => {
    const { unmount } = setup();
    await screen.findByRole("button", { name: "Place text" });
    fireEvent.click(screen.getByRole("button", { name: "Fill forms" }));
    expect(screen.getByText(/No interactive fields. Tap the page/)).toBeInTheDocument();
    await placeText();
    expect(screen.getByLabelText("Text")).toBeEnabled();
    unmount();
  });
  it("ignores scroll and pinch gestures, and preserves text when repositioned", async () => {
    const { unmount } = setup();
    await screen.findByRole("button", { name: "Place text" });
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
    await screen.findByRole("button", { name: "Place text" });
    fireEvent.click(screen.getByRole("button", { name: "Fill forms" }));
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
    await screen.findByRole("button", { name: "Place text" });
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
    await screen.findByRole("button", { name: "Place text" });
    fireEvent.click(screen.getByRole("button", { name: "Fill forms" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose from list" }));
    fireEvent.click(screen.getByRole("button", { name: "Choice · B" }));
    expect(screen.getByRole("radio")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Save field" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save & next" }));
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(changed).not.toHaveBeenCalled();
    expect(runPromise).toHaveBeenCalledTimes(1);
    unmount();
  });
});
