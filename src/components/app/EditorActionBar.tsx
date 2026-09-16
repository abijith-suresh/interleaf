import { Show } from "solid-js";

interface Props {
  busy: boolean;
  selectedCount: number;
  activePageCount: number;
  allPagesSelected: boolean;
  deletionLabel: string;
  deletionAriaLabel: string;
  canMoveEarlier: boolean;
  canMoveLater: boolean;
  onSelectAll: () => void;
  onRotate: () => void;
  onDelete: () => void;
  onExtract: () => void;
  onMoveEarlier: () => void;
  onMoveLater: () => void;
  onDownload: () => void;
}

export default function EditorActionBar(props: Props) {
  const hasSelection = () => props.selectedCount > 0;
  const selectAllLabel = () => (props.allPagesSelected ? "Deselect all" : "Select all");
  const selectionLabel = () => {
    if (props.selectedCount === 0) return "No pages selected";
    return `${props.selectedCount} page${props.selectedCount === 1 ? "" : "s"} selected`;
  };

  return (
    <section class="editor-action-bar" role="toolbar" aria-labelledby="editor-actions-title">
      <div class="editor-action-summary">
        <p class="editor-action-eyebrow">Selection</p>
        <strong id="editor-actions-title">{selectionLabel()}</strong>
      </div>

      <button
        type="button"
        data-testid="editor-select-all-button"
        disabled={props.busy}
        onClick={props.onSelectAll}
        aria-label={`${selectAllLabel()} pages`}
        class="editor-toolbar-action editor-select-all-action"
      >
        {selectAllLabel()}
      </button>

      <details class="editor-action-menu">
        <summary class="editor-action-menu-trigger">
          <span>Actions</span>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="m5 7.5 5 5 5-5" />
          </svg>
        </summary>
        <div class="editor-action-menu-panel">
          <Show when={props.selectedCount === 1}>
            <button
              type="button"
              data-testid="editor-move-earlier-button"
              disabled={props.busy || !props.canMoveEarlier}
              onClick={props.onMoveEarlier}
              aria-label="Move selected page earlier"
              class="editor-toolbar-action"
            >
              Move earlier
            </button>
            <button
              type="button"
              data-testid="editor-move-later-button"
              disabled={props.busy || !props.canMoveLater}
              onClick={props.onMoveLater}
              aria-label="Move selected page later"
              class="editor-toolbar-action"
            >
              Move later
            </button>
          </Show>
          <button
            type="button"
            data-testid="editor-rotate-button"
            disabled={props.busy || !hasSelection()}
            onClick={props.onRotate}
            aria-label="Rotate selected pages 90 degrees"
            class="editor-toolbar-action"
          >
            Rotate
          </button>
          <button
            type="button"
            data-testid="editor-delete-button"
            disabled={props.busy || !hasSelection()}
            onClick={props.onDelete}
            aria-label={props.deletionAriaLabel}
            class="editor-toolbar-action editor-toolbar-action-danger"
          >
            {props.deletionLabel}
          </button>
          <button
            type="button"
            data-testid="editor-extract-button"
            disabled={props.busy || !hasSelection()}
            onClick={props.onExtract}
            aria-label="Extract selected pages to a new PDF"
            class="editor-toolbar-action"
          >
            Extract
          </button>
        </div>
      </details>

      <button
        type="button"
        data-testid="editor-download-button"
        disabled={props.busy || props.activePageCount === 0}
        onClick={props.onDownload}
        class="editor-download-action"
      >
        {props.busy ? "Working…" : "Export PDF"}
      </button>
    </section>
  );
}
