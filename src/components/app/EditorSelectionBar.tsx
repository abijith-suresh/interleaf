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
  const selectAllLabel = () => "Select all pages";
  const selectAllText = () => "Select all";
  const selectionLabel = () => {
    const activeLabel =
      props.selectedActiveCount === props.selectedCount
        ? ""
        : ` · ${props.selectedActiveCount} exportable`;
    return `${props.selectedCount} selected${activeLabel}`;
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
    <section
      class="editor-selection-bar"
      classList={{
        "has-selection": hasSelection(),
        "all-pages-selected": props.allPagesSelected,
      }}
      aria-label="Page selection and export"
    >
      <Show when={hasSelection()}>
        <div class="editor-selection-summary">
          <strong id="editor-selection-title" data-testid="editor-selection-title">
            {selectionLabel()}
          </strong>
        </div>
      </Show>

      <Show when={hasSelection()}>
        <div class="editor-selection-actions">
          <button
            type="button"
            data-testid="editor-clear-selection-button"
            disabled={props.busy}
            onClick={props.onClearSelection}
            aria-label="Clear page selection"
            class="editor-toolbar-action editor-clear-selection-action"
          >
            Clear
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
              Rotate
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

      <Show when={!props.allPagesSelected}>
        <button
          type="button"
          data-testid="editor-select-all-button"
          disabled={props.busy}
          onClick={props.onSelectAll}
          aria-label={selectAllLabel()}
          class="editor-toolbar-action editor-select-all-action"
        >
          {selectAllText()}
        </button>
      </Show>

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
