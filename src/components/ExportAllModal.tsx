import { Show, createEffect } from "solid-js";

import type { NoteExportFormat } from "@/utils/exportNote";
import { trapFocus } from "@/utils/focusTrap";

type ExportAllModalProps = {
  open: boolean;
  onClose: () => void;
  onExport: (format: NoteExportFormat) => void;
};

export default function ExportAllModal(props: ExportAllModalProps) {
  let cancelButtonRef: HTMLButtonElement | undefined;
  let dialogRef: HTMLDivElement | undefined;

  createEffect(() => {
    if (!props.open) {
      return;
    }

    queueMicrotask(() => {
      cancelButtonRef?.focus();
    });
  });

  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 z-50 flex items-center justify-center px-4"
        role="presentation"
      >
        <div
          ref={dialogRef}
          class="animate-modal-in w-full max-w-[360px] rounded-lg border border-border bg-surface p-5 shadow-lg"
          role="dialog"
          aria-modal="true"
          aria-labelledby="export-all-modal-title"
          aria-describedby="export-all-modal-description"
          onKeyDown={(event) => {
            trapFocus(dialogRef, event);

            if (event.key === "Escape") {
              event.preventDefault();
              props.onClose();
            }
          }}
        >
          <h2
            id="export-all-modal-title"
            class="text-base font-medium text-text-primary"
          >
            Export all notes
          </h2>
          <p
            id="export-all-modal-description"
            class="mt-2 text-sm text-text-secondary"
          >
            Download all notes as a zip archive. Choose a format:
          </p>

          <div class="mt-5 flex flex-col gap-2">
            <button
              type="button"
              class="rounded-md border border-border px-3 py-2 text-left text-sm text-text-primary transition-colors duration-150 hover:bg-surface-hover active:scale-95 active:transition-transform active:duration-75"
              onClick={() => props.onExport("txt")}
            >
              <span class="font-medium">Plain text</span>
              <span class="ml-1 text-text-tertiary">(.txt.zip)</span>
            </button>
            <button
              type="button"
              class="rounded-md border border-border px-3 py-2 text-left text-sm text-text-primary transition-colors duration-150 hover:bg-surface-hover active:scale-95 active:transition-transform active:duration-75"
              onClick={() => props.onExport("md")}
            >
              <span class="font-medium">Markdown</span>
              <span class="ml-1 text-text-tertiary">(.md.zip)</span>
            </button>
          </div>

          <div class="mt-4 flex justify-end">
            <button
              ref={cancelButtonRef}
              type="button"
              class="rounded-md border border-border px-3 py-2 text-sm text-text-secondary transition-colors duration-150 hover:bg-surface-hover hover:text-text-primary"
              onClick={() => props.onClose()}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
