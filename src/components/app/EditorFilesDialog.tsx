import { createEffect, For } from "solid-js";
import type { WorkspaceFile } from "../../controllers/editor-workspace";
import EditorButton from "./ui/EditorButton";
import EditorIcon from "./ui/EditorIcon";

interface Props {
  open: boolean;
  busy: boolean;
  files: WorkspaceFile[];
  onClose: () => void;
  onSelectFile: (file: File) => void;
  onRemoveFile: (file: File) => void | Promise<void>;
}

function formatPageCount(pageCount: number) {
  return `${pageCount} page${pageCount === 1 ? "" : "s"}`;
}

export default function EditorFilesDialog(props: Props) {
  let dialog!: HTMLDialogElement;
  let closeButton!: HTMLButtonElement;
  let list!: HTMLUListElement;

  function focusAfterRemoval(removedIndex: number, removedControl: HTMLElement): void {
    requestAnimationFrame(() => {
      if (!props.open) return;
      if (document.activeElement !== document.body && document.activeElement !== removedControl)
        return;
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
      aria-modal={props.open ? "true" : undefined}
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
          <EditorButton
            ref={closeButton}
            data-testid="editor-files-close-button"
            class="editor-files-close"
            aria-label="Close files"
            onClick={requestClose}
            icon="close"
          />
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
                        <EditorIcon name="document" />
                      </span>
                      <span class="editor-file-copy">
                        <strong>{workspaceFile.file.name}</strong>
                        <span>{formatPageCount(workspaceFile.pageCount)}</span>
                      </span>
                    </button>
                    <EditorButton
                      data-testid="editor-file-remove"
                      class="editor-file-remove"
                      aria-label={`Remove ${workspaceFile.file.name} and its ${formatPageCount(workspaceFile.pageCount)} from the workspace`}
                      title={`Remove ${workspaceFile.file.name}`}
                      disabled={props.busy}
                      onClick={(event) => {
                        const removedControl = event.currentTarget;
                        const removedIndex = index();
                        void Promise.resolve(props.onRemoveFile(workspaceFile.file)).then(() =>
                          focusAfterRemoval(removedIndex, removedControl)
                        );
                      }}
                      variant="danger"
                      icon="delete"
                    />
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
