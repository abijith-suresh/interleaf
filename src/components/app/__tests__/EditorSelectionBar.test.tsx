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
    compressionDisabledReason: "Compression is available before page edits",
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
  it("disables selection actions and ignores clicks until pages are selected", () => {
    const props = makeProps();
    render(() => <EditorSelectionBar {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit pages" }));

    for (const name of [
      "No pages selected to clear",
      "Select pages to rotate",
      "Select pages to mark or restore",
    ]) {
      const item = screen.getByRole("menuitem", { name });
      expect(item).toHaveAttribute("aria-disabled", "true");
      fireEvent.click(item);
    }
    expect(props.onClearSelection).not.toHaveBeenCalled();
    expect(props.onRotate).not.toHaveBeenCalled();
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole("menu", { name: "Page editing options" })).toBeVisible();
  });

  it("supports arrow, Home, End, and Escape keys in the edit menu", async () => {
    render(() => (
      <EditorSelectionBar {...makeProps({ selectedCount: 1, selectedActiveCount: 1 })} />
    ));
    const trigger = screen.getByRole("button", { name: "Edit pages" });

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const selectAll = screen.getByRole("menuitem", { name: "Select all pages" });
    const clear = screen.getByRole("menuitem", { name: "Clear page selection" });
    const remove = screen.getByRole("menuitem", { name: "Mark selected pages for deletion" });
    await waitFor(() => expect(selectAll).toHaveFocus());

    fireEvent.keyDown(selectAll, { key: "ArrowDown" });
    expect(clear).toHaveFocus();
    fireEvent.keyDown(clear, { key: "End" });
    expect(remove).toHaveFocus();
    fireEvent.keyDown(remove, { key: "Home" });
    expect(selectAll).toHaveFocus();
    fireEvent.keyDown(selectAll, { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    await waitFor(() =>
      expect(
        screen.getByRole("menuitem", { name: "Mark selected pages for deletion" })
      ).toHaveFocus()
    );
  });

  it.each([false, true])("closes the edit menu with Tab, shiftKey=%s", async (shiftKey) => {
    render(() => <EditorSelectionBar {...makeProps()} />);
    const trigger = screen.getByRole("button", { name: "Edit pages" });
    fireEvent.click(trigger);
    const selectAll = screen.getByRole("menuitem", { name: "Select all pages" });
    await waitFor(() => expect(selectAll).toHaveFocus());

    fireEvent.keyDown(selectAll, { key: "Tab", shiftKey });

    const target = shiftKey
      ? trigger
      : screen.getByRole("button", { name: "Download a PDF with all active pages" });
    await waitFor(() => expect(target).toHaveFocus());
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("keeps menus mutually exclusive and closes them on an outside pointer", () => {
    render(() => <EditorSelectionBar {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit pages" }));
    expect(screen.getByRole("menu", { name: "Page editing options" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "More download options" }));
    expect(screen.getByRole("menu", { name: "Download options" })).toBeVisible();
    expect(screen.queryByRole("menu", { name: "Page editing options" })).not.toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("explains unavailable output options and ignores clicks on them", async () => {
    const reason = "Restore pages before compressing the original PDF";
    const props = makeProps({
      selectedCount: 1,
      selectedActiveCount: 0,
      compressionAvailable: false,
      compressionDisabledReason: reason,
    });
    render(() => <EditorSelectionBar {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "More download options" }));
    const images = screen.getByRole("menuitem", { name: "Restore pages before exporting images" });
    const compression = screen.getByRole("menuitem", { name: reason });

    expect(images).toHaveAttribute("aria-disabled", "true");
    expect(images).toHaveTextContent("Restore pages first");
    expect(compression).toHaveAttribute("aria-disabled", "true");
    expect(compression).toHaveTextContent(reason);
    await waitFor(() => expect(images).toHaveFocus());
    fireEvent.click(images);
    fireEvent.click(compression);
    expect(props.onExportImages).not.toHaveBeenCalled();
    expect(props.onCompress).not.toHaveBeenCalled();
  });

  it.each(["Edit pages", "More download options"])(
    "downloads a PDF and closes the menu opened by %s",
    (trigger) => {
      const props = makeProps();
      render(() => <EditorSelectionBar {...props} />);
      fireEvent.click(screen.getByRole("button", { name: trigger }));
      fireEvent.click(screen.getByRole("button", { name: "Download a PDF with all active pages" }));

      expect(props.onDownload).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    }
  );
});
