interface Props {
  busy: boolean;
  selectedCount: number;
  activePageCount: number;
  onSelectAll: () => void;
  onRotate: () => void;
  onDelete: () => void;
  onExtract: () => void;
  onDownload: () => void;
  onAddPdf: (file: File) => void;
}

export default function EditorSidebar(props: Props) {
  let addPdfInput!: HTMLInputElement;
  const hasSelection = () => props.selectedCount > 0;

  return (
    <aside class="editor-sidebar">
      <div class="editor-sidebar-scroll">
        <section class="editor-sidebar-section">
          <h2 class="editor-sidebar-label">File</h2>
          <button
            type="button"
            data-testid="editor-add-pdf-button"
            onClick={() => addPdfInput.click()}
            disabled={props.busy}
            class="editor-add-pdf"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M10 4v12M4 10h12" />
            </svg>
            <span>{props.busy ? "Working…" : "+ Add PDF"}</span>
          </button>
          <input
            ref={addPdfInput}
            data-testid="editor-add-pdf-input"
            type="file"
            accept="application/pdf"
            name="additional-pdf"
            aria-label="Choose an additional PDF"
            class="hidden"
            disabled={props.busy}
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              if (file) props.onAddPdf(file);
              e.currentTarget.value = "";
            }}
          />
        </section>

        <section class="editor-sidebar-section">
          <h2 class="editor-sidebar-label">Pages</h2>
          <button
            type="button"
            data-testid="editor-select-all-button"
            onClick={props.onSelectAll}
            aria-label="Select all pages"
            disabled={props.busy}
            class="editor-sidebar-action"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M4 5h12M4 10h12M4 15h8" />
            </svg>
            <span>Select all</span>
          </button>
        </section>

        <section class="editor-sidebar-section">
          <h2 class="editor-sidebar-label">Adjust</h2>
          <button
            type="button"
            data-testid="editor-rotate-button"
            onClick={props.onRotate}
            aria-label="Rotate selected pages 90 degrees"
            disabled={props.busy || !hasSelection()}
            class="editor-sidebar-action"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M15.5 7A6 6 0 1 0 16 11M15.5 7V3.5M15.5 7H12" />
            </svg>
            <span>Rotate</span>
          </button>
          <button
            type="button"
            data-testid="editor-delete-button"
            onClick={props.onDelete}
            aria-label="Mark selected pages for deletion"
            disabled={props.busy || !hasSelection()}
            class="editor-sidebar-action editor-sidebar-action-danger"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M4.5 6.5h11M8 6.5V4h4v2.5M6.5 8.5v6m3.5-6v6m3.5-6v6M5.5 6.5l.5 10h8l.5-10" />
            </svg>
            <span>Mark for deletion</span>
          </button>
          <button
            type="button"
            data-testid="editor-extract-button"
            onClick={props.onExtract}
            aria-label="Extract selected pages to a new PDF"
            disabled={props.busy || !hasSelection()}
            class="editor-sidebar-action"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M6 3.5h6l3 3v10H6zM12 3.5v3h3M9 10h4M11 8l2 2-2 2" />
            </svg>
            <span>Extract</span>
          </button>
        </section>
      </div>

      <section class="editor-sidebar-export">
        <h2 class="editor-sidebar-label">Export</h2>
        <button
          type="button"
          data-testid="editor-download-button"
          onClick={props.onDownload}
          disabled={props.busy || props.activePageCount === 0}
          class="editor-download-action"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M10 3v9m0 0 3-3m-3 3-3-3M4 14v3h12v-3" />
          </svg>
          <span>{props.busy ? "Working…" : "Download PDF"}</span>
        </button>
      </section>
    </aside>
  );
}
