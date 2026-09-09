interface Props {
  busy: boolean;
  selectedCount: number;
  onSelectAll: () => void;
  onRotate: () => void;
  onDelete: () => void;
  onExtract: () => void;
  onDownload: () => void;
  onAddPdf: (file: File) => void;
}

export default function EditorSidebar(props: Props) {
  let addPdfInput!: HTMLInputElement;

  return (
    <aside class="w-56 border-r border-border flex-col flex-shrink-0 hidden md:flex">
      <div class="flex-1 overflow-y-auto min-h-0">
        {/* Upload */}
        <div class="p-4 border-b border-border">
          <p class="text-micro uppercase tracking-wider text-muted mb-2">Upload</p>
          <button
            type="button"
            data-testid="editor-add-pdf-button"
            onClick={() => addPdfInput.click()}
            disabled={props.busy}
            class="w-full border border-dashed border-border hover:border-primary transition-colors py-6 text-center cursor-pointer bg-transparent interactive-focus"
          >
            <span class="text-micro text-muted uppercase tracking-wider">
              {props.busy ? "Working..." : "+ Add PDF"}
            </span>
          </button>
          <input
            ref={addPdfInput}
            data-testid="editor-add-pdf-input"
            type="file"
            accept="application/pdf"
            class="hidden"
            disabled={props.busy}
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              if (file) props.onAddPdf(file);
              e.currentTarget.value = "";
            }}
          />
        </div>

        {/* Selection */}
        <div class="p-4 border-b border-border">
          <p class="text-micro uppercase tracking-wider text-muted mb-3">Selection</p>
          <button
            type="button"
            data-testid="editor-select-all-button"
            onClick={props.onSelectAll}
            aria-label="Select all pages"
            disabled={props.busy}
            class="btn-sidebar-action interactive-focus"
          >
            Select All
          </button>
        </div>

        {/* Actions */}
        <div class="p-4 border-b border-border">
          <p class="text-micro uppercase tracking-wider text-muted mb-3">Actions</p>
          <button
            type="button"
            data-testid="editor-rotate-button"
            onClick={props.onRotate}
            aria-label="Rotate selected pages 90 degrees"
            disabled={props.busy}
            class="btn-sidebar-action interactive-focus"
          >
            Rotate
          </button>
          <button
            type="button"
            data-testid="editor-delete-button"
            onClick={props.onDelete}
            aria-label="Mark selected pages for deletion"
            disabled={props.busy}
            class="w-full text-left text-xs text-accent hover:bg-toast-error-bg bg-transparent border-none cursor-pointer py-2 px-2 transition-colors interactive-focus"
          >
            Delete
          </button>
          <button
            type="button"
            data-testid="editor-extract-button"
            onClick={props.onExtract}
            aria-label="Extract selected pages to a new PDF"
            disabled={props.busy}
            class="btn-sidebar-action interactive-focus"
          >
            Extract
          </button>
        </div>
      </div>

      {/* Export — pinned to bottom */}
      <div class="p-4 border-t border-border flex-shrink-0">
        <p class="text-micro uppercase tracking-wider text-muted mb-3">Export</p>
        <button
          type="button"
          data-testid="editor-download-button"
          onClick={props.onDownload}
          disabled={props.busy}
          class="w-full btn-primary text-micro py-3 border-none cursor-pointer transition-colors interactive-focus"
        >
          {props.busy ? "Working..." : "Download"}
        </button>
      </div>
    </aside>
  );
}
