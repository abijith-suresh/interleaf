import { createEffect, For } from "solid-js";
import type { WorkspaceFile } from "../../controllers/editor-workspace";

interface Props {
  open: boolean;
  busy: boolean;
  files: WorkspaceFile[];
  onClose: () => void;
  onSelectFile: (file: File) => void;
  onRemoveFile: (file: File) => void;
}

function formatPageCount(pageCount: number) {
  return `${pageCount} page${pageCount === 1 ? "" : "s"}`;
}

export default function EditorFilesDialog(props: Props) {
  let dialog!: HTMLDialogElement;
  let closeButton!: HTMLButtonElement;
  let list!: HTMLUListElement;

  function focusAfterRemoval(removedIndex: number): void {
    requestAnimationFrame(() => {
      const items = list?.querySelectorAll<HTMLButtonElement>('[data-testid="editor-file-item"]');
      const target = items?.[Math.min(removedIndex, (items.length ?? 1) - 1)];
      (target ?? closeButton)?.focus();
    });
  }

  function isOpen(): boolean {
    return dialog.open || dialog.hasAttribute("open");
  }

  function openDialog(): void {
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
  }

  function closeDialog(): void {
    if (typeof dialog.close === "function") {
      dialog.close();
    } else {
      dialog.removeAttribute("open");
    }
  }

  createEffect(() => {
    if (!dialog) return;

    if (props.open && !isOpen()) {
      openDialog();
      queueMicrotask(() => closeButton?.focus());
    } else if (!props.open && isOpen()) {
      closeDialog();
    }
  });

  function requestClose(): void {
    closeDialog();
    props.onClose();
  }

  return (
    <dialog
      ref={dialog}
      id="editor-files-dialog"
      data-testid="editor-files-dialog"
      class="editor-files-layer"
      aria-modal="true"
      aria-labelledby="editor-files-title"
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
    >
      <button
        type="button"
        class="editor-files-scrim"
        aria-label="Close files"
        tabIndex={-1}
        onClick={requestClose}
      />
      <section class="editor-files-dialog">
        <header class="editor-files-dialog-header">
          <div>
            <h2 id="editor-files-title">Files</h2>
          </div>
          <button
            type="button"
            data-testid="editor-files-close-button"
            class="editor-files-close"
            aria-label="Close files"
            onClick={requestClose}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="m5 5 10 10M15 5 5 15" />
            </svg>
          </button>
        </header>

        <div class="editor-files-dialog-body">
          <ul ref={list} class="editor-file-list" aria-label="Workspace files">
            <For each={props.files}>
              {(workspaceFile, index) => {
                return (
                  <li class="editor-file-row">
                    <button
                      type="button"
                      data-testid="editor-file-item"
                      class="editor-file-item"
                      aria-label={`Select all ${formatPageCount(workspaceFile.pageCount)} from ${workspaceFile.file.name}`}
                      onClick={() => props.onSelectFile(workspaceFile.file)}
                      disabled={props.busy}
                    >
                      <span class="editor-file-icon" aria-hidden="true">
                        <svg viewBox="0 0 20 20" aria-hidden="true">
                          <path d="M5 2.5h6l4 4v11H5zM11 2.5v4h4" />
                        </svg>
                      </span>
                      <span class="editor-file-copy">
                        <strong>{workspaceFile.file.name}</strong>
                        <span>{formatPageCount(workspaceFile.pageCount)}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      data-testid="editor-file-remove"
                      class="editor-file-remove"
                      aria-label={`Remove ${workspaceFile.file.name} and its ${formatPageCount(workspaceFile.pageCount)} from the workspace`}
                      title={`Remove ${workspaceFile.file.name}`}
                      disabled={props.busy}
                      onClick={() => {
                        focusAfterRemoval(index());
                        props.onRemoveFile(workspaceFile.file);
                      }}
                    >
                      <svg viewBox="0 0 20 20" aria-hidden="true">
                        <path d="M4.5 6.5h11M8 6.5V4h4v2.5M6.5 8.5v6m3.5-6v6m3.5-6v6M5.5 6.5l.5 10h8l.5-10" />
                      </svg>
                    </button>{" "}
                  </li>
                );
              }}
            </For>
          </ul>
        </div>
      </section>
    </dialog>
  );
}
