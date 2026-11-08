import { Show } from "solid-js";
import EditorButton from "./ui/EditorButton";
import EditorOverflow from "./ui/EditorOverflow";
import { createRovingToolbar } from "./ui/roving-toolbar";

interface Props {
  busy: boolean;
  busyLabel: string;
  selectedCount: number;
  selectedActiveCount: number;
  allPagesSelected: boolean;
  deletionLabel: string;
  deletionAriaLabel: string;
  onClearSelection: () => void;
  onSelectAll: () => void;
  onRotateLeft: () => void;
  onRotateRight: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onExtract: () => void;
  onExportImages: () => void;
}

/** Actions for the selected pages. It is shown only while pages are selected. */
export default function EditorSelectionBar(props: Props) {
  let bar!: HTMLDivElement;
  createRovingToolbar(() => bar);

  const plural = () => (props.selectedCount === 1 ? "" : "s");
  const noExportable = () => props.selectedActiveCount === 0;
  const unavailable = (label: string) => (props.busy ? props.busyLabel : label);
  const extractLabel = () =>
    unavailable(
      noExportable()
        ? "Restore marked pages to extract them"
        : `Extract ${props.selectedActiveCount} selected page${
            props.selectedActiveCount === 1 ? "" : "s"
          } to a new PDF`
    );
  const imagesLabel = () =>
    unavailable(
      noExportable()
        ? "Restore marked pages to export images"
        : "Export selected pages as PNG images in a ZIP archive"
    );

  return (
    <div
      ref={bar}
      role="toolbar"
      aria-label="Selected pages"
      data-testid="editor-selection-bar"
      class="editor-selection-bar"
    >
      <strong class="editor-selection-title" data-testid="editor-selection-title">
        {props.selectedCount} selected
        <Show when={props.selectedActiveCount !== props.selectedCount}>
          <span class="editor-selection-exportable">
            <span class="editor-selection-separator"> · </span>
            {props.selectedActiveCount} exportable
          </span>
        </Show>
      </strong>
      <div class="editor-selection-actions">
        <EditorButton
          data-testid="editor-rotate-left-button"
          variant="plain"
          icon="rotate-left"
          aria-label={unavailable(`Rotate selected page${plural()} left 90 degrees`)}
          title="Rotate left"
          aria-disabled={props.busy}
          onClick={() => !props.busy && props.onRotateLeft()}
        />
        <EditorButton
          data-testid="editor-rotate-button"
          variant="plain"
          icon="rotate"
          aria-label={unavailable(`Rotate selected page${plural()} right 90 degrees`)}
          title="Rotate right"
          aria-disabled={props.busy}
          onClick={() => !props.busy && props.onRotateRight()}
        />
        <EditorOverflow
          id="editor-selection-more"
          label="More selection actions"
          triggerTestId="editor-selection-more-button"
          class="editor-selection-more"
        >
          <EditorButton
            data-testid="editor-select-all-button"
            class="editor-selection-action"
            variant="plain"
            aria-label={unavailable(
              props.allPagesSelected ? "All pages selected" : "Select all pages"
            )}
            title={props.allPagesSelected ? "All pages selected" : "Select all pages"}
            aria-disabled={props.busy || props.allPagesSelected}
            onClick={() => !props.busy && !props.allPagesSelected && props.onSelectAll()}
          >
            <span class="editor-selection-label">Select all</span>
          </EditorButton>
          <EditorButton
            data-testid="editor-duplicate-selected-button"
            class="editor-selection-action"
            variant="plain"
            icon="copy"
            aria-label={unavailable(`Duplicate selected page${plural()}`)}
            title="Duplicate"
            aria-disabled={props.busy}
            onClick={() => !props.busy && props.onDuplicate()}
          >
            <span class="editor-selection-label">Duplicate</span>
          </EditorButton>
          <EditorButton
            data-testid="editor-delete-button"
            class="editor-selection-action"
            variant="danger"
            icon={props.deletionLabel === "Restore" ? "restore" : "delete"}
            aria-label={unavailable(props.deletionAriaLabel)}
            title={props.deletionLabel}
            aria-disabled={props.busy}
            onClick={() => !props.busy && props.onDelete()}
          >
            <span class="editor-selection-label">{props.deletionLabel}</span>
          </EditorButton>
          <EditorButton
            data-testid="editor-extract-button"
            class="editor-selection-action"
            variant="plain"
            icon="extract"
            aria-label={extractLabel()}
            title={extractLabel()}
            aria-disabled={props.busy || noExportable()}
            onClick={() => !props.busy && !noExportable() && props.onExtract()}
          >
            <span class="editor-selection-label">Extract to PDF</span>
          </EditorButton>
          <EditorButton
            data-testid="editor-export-selected-images-button"
            class="editor-selection-action"
            variant="plain"
            icon="image"
            aria-label={imagesLabel()}
            title={imagesLabel()}
            aria-disabled={props.busy || noExportable()}
            onClick={() => !props.busy && !noExportable() && props.onExportImages()}
          >
            <span class="editor-selection-label">Export PNG</span>
          </EditorButton>
        </EditorOverflow>
      </div>
      <EditorButton
        data-testid="editor-clear-selection-button"
        class="editor-selection-clear"
        variant="plain"
        icon="close"
        aria-label="Clear page selection"
        aria-keyshortcuts="Escape"
        title="Clear selection (Esc)"
        aria-disabled={props.busy}
        onClick={() => !props.busy && props.onClearSelection()}
      />
    </div>
  );
}
