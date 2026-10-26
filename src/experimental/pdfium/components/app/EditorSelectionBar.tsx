import { createSignal, onCleanup, onMount, Show } from "solid-js";
import EditorButton from "./ui/EditorButton";
import EditorIcon from "./ui/EditorIcon";

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
        ? "Restore marked pages to download a PDF"
        : "No exportable pages to download";
    }
    return hasSelection()
      ? `Download a PDF with ${props.selectedActiveCount} exportable page${
          props.selectedActiveCount === 1 ? "" : "s"
        }`
      : "Download a PDF with all exportable pages";
  };
  const imageExportDisabled = () => props.busy || props.selectedActiveCount === 0;
  const imageExportAriaLabel = () => {
    if (props.busy) return props.busyLabel;
    if (props.selectedActiveCount === 0) {
      return hasSelection()
        ? "Restore marked pages to export images"
        : "No exportable pages to export as images";
    }
    return "Export pages as PNG images in a ZIP archive";
  };
  const imageExportReason = () => {
    if (props.busy || props.selectedActiveCount > 0) return "";
    return hasSelection() ? "Restore marked pages first" : "No exportable pages";
  };
  const selectAllLabel = () => (props.allPagesSelected ? "All pages selected" : "Select all pages");
  const clearSelectionLabel = () =>
    hasSelection() ? "Clear page selection" : "No pages selected to clear";
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
    setOpenMenu(menu);
    focusMenuItem(menu, event.key === "ArrowUp" ? -1 : 0);
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
    <section
      ref={bar}
      class="editor-selection-bar"
      classList={{ "has-selection": hasSelection() }}
      aria-label="Page selection and export"
    >
      <div class="editor-selection-summary">
        <strong id="editor-selection-title" data-testid="editor-selection-title">
          {selectionLabel()}
        </strong>
      </div>

      <Show when={hasSelection()}>
        <fieldset class="editor-selection-quick-actions" aria-label="Selected page actions">
          <EditorButton
            variant="plain"
            type="button"
            aria-label="Rotate selection 90 degrees"
            title="Rotate selected pages 90 degrees"
            disabled={props.busy}
            onClick={props.onRotate}
          >
            <EditorIcon name="rotate" />
          </EditorButton>
          <EditorButton
            variant={props.deletionLabel === "Restore" ? "secondary" : "danger"}
            type="button"
            aria-label={props.deletionAriaLabel}
            title={props.deletionAriaLabel}
            disabled={props.busy}
            onClick={props.onDelete}
          >
            <EditorIcon name={props.deletionLabel === "Restore" ? "restore" : "delete"} />
          </EditorButton>
        </fieldset>
      </Show>

      <div class="editor-menu-group editor-edit-menu-group">
        <EditorButton
          variant="plain"
          ref={editMenuTrigger}
          type="button"
          data-testid="editor-edit-menu-button"
          class="editor-toolbar-action editor-menu-trigger"
          aria-haspopup="menu"
          aria-label="Select pages"
          aria-controls="editor-edit-menu"
          aria-expanded={openMenu() === "edit"}
          aria-disabled={props.busy}
          title={props.busy ? props.busyLabel : "Select pages"}
          onClick={() => toggleMenu("edit")}
          onKeyDown={(event) => handleTriggerKeyDown("edit", event)}
        >
          <EditorIcon name="select" class="editor-menu-trigger-icon" />
          <span class="editor-menu-trigger-label">Select pages</span>
          <EditorIcon name="chevron-down" class="editor-menu-trigger-chevron" />
        </EditorButton>

        <Show when={openMenu() === "edit"}>
          <div
            ref={editMenu}
            id="editor-edit-menu"
            data-testid="editor-edit-menu"
            class="editor-menu-panel"
            role="menu"
            aria-label="Page selection options"
            onKeyDown={(event) => handleMenuKeyDown("edit", event)}
          >
            <EditorButton
              variant="plain"
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
            </EditorButton>
            <EditorButton
              variant="plain"
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
            </EditorButton>
          </div>
        </Show>
      </div>

      <div class="editor-download-group">
        <EditorButton
          variant="primary"
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
        </EditorButton>
        <EditorButton
          variant="plain"
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
          <EditorIcon name="chevron-down" class="editor-menu-trigger-chevron" />
        </EditorButton>

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
            <EditorButton
              variant="plain"
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
            </EditorButton>
            <EditorButton
              variant="plain"
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
            </EditorButton>
          </div>
        </Show>
      </div>
    </section>
  );
}
