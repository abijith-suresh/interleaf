import { For } from "solid-js";

export interface EditorWorkspaceFile {
  file: File;
  pageCount: number;
  selectedCount: number;
}

interface Props {
  busy: boolean;
  files: EditorWorkspaceFile[];
  activeFile: File | null;
  onAddPdf: (file: File) => void;
  onSelectFile: (file: File) => void;
}

function formatPageCount(pageCount: number) {
  return `${pageCount} page${pageCount === 1 ? "" : "s"}`;
}

export default function EditorSidebar(props: Props) {
  let addPdfInput!: HTMLInputElement;
  const totalPageCount = () => props.files.reduce((total, file) => total + file.pageCount, 0);

  return (
    <aside class="editor-sidebar" aria-labelledby="editor-files-title">
      <div class="editor-sidebar-scroll">
        <section class="editor-sidebar-section">
          <div class="editor-sidebar-heading">
            <div>
              <p class="editor-sidebar-kicker">Working set</p>
              <h2 id="editor-files-title">Files</h2>
            </div>
            <button
              type="button"
              data-testid="editor-add-pdf-button"
              aria-label="Add another PDF"
              onClick={() => addPdfInput.click()}
              disabled={props.busy}
              class="editor-add-pdf editor-add-pdf-icon"
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M10 4v12M4 10h12" />
              </svg>
            </button>
          </div>
          <p class="editor-sidebar-summary">
            {props.files.length} file{props.files.length === 1 ? "" : "s"} · {totalPageCount()}{" "}
            pages
          </p>
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

          <ul class="editor-file-list">
            <For each={props.files}>
              {(workspaceFile) => {
                const isActive = () => props.activeFile === workspaceFile.file;

                return (
                  <li>
                    <button
                      type="button"
                      data-testid="editor-file-item"
                      class="editor-file-item"
                      classList={{ "is-active": isActive() }}
                      aria-pressed={isActive()}
                      aria-label={
                        "Select " +
                        workspaceFile.file.name +
                        ", " +
                        formatPageCount(workspaceFile.pageCount)
                      }
                      onClick={() => props.onSelectFile(workspaceFile.file)}
                      disabled={props.busy}
                    >
                      <span class="editor-file-icon" aria-hidden="true">
                        PDF
                      </span>
                      <span class="editor-file-copy">
                        <strong>{workspaceFile.file.name}</strong>
                        <span>{formatPageCount(workspaceFile.pageCount)}</span>
                      </span>
                      <span class="editor-file-count" aria-hidden="true">
                        {workspaceFile.selectedCount > 0 ? workspaceFile.selectedCount : ""}
                      </span>
                    </button>
                  </li>
                );
              }}
            </For>
          </ul>
        </section>
      </div>

      <div class="editor-sidebar-footer">
        <p>Everything stays on your device.</p>
        <span class="editor-local-status">
          <i aria-hidden="true" /> Local only
        </span>
      </div>
    </aside>
  );
}
