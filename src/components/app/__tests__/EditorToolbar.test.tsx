import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import EditorToolbar from "../EditorToolbar";

function makeProps(overrides: Partial<Parameters<typeof EditorToolbar>[0]> = {}) {
  return {
    base: "/",
    view: "pages" as const,
    pageCount: 3,
    pageCountLabel: "3 pages",
    exportableCount: 3,
    filesLabel: "View 1 file",
    filesOpen: false,
    busy: false,
    busyLabel: "Working…",
    historyUnavailable: false,
    compressionAvailable: true,
    compressionDisabledReason: "Compress only before page edits",
    filesButtonRef: vi.fn(),
    moreButtonRef: vi.fn(),
    downloadButtonRef: vi.fn(),
    onViewChange: vi.fn(),
    onAddFiles: vi.fn(),
    onOpenFiles: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onDownload: vi.fn(),
    onExportImages: vi.fn(),
    onCompress: vi.fn(),
    ...overrides,
  };
}

function visibleLayout() {
  const rects = vi
    .spyOn(HTMLElement.prototype, "getClientRects")
    .mockReturnValue([new DOMRect(0, 0, 44, 44)] as unknown as DOMRectList);
  onTestFinished(() => rects.mockRestore());
}

describe("EditorToolbar", () => {
  it("holds the views, source and history actions, one page count, and the Download menu", () => {
    const props = makeProps({ view: "document", undoLabel: "page rotation" });
    render(() => <EditorToolbar {...props} />);
    const toolbar = screen.getByRole("toolbar", { name: "Editor" });
    expect(screen.getByRole("button", { name: "Document" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "Pages" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Pages" })).toHaveTextContent("Pages");
    expect(screen.getByRole("button", { name: "Document" })).toHaveTextContent("Document");
    expect(toolbar).toHaveTextContent("3 pages");
    expect(screen.getAllByText("3 pages")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Pages" }));
    fireEvent.click(screen.getByRole("button", { name: "Add PDFs or images" }));
    fireEvent.click(screen.getByRole("button", { name: "View 1 file" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo page rotation" }));
    expect(props.onViewChange).toHaveBeenCalledWith("pages");
    expect(props.onAddFiles).toHaveBeenCalledOnce();
    expect(props.onOpenFiles).toHaveBeenCalledOnce();
    expect(props.onUndo).toHaveBeenCalledOnce();
  });

  it("downloads, exports, or compresses the whole document from the Download menu", () => {
    const props = makeProps();
    render(() => <EditorToolbar {...props} />);
    for (const [name, handler] of [
      ["Download a PDF with all exportable pages", props.onDownload],
      ["Export all exportable pages as PNG images in a ZIP archive", props.onExportImages],
      ["Compress the original PDF", props.onCompress],
    ] as const) {
      fireEvent.click(screen.getByRole("button", { name: "Download options" }));
      expect(screen.getByRole("menu", { name: "Download options" })).toHaveTextContent("3 pages");
      fireEvent.click(screen.getByRole("menuitem", { name }));
      expect(handler).toHaveBeenCalledOnce();
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    }
  });

  it("explains unavailable outputs and ignores clicks on them", async () => {
    const reason = "Restore marked pages to compress the original PDF";
    const props = makeProps({
      exportableCount: 0,
      compressionAvailable: false,
      compressionDisabledReason: reason,
    });
    render(() => <EditorToolbar {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Download options" }));
    const download = screen.getByRole("menuitem", { name: "No exportable pages to download" });
    const images = screen.getByRole("menuitem", {
      name: "No exportable pages to export as images",
    });
    const compression = screen.getByRole("menuitem", { name: reason });
    for (const item of [download, images, compression]) {
      expect(item).toHaveAttribute("aria-disabled", "true");
      fireEvent.click(item);
    }
    expect(compression).toHaveTextContent(reason);
    await waitFor(() => expect(download).toHaveFocus());
    expect(props.onDownload).not.toHaveBeenCalled();
    expect(props.onExportImages).not.toHaveBeenCalled();
    expect(props.onCompress).not.toHaveBeenCalled();
  });

  it("supports arrow, Home, End, Escape, and Tab keys in the Download menu", async () => {
    visibleLayout();
    render(() => (
      <>
        <EditorToolbar {...makeProps()} />
        <button type="button">After the toolbar</button>
      </>
    ));
    const trigger = screen.getByRole("button", { name: "Download options" });

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const download = screen.getByRole("menuitem", {
      name: "Download a PDF with all exportable pages",
    });
    const images = screen.getByRole("menuitem", {
      name: "Export all exportable pages as PNG images in a ZIP archive",
    });
    const compress = screen.getByRole("menuitem", { name: "Compress the original PDF" });
    await waitFor(() => expect(download).toHaveFocus());
    fireEvent.keyDown(download, { key: "ArrowDown" });
    expect(images).toHaveFocus();
    fireEvent.keyDown(images, { key: "End" });
    expect(compress).toHaveFocus();
    fireEvent.keyDown(compress, { key: "ArrowDown" });
    expect(download).toHaveFocus();
    fireEvent.keyDown(download, { key: "Home" });
    expect(download).toHaveFocus();
    fireEvent.keyDown(download, { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: "Compress the original PDF" })).toHaveFocus()
    );
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Tab", shiftKey: true });
    await waitFor(() => expect(trigger).toHaveFocus());

    fireEvent.click(trigger);
    await waitFor(() =>
      expect(
        screen.getByRole("menuitem", { name: "Download a PDF with all exportable pages" })
      ).toHaveFocus()
    );
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Tab" });
    // Tab leaves the toolbar: its other controls are not Tab stops.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "After the toolbar" })).toHaveFocus()
    );
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("is one Tab stop and moves between controls with arrow keys", () => {
    visibleLayout();
    render(() => <EditorToolbar {...makeProps({ undoLabel: "page rotation" })} />);
    const exit = screen.getAllByRole("link", { name: "Exit editor" })[0];
    const pages = screen.getByRole("button", { name: "Pages" });
    expect(exit.tabIndex).toBe(0);
    expect(pages.tabIndex).toBe(-1);
    exit.focus();
    fireEvent.keyDown(exit, { key: "ArrowRight" });
    expect(pages).toHaveFocus();
    expect(pages.tabIndex).toBe(0);
    expect(exit.tabIndex).toBe(-1);
    fireEvent.keyDown(pages, { key: "End" });
    expect(screen.getByRole("button", { name: "Download options" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowLeft" });
    expect(screen.getByRole("button", { name: "Nothing to redo" })).toHaveFocus();
  });

  it("collects lower-priority actions under More on narrow screens", () => {
    render(() => <EditorToolbar {...makeProps()} />);
    const more = screen.getByRole("button", { name: "More actions" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", { name: "Add PDFs or images" }).closest("#editor-more-actions")
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "View 1 file" }).closest("#editor-more-actions")
    ).not.toBeNull();
    fireEvent.keyDown(more, { key: "Escape" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);
    fireEvent.pointerDown(document.body);
    expect(more).toHaveAttribute("aria-expanded", "false");
  });
});
