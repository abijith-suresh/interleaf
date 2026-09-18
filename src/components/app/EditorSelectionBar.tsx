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
  const selectionLabel = () => {
    if (!hasSelection()) return "No pages selected";

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
  const selectAllLabel = () => (props.allPagesSelected ? "All selected" : "Select all");
  const selectAllAriaLabel = () =>
    props.allPagesSelected ? "All pages are already selected" : "Select all pages";
  return (
    <section class="editor-selection-bar" aria-label="Page selection and export">
      <div class="editor-selection-summary">
        <strong id="editor-selection-title" data-testid="editor-selection-title">
          {selectionLabel()}
        </strong>
      </div>

      <div class="editor-selection-actions">
        <button
          type="button"
          data-testid="editor-clear-selection-button"
          disabled={props.busy || !hasSelection()}
          onClick={props.onClearSelection}
          aria-label={hasSelection() ? "Clear page selection" : "No pages selected to clear"}
          title={hasSelection() ? "Clear page selection" : "No pages selected to clear"}
          class="editor-toolbar-action editor-selection-clear-action"
        >
          Clear
        </button>
        <button
          type="button"
          data-testid="editor-rotate-button"
          disabled={props.busy || !hasSelection()}
          onClick={props.onRotate}
          aria-label={
            hasSelection()
              ? "Rotate selected pages 90 degrees"
              : "Select at least one page to rotate"
          }
          title={
            hasSelection()
              ? "Rotate selected pages 90 degrees"
              : "Select at least one page to rotate"
          }
          class="editor-toolbar-action editor-selection-rotate-action"
        >
          Rotate
        </button>
        <button
          type="button"
          data-testid="editor-delete-button"
          disabled={props.busy || !hasSelection()}
          onClick={props.onDelete}
          aria-label={
            hasSelection() ? props.deletionAriaLabel : "Select at least one page to use deletion"
          }
          title={
            hasSelection() ? props.deletionAriaLabel : "Select at least one page to use deletion"
          }
          class="editor-toolbar-action editor-toolbar-action-danger editor-selection-delete-action"
        >
          {props.deletionLabel}
        </button>
        <button
          type="button"
          data-testid="editor-select-all-button"
          disabled={props.busy || props.allPagesSelected}
          onClick={props.onSelectAll}
          aria-label={selectAllAriaLabel()}
          title={selectAllAriaLabel()}
          class="editor-toolbar-action editor-select-all-action"
        >
          {selectAllLabel()}
        </button>
      </div>

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
