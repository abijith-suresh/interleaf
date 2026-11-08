import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import EditorSelectionBar from "../EditorSelectionBar";

function makeProps(overrides: Partial<Parameters<typeof EditorSelectionBar>[0]> = {}) {
  return {
    busy: false,
    busyLabel: "Working…",
    selectedCount: 2,
    selectedActiveCount: 2,
    allPagesSelected: false,
    deletionLabel: "Mark for deletion",
    deletionAriaLabel: "Mark selected pages for deletion",
    onClearSelection: vi.fn(),
    onSelectAll: vi.fn(),
    onRotateLeft: vi.fn(),
    onRotateRight: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    onExtract: vi.fn(),
    onExportImages: vi.fn(),
    ...overrides,
  };
}

describe("EditorSelectionBar", () => {
  it("is a toolbar that names the selection and runs each action", () => {
    const props = makeProps();
    render(() => <EditorSelectionBar {...props} />);
    const bar = screen.getByRole("toolbar", { name: "Selected pages" });
    expect(bar).toHaveTextContent("2 selected");

    for (const [name, handler] of [
      ["Rotate selected pages left 90 degrees", props.onRotateLeft],
      ["Rotate selected pages right 90 degrees", props.onRotateRight],
      ["Select all pages", props.onSelectAll],
      ["Duplicate selected pages", props.onDuplicate],
      ["Mark selected pages for deletion", props.onDelete],
      ["Extract 2 selected pages to a new PDF", props.onExtract],
      ["Export selected pages as PNG images in a ZIP archive", props.onExportImages],
      ["Clear page selection", props.onClearSelection],
    ] as const) {
      fireEvent.click(screen.getByRole("button", { name }));
      expect(handler).toHaveBeenCalledTimes(1);
    }
  });

  it("explains outputs that need exportable pages and ignores clicks on them", () => {
    const props = makeProps({
      selectedActiveCount: 0,
      deletionLabel: "Restore",
      deletionAriaLabel: "Restore selected pages",
    });
    render(() => <EditorSelectionBar {...props} />);
    expect(screen.getByTestId("editor-selection-title")).toHaveTextContent(
      "2 selected · 0 exportable"
    );
    const extract = screen.getByRole("button", { name: "Restore marked pages to extract them" });
    const images = screen.getByRole("button", { name: "Restore marked pages to export images" });
    for (const button of [extract, images]) {
      expect(button).toHaveAttribute("aria-disabled", "true");
      fireEvent.click(button);
    }
    expect(props.onExtract).not.toHaveBeenCalled();
    expect(props.onExportImages).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Restore selected pages" }));
    expect(props.onDelete).toHaveBeenCalledTimes(1);
  });

  it("names the busy operation and ignores actions while busy", () => {
    const props = makeProps({ busy: true, busyLabel: "Exporting PDF… 1/2" });
    render(() => <EditorSelectionBar {...props} />);
    const buttons = screen.getAllByRole("button", { name: "Exporting PDF… 1/2" });
    expect(buttons.length).toBeGreaterThan(5);
    for (const button of buttons) fireEvent.click(button);
    fireEvent.click(screen.getByRole("button", { name: "Clear page selection" }));
    for (const handler of [
      props.onRotateLeft,
      props.onRotateRight,
      props.onDuplicate,
      props.onDelete,
      props.onExtract,
      props.onExportImages,
      props.onClearSelection,
    ])
      expect(handler).not.toHaveBeenCalled();
  });

  it("is one Tab stop and moves with arrow, Home, and End keys", () => {
    const rects = vi
      .spyOn(HTMLElement.prototype, "getClientRects")
      .mockReturnValue([new DOMRect(0, 0, 44, 44)] as unknown as DOMRectList);
    onTestFinished(() => rects.mockRestore());
    render(() => <EditorSelectionBar {...makeProps()} />);
    const bar = screen.getByRole("toolbar", { name: "Selected pages" });
    const items = Array.from(bar.querySelectorAll<HTMLButtonElement>("button"));
    expect(items.filter((item) => item.tabIndex === 0)).toEqual([items[0]]);

    items[0].focus();
    fireEvent.keyDown(items[0], { key: "ArrowRight" });
    expect(items[1]).toHaveFocus();
    expect(items[1].tabIndex).toBe(0);
    expect(items[0].tabIndex).toBe(-1);
    fireEvent.keyDown(items[1], { key: "End" });
    expect(screen.getByRole("button", { name: "Clear page selection" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowRight" });
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(items[0], { key: "ArrowLeft" });
    expect(screen.getByRole("button", { name: "Clear page selection" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Home" });
    expect(items[0]).toHaveFocus();
  });
});
