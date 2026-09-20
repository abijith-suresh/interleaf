import { createSignal, onCleanup, onMount, Show } from "solid-js";

interface Props {
  busy: boolean;
  busyLabel: string;
  selectedCount: number;
  selectedActiveCount: number;
  allPagesSelected: boolean;
  deletionLabel: string;
  deletionAriaLabel: string;
  compressionAvailable: boolean;
  compressionDisabledReason: string;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onRotate: () => void;
  onDelete: () => void;
  onDownload: () => void;
  onExportImages: () => void;
  onCompress: () => void;
}

type OpenMenu = "edit" | "download" | null;

export default function EditorSelectionBar(props: Props) {
  let bar!: HTMLElement;
  let editMenu!: HTMLDivElement;
  let downloadMenu!: HTMLDivElement;
  let editMenuTrigger!: HTMLButtonElement;
  let downloadMenuTrigger!: HTMLButtonElement;
  const [openMenu, setOpenMenu] = createSignal<OpenMenu>(null);

  const hasSelection = () => props.selectedCount > 0;
  const selectionLabel = () => {
    if (!hasSelection()) return "No pages selected";

    const activeLabel =
      props.selectedActiveCount === props.selectedCount
        ? ""
        : ` · ${props.selectedActiveCount} exportable`;
    return `${props.selectedCount} selected${activeLabel}`;
  };
  const downloadAriaLabel = () => {
    if (props.busy) return props.busyLabel;
    if (props.selectedActiveCount === 0) {
      return hasSelection()
        ? "Restore pages before downloading a PDF"
        : "No active pages to download as a PDF";
    }
    return hasSelection()
      ? `Download a PDF with ${props.selectedActiveCount} selected active page${
          props.selectedActiveCount === 1 ? "" : "s"
        }`
      : "Download a PDF with all active pages";
  };
  const imageExportDisabled = () => props.busy || props.selectedActiveCount === 0;
  const imageExportAriaLabel = () => {
    if (props.busy) return props.busyLabel;
    if (props.selectedActiveCount === 0) {
      return hasSelection()
        ? "Restore pages before exporting images"
        : "No active pages to export as images";
    }
    return "Export pages as PNG images in a ZIP archive";
  };
  const imageExportReason = () => {
    if (props.busy || props.selectedActiveCount > 0) return "";
    return hasSelection() ? "Restore pages first" : "No active pages";
  };
  const selectAllLabel = () => (props.allPagesSelected ? "All pages selected" : "Select all pages");
  const clearSelectionLabel = () =>
    hasSelection() ? "Clear page selection" : "No pages selected to clear";
  const rotateLabel = () =>
    hasSelection() ? "Rotate selected pages 90 degrees" : "Select pages to rotate";
  const deletionMenuLabel = () =>
    hasSelection() ? props.deletionAriaLabel : "Select pages to mark or restore";
  const compressionDisabled = () =>
    props.busy || props.selectedActiveCount === 0 || !props.compressionAvailable;
  const compressionLabel = () =>
    props.busy || props.compressionAvailable
      ? props.busy
        ? props.busyLabel
        : "Compress the original PDF"
      : props.compressionDisabledReason;
  const compressionReason = () =>
    compressionDisabled() && !props.busy ? props.compressionDisabledReason : "";

  const menuElement = (menu: Exclude<OpenMenu, null>) =>
    menu === "edit" ? editMenu : downloadMenu;
  const menuTrigger = (menu: Exclude<OpenMenu, null>) =>
    menu === "edit" ? editMenuTrigger : downloadMenuTrigger;
  const menuItems = (menu: Exclude<OpenMenu, null>) => {
    const element = menuElement(menu);
    return element
      ? Array.from(element.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      : [];
  };

  const focusMenuItem = (menu: Exclude<OpenMenu, null>, index = 0) => {
    queueMicrotask(() => {
      const items = menuItems(menu);
      const targetIndex = index < 0 ? items.length + index : index;
      items[targetIndex]?.focus();
    });
  };

  const closeMenu = (restoreFocus = false) => {
    const menu = openMenu();
    setOpenMenu(null);
    if (restoreFocus && menu) queueMicrotask(() => menuTrigger(menu)?.focus());
  };

  const toggleMenu = (menu: Exclude<OpenMenu, null>) => {
    if (props.busy) return;
    if (openMenu() === menu) {
      closeMenu(true);
      return;
    }
    setOpenMenu(menu);
    focusMenuItem(menu);
  };

  const runMenuAction = (action: () => void, disabled = false) => {
    if (disabled) return;
    closeMenu(true);
    action();
  };

  const handleTriggerKeyDown = (menu: Exclude<OpenMenu, null>, event: KeyboardEvent) => {
    if (props.busy) return;
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (openMenu() !== menu) {
      setOpenMenu(menu);
      focusMenuItem(menu, event.key === "ArrowUp" ? -1 : 0);
      return;
    }
    const items = menuItems(menu);
    focusMenuItem(menu, event.key === "ArrowUp" ? items.length - 1 : 0);
  };

  const handleMenuKeyDown = (menu: Exclude<OpenMenu, null>, event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
      return;
    }

    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (event.key === "Tab") {
      event.preventDefault();
      const trigger = menuTrigger(menu);
      const focusables = Array.from(
        bar.querySelectorAll<HTMLElement>(
          'button:not([disabled]):not([aria-disabled="true"]), a[href], [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => !element.closest('[role="menu"]'));
      const triggerIndex = focusables.indexOf(trigger);
      const nextTarget = event.shiftKey ? trigger : (focusables[triggerIndex + 1] ?? trigger);
      closeMenu();
      queueMicrotask(() => nextTarget?.focus());
      return;
    }
    if (!keys.includes(event.key)) return;

    event.preventDefault();
    const items = menuItems(menu);
    if (items.length === 0) return;

    const currentIndex = items.indexOf(event.target as HTMLButtonElement);
    let nextIndex = currentIndex < 0 ? 0 : currentIndex;
    if (event.key === "ArrowDown") nextIndex = (nextIndex + 1) % items.length;
    if (event.key === "ArrowUp") nextIndex = (nextIndex - 1 + items.length) % items.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = items.length - 1;
    items[nextIndex]?.focus();
  };

  onMount(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !bar.contains(target)) setOpenMenu(null);
    };
    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && openMenu()) {
        event.preventDefault();
        closeMenu(true);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleDocumentKeyDown);
    onCleanup(() => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleDocumentKeyDown);
    });
  });

  return (
    <section ref={bar} class="editor-selection-bar" aria-label="Page selection and export">
      <div class="editor-selection-summary">
        <strong id="editor-selection-title" data-testid="editor-selection-title">
          {selectionLabel()}
        </strong>
      </div>

      <div class="editor-menu-group editor-edit-menu-group">
        <button
          ref={editMenuTrigger}
          type="button"
          data-testid="editor-edit-menu-button"
          class="editor-toolbar-action editor-menu-trigger"
          aria-haspopup="menu"
          aria-controls="editor-edit-menu"
          aria-expanded={openMenu() === "edit"}
          aria-disabled={props.busy}
          title={props.busy ? props.busyLabel : "Open page editing options"}
          onClick={() => toggleMenu("edit")}
          onKeyDown={(event) => handleTriggerKeyDown("edit", event)}
        >
          Edit pages
          <svg class="editor-menu-trigger-chevron" viewBox="0 0 20 20" aria-hidden="true">
            <path d="m5 7 5 5 5-5" />
          </svg>
        </button>

        <Show when={openMenu() === "edit"}>
          <div
            ref={editMenu}
            id="editor-edit-menu"
            data-testid="editor-edit-menu"
            class="editor-menu-panel"
            role="menu"
            aria-label="Page editing options"
            onKeyDown={(event) => handleMenuKeyDown("edit", event)}
          >
            <button
              type="button"
              role="menuitem"
              tabindex="-1"
              data-testid="editor-select-all-button"
              aria-disabled={props.busy || props.allPagesSelected}
              aria-label={selectAllLabel()}
              title={selectAllLabel()}
              class="editor-menu-item"
              onClick={() => runMenuAction(props.onSelectAll, props.busy || props.allPagesSelected)}
            >
              <span class="editor-menu-item-copy">
                <span>Select all pages</span>
                <Show when={props.allPagesSelected}>
                  <span class="editor-menu-item-hint">All pages already selected</span>
                </Show>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              tabindex="-1"
              data-testid="editor-clear-selection-button"
              aria-disabled={props.busy || !hasSelection()}
              aria-label={clearSelectionLabel()}
              title={clearSelectionLabel()}
              class="editor-menu-item"
              onClick={() => runMenuAction(props.onClearSelection, props.busy || !hasSelection())}
            >
              <span class="editor-menu-item-copy">
                <span>Clear selection</span>
                <Show when={!hasSelection()}>
                  <span class="editor-menu-item-hint">No pages selected</span>
                </Show>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              tabindex="-1"
              data-testid="editor-rotate-button"
              aria-disabled={props.busy || !hasSelection()}
              aria-label={rotateLabel()}
              title={rotateLabel()}
              class="editor-menu-item"
              onClick={() => runMenuAction(props.onRotate, props.busy || !hasSelection())}
            >
              <span class="editor-menu-item-copy">
                <span>Rotate selected pages</span>
                <Show when={!hasSelection()}>
                  <span class="editor-menu-item-hint">Select pages to rotate</span>
                </Show>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              tabindex="-1"
              data-testid="editor-delete-button"
              aria-disabled={props.busy || !hasSelection()}
              aria-label={deletionMenuLabel()}
              title={deletionMenuLabel()}
              class="editor-menu-item editor-menu-item-danger"
              onClick={() => runMenuAction(props.onDelete, props.busy || !hasSelection())}
            >
              <span class="editor-menu-item-copy">
                <span>{props.deletionLabel}</span>
                <Show when={!hasSelection()}>
                  <span class="editor-menu-item-hint">Select pages to mark or restore</span>
                </Show>
              </span>
            </button>
          </div>
        </Show>
      </div>

      <div class="editor-download-group">
        <button
          type="button"
          data-testid="editor-download-button"
          disabled={props.selectedActiveCount === 0}
          aria-disabled={props.busy || props.selectedActiveCount === 0}
          onClick={() => {
            if (props.busy) return;
            closeMenu();
            props.onDownload();
          }}
          aria-label={downloadAriaLabel()}
          class="editor-download-action"
        >
          Download PDF
        </button>
        <button
          ref={downloadMenuTrigger}
          type="button"
          data-testid="editor-download-options-button"
          class="editor-download-options-trigger"
          aria-label="More download options"
          aria-haspopup="menu"
          aria-controls="editor-download-options-menu"
          aria-expanded={openMenu() === "download"}
          aria-disabled={props.busy}
          title={props.busy ? props.busyLabel : "More download options"}
          onClick={() => toggleMenu("download")}
          onKeyDown={(event) => handleTriggerKeyDown("download", event)}
        >
          <svg class="editor-menu-trigger-chevron" viewBox="0 0 20 20" aria-hidden="true">
            <path d="m5 7 5 5 5-5" />
          </svg>
        </button>

        <Show when={openMenu() === "download"}>
          <div
            ref={downloadMenu}
            id="editor-download-options-menu"
            data-testid="editor-download-options-menu"
            class="editor-menu-panel editor-download-menu-panel"
            role="menu"
            aria-label="Download options"
            onKeyDown={(event) => handleMenuKeyDown("download", event)}
          >
            <button
              type="button"
              role="menuitem"
              tabindex="-1"
              data-testid="editor-export-images-button"
              aria-disabled={imageExportDisabled()}
              onClick={() => runMenuAction(props.onExportImages, imageExportDisabled())}
              aria-label={imageExportAriaLabel()}
              title={imageExportAriaLabel()}
              class="editor-menu-item"
            >
              <span class="editor-menu-item-copy">
                <span>Export PNG images</span>
                <Show when={imageExportReason()}>
                  <span class="editor-menu-item-hint">{imageExportReason()}</span>
                </Show>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              tabindex="-1"
              data-testid="editor-compress-button"
              aria-disabled={compressionDisabled()}
              onClick={() => runMenuAction(props.onCompress, compressionDisabled())}
              aria-label={compressionLabel()}
              title={compressionLabel()}
              class="editor-menu-item"
            >
              <span class="editor-menu-item-copy">
                <span>Compress original PDF</span>
                <Show when={compressionReason()}>
                  <span class="editor-menu-item-hint">{compressionReason()}</span>
                </Show>
              </span>
            </button>
          </div>
        </Show>
      </div>
    </section>
  );
}
