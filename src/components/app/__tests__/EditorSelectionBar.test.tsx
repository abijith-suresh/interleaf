import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import EditorSelectionBar from "../EditorSelectionBar";

function makeProps(overrides: Partial<Parameters<typeof EditorSelectionBar>[0]> = {}) {
  return {
    busy: false,
    busyLabel: "Working…",
    selectedCount: 0,
    selectedActiveCount: 3,
    allPagesSelected: false,
    deletionLabel: "Mark for deletion",
    deletionAriaLabel: "Mark selected pages for deletion",
    compressionAvailable: true,
    compressionDisabledReason: "Compress only before page edits",
    onSelectAll: vi.fn(),
    onClearSelection: vi.fn(),
    onRotate: vi.fn(),
    onDelete: vi.fn(),
    onDownload: vi.fn(),
    onExportImages: vi.fn(),
    onCompress: vi.fn(),
    ...overrides,
  };
}

describe("EditorSelectionBar", () => {
  it("rotates or restores a selection without opening a menu", () => {
    const props = makeProps({
      selectedCount: 2,
      selectedActiveCount: 0,
      deletionLabel: "Restore",
      deletionAriaLabel: "Restore selected pages",
    });
    render(() => <EditorSelectionBar {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Rotate selection 90 degrees" }));
    fireEvent.click(screen.getByRole("button", { name: "Restore selected pages" }));
    expect(props.onRotate).toHaveBeenCalledTimes(1);
    expect(props.onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
  it("disables immediate selection actions during an operation", () => {
    const props = makeProps({ busy: true, selectedCount: 1 });
    render(() => <EditorSelectionBar {...props} />);
    const rotate = screen.getByRole("button", { name: "Rotate selection 90 degrees" });
    const mark = screen.getByRole("button", { name: "Mark selected pages for deletion" });
    expect(rotate).toBeDisabled();
    expect(mark).toBeDisabled();
    fireEvent.click(rotate);
    fireEvent.click(mark);
    expect(props.onRotate).not.toHaveBeenCalled();
    expect(props.onDelete).not.toHaveBeenCalled();
  });
  it("disables selection actions and ignores clicks until pages are selected", () => {
    const props = makeProps();
    render(() => <EditorSelectionBar {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Select pages" }));

    const clear = screen.getByRole("menuitem", { name: "No pages selected to clear" });
    expect(clear).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(clear);
    expect(
      screen.queryByRole("button", { name: "Rotate selection 90 degrees" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Mark selected pages for deletion" })
    ).not.toBeInTheDocument();
    expect(props.onClearSelection).not.toHaveBeenCalled();
    expect(props.onRotate).not.toHaveBeenCalled();
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole("menu", { name: "Page selection options" })).toBeVisible();
  });

  it("supports arrow, Home, End, and Escape keys in the selection menu", async () => {
    render(() => (
      <EditorSelectionBar {...makeProps({ selectedCount: 1, selectedActiveCount: 1 })} />
    ));
    const trigger = screen.getByRole("button", { name: "Select pages" });

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const selectAll = screen.getByRole("menuitem", { name: "Select all pages" });
    const clear = screen.getByRole("menuitem", { name: "Clear page selection" });
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
    expect(screen.queryByRole("menuitem", { name: /Rotate|Mark|Restore/ })).not.toBeInTheDocument();
    await waitFor(() => expect(selectAll).toHaveFocus());

    fireEvent.keyDown(selectAll, { key: "ArrowDown" });
    expect(clear).toHaveFocus();
    fireEvent.keyDown(clear, { key: "End" });
    expect(clear).toHaveFocus();
    fireEvent.keyDown(clear, { key: "Home" });
    expect(selectAll).toHaveFocus();
    fireEvent.keyDown(selectAll, { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: "Clear page selection" })).toHaveFocus()
    );
  });

  it.each([false, true])("closes the selection menu with Tab, shiftKey=%s", async (shiftKey) => {
    render(() => <EditorSelectionBar {...makeProps()} />);
    const trigger = screen.getByRole("button", { name: "Select pages" });
    fireEvent.click(trigger);
    const selectAll = screen.getByRole("menuitem", { name: "Select all pages" });
    await waitFor(() => expect(selectAll).toHaveFocus());

    fireEvent.keyDown(selectAll, { key: "Tab", shiftKey });

    const target = shiftKey
      ? trigger
      : screen.getByRole("button", { name: "Download a PDF with all exportable pages" });
    await waitFor(() => expect(target).toHaveFocus());
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("keeps menus mutually exclusive and closes them on an outside pointer", () => {
    render(() => <EditorSelectionBar {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Select pages" }));
    expect(screen.getByRole("menu", { name: "Page selection options" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "More download options" }));
    expect(screen.getByRole("menu", { name: "Download options" })).toBeVisible();
    expect(screen.queryByRole("menu", { name: "Page selection options" })).not.toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("explains unavailable output options and ignores clicks on them", async () => {
    const reason = "Restore marked pages to compress the original PDF";
    const props = makeProps({
      selectedCount: 1,
      selectedActiveCount: 0,
      compressionAvailable: false,
      compressionDisabledReason: reason,
    });
    render(() => <EditorSelectionBar {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "More download options" }));
    const images = screen.getByRole("menuitem", { name: "Restore marked pages to export images" });
    const compression = screen.getByRole("menuitem", { name: reason });

    expect(images).toHaveAttribute("aria-disabled", "true");
    expect(images).toHaveTextContent("Restore marked pages first");
    expect(compression).toHaveAttribute("aria-disabled", "true");
    expect(compression).toHaveTextContent(reason);
    await waitFor(() => expect(images).toHaveFocus());
    fireEvent.click(images);
    fireEvent.click(compression);
    expect(props.onExportImages).not.toHaveBeenCalled();
    expect(props.onCompress).not.toHaveBeenCalled();
  });

  it.each(["Select pages", "More download options"])(
    "downloads a PDF and closes the menu opened by %s",
    (trigger) => {
      const props = makeProps();
      render(() => <EditorSelectionBar {...props} />);
      fireEvent.click(screen.getByRole("button", { name: trigger }));
      fireEvent.click(
        screen.getByRole("button", { name: "Download a PDF with all exportable pages" })
      );

      expect(props.onDownload).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    }
  );
});
