import { Show } from "solid-js";

interface Props {
  busy: boolean;
  busyLabel: string;
  selectedCount: number;
  selectedActiveCount: number;
  allPagesSelected: boolean;
  deletionLabel: string;
  deletionAriaLabel: string;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onRotate: () => void;
  onDelete: () => void;
  onDownload: () => void;
}

export default function EditorSelectionBar(props: Props) {
  const hasSelection = () => props.selectedCount > 0;
  const hasBatchSelection = () => props.selectedCount > 1;
  const selectAllLabel = () => (props.allPagesSelected ? "Deselect all pages" : "Select all pages");
  const selectionLabel = () => {
    if (!hasSelection()) return "No pages selected";
    const activeLabel =
      props.selectedActiveCount === props.selectedCount
        ? ""
        : ` · ${props.selectedActiveCount} exportable`;
    return `${props.selectedCount} page${props.selectedCount === 1 ? "" : "s"} selected${activeLabel}`;
  };
  const exportLabel = () => {
    if (props.selectedActiveCount === 0) {
      return hasSelection() ? "Restore pages first" : "No active pages to export";
    }
    if (!hasSelection()) return "Export PDF";
    return `Export ${props.selectedActiveCount} selected page${
      props.selectedActiveCount === 1 ? "" : "s"
    }`;
  };
  return (
    <section class="editor-selection-bar" aria-labelledby="editor-selection-title">
      <div class="editor-selection-summary">
        <p class="editor-selection-eyebrow">Selection</p>
        <strong id="editor-selection-title" data-testid="editor-selection-title">
          {selectionLabel()}
        </strong>
      </div>

      <Show when={hasSelection()}>
        <div class="editor-selection-actions">
          <button
            type="button"
            data-testid="editor-clear-selection-button"
            disabled={props.busy}
            onClick={props.onClearSelection}
            class="editor-toolbar-action editor-clear-selection-action"
          >
            Clear selection
          </button>
          <Show when={hasBatchSelection()}>
            <button
              type="button"
              data-testid="editor-rotate-button"
              disabled={props.busy}
              onClick={props.onRotate}
              aria-label="Rotate selected pages 90 degrees"
              class="editor-toolbar-action"
            >
              Rotate selected
            </button>
            <button
              type="button"
              data-testid="editor-delete-button"
              disabled={props.busy}
              onClick={props.onDelete}
              aria-label={props.deletionAriaLabel}
              class="editor-toolbar-action editor-toolbar-action-danger"
            >
              {props.deletionLabel}
            </button>
          </Show>
        </div>
      </Show>

      <button
        type="button"
        data-testid="editor-select-all-button"
        disabled={props.busy}
        onClick={props.onSelectAll}
        aria-label={selectAllLabel()}
        class="editor-toolbar-action editor-select-all-action"
      >
        {selectAllLabel()}
      </button>

      <button
        type="button"
        data-testid="editor-download-button"
        disabled={props.busy || props.selectedActiveCount === 0}
        onClick={props.onDownload}
        aria-label={props.busy ? props.busyLabel : exportLabel()}
        class="editor-download-action"
      >
        {props.busy ? props.busyLabel : exportLabel()}
      </button>
    </section>
  );
}
