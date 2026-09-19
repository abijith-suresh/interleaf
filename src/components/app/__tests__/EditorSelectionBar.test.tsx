import { fireEvent, render, waitFor } from "@solidjs/testing-library";
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
  it("keeps the compact triggers stable and exposes disabled edit items", async () => {
    const { getByTestId, queryByTestId } = render(() => <EditorSelectionBar {...makeProps()} />);

    expect(getByTestId("editor-edit-menu-button")).toBeEnabled();
    expect(getByTestId("editor-download-button")).toBeEnabled();
    expect(getByTestId("editor-download-options-button")).toBeEnabled();
    expect(queryByTestId("editor-edit-menu")).not.toBeInTheDocument();

    fireEvent.click(getByTestId("editor-edit-menu-button"));
    await waitFor(() => expect(getByTestId("editor-edit-menu")).toBeVisible());

    expect(getByTestId("editor-clear-selection-button")).toHaveAttribute("aria-disabled", "true");
    expect(getByTestId("editor-clear-selection-button")).toHaveAttribute("tabindex", "-1");
    expect(getByTestId("editor-clear-selection-button")).toHaveTextContent("No pages selected");
    expect(getByTestId("editor-rotate-button")).toHaveAttribute("aria-disabled", "true");
    expect(getByTestId("editor-delete-button")).toHaveAttribute("aria-disabled", "true");
  });

  it("supports keyboard navigation and restores focus when a menu closes", async () => {
    const { getByTestId, queryByTestId } = render(() => (
      <EditorSelectionBar {...makeProps({ selectedCount: 1, selectedActiveCount: 1 })} />
    ));
    const trigger = getByTestId("editor-edit-menu-button");

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    await waitFor(() => expect(getByTestId("editor-edit-menu")).toBeVisible());
    expect(document.activeElement).toBe(getByTestId("editor-select-all-button"));

    fireEvent.keyDown(getByTestId("editor-select-all-button"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(getByTestId("editor-clear-selection-button"));

    fireEvent.keyDown(getByTestId("editor-clear-selection-button"), { key: "End" });
    expect(document.activeElement).toBe(getByTestId("editor-delete-button"));

    fireEvent.keyDown(getByTestId("editor-delete-button"), { key: "Home" });
    expect(document.activeElement).toBe(getByTestId("editor-select-all-button"));

    fireEvent.keyDown(getByTestId("editor-select-all-button"), { key: "Tab" });
    await waitFor(() => expect(queryByTestId("editor-edit-menu")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(getByTestId("editor-download-button"));

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    await waitFor(() => expect(getByTestId("editor-edit-menu")).toBeVisible());
    fireEvent.keyDown(getByTestId("editor-select-all-button"), {
      key: "Tab",
      shiftKey: true,
    });
    await waitFor(() => expect(queryByTestId("editor-edit-menu")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(trigger);

    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    await waitFor(() => expect(getByTestId("editor-edit-menu")).toBeVisible());
    expect(document.activeElement).toBe(getByTestId("editor-delete-button"));
    fireEvent.keyDown(getByTestId("editor-delete-button"), { key: "Escape" });
    await waitFor(() => expect(queryByTestId("editor-edit-menu")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps menus mutually exclusive and closes them on an outside pointer", async () => {
    const { getByTestId, queryByTestId } = render(() => <EditorSelectionBar {...makeProps()} />);

    fireEvent.click(getByTestId("editor-edit-menu-button"));
    await waitFor(() => expect(getByTestId("editor-edit-menu")).toBeVisible());

    fireEvent.click(getByTestId("editor-download-options-button"));
    await waitFor(() => expect(getByTestId("editor-download-options-menu")).toBeVisible());
    expect(queryByTestId("editor-edit-menu")).not.toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    await waitFor(() =>
      expect(queryByTestId("editor-download-options-menu")).not.toBeInTheDocument()
    );
  });

  it("keeps output options visible with reasons when they are unavailable", async () => {
    const { getByTestId } = render(() => (
      <EditorSelectionBar
        {...makeProps({
          selectedCount: 1,
          selectedActiveCount: 0,
          compressionAvailable: false,
          compressionDisabledReason: "Restore pages before compressing the original PDF",
        })}
      />
    ));

    fireEvent.click(getByTestId("editor-download-options-button"));
    await waitFor(() => expect(getByTestId("editor-download-options-menu")).toBeVisible());

    expect(getByTestId("editor-export-images-button")).toHaveAttribute("aria-disabled", "true");
    expect(getByTestId("editor-export-images-button")).toHaveTextContent("Restore pages first");
    expect(getByTestId("editor-compress-button")).toHaveAttribute("aria-disabled", "true");
    expect(getByTestId("editor-compress-button")).toHaveTextContent(
      "Restore pages before compressing the original PDF"
    );
    expect(document.activeElement).toBe(getByTestId("editor-export-images-button"));
  });

  it("keeps the primary PDF download one click and closes an open menu", async () => {
    const props = makeProps();
    const { getByTestId, queryByTestId } = render(() => <EditorSelectionBar {...props} />);

    fireEvent.click(getByTestId("editor-edit-menu-button"));
    await waitFor(() => expect(getByTestId("editor-edit-menu")).toBeVisible());
    fireEvent.click(getByTestId("editor-download-button"));

    expect(props.onDownload).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(queryByTestId("editor-edit-menu")).not.toBeInTheDocument());

    fireEvent.click(getByTestId("editor-download-options-button"));
    await waitFor(() => expect(getByTestId("editor-download-options-menu")).toBeVisible());
    fireEvent.keyDown(getByTestId("editor-export-images-button"), {
      key: "Tab",
      shiftKey: true,
    });
    await waitFor(() =>
      expect(queryByTestId("editor-download-options-menu")).not.toBeInTheDocument()
    );
    expect(document.activeElement).toBe(getByTestId("editor-download-options-button"));

    fireEvent.click(getByTestId("editor-download-options-button"));
    await waitFor(() => expect(getByTestId("editor-download-options-menu")).toBeVisible());
    fireEvent.click(getByTestId("editor-download-button"));

    expect(props.onDownload).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(queryByTestId("editor-download-options-menu")).not.toBeInTheDocument()
    );
  });
});
