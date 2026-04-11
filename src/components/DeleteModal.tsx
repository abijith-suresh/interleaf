import { Show } from "solid-js";

type DeleteModalProps = {
  open: boolean;
  noteTitle: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function DeleteModal(props: DeleteModalProps) {
  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-30 flex items-center justify-center px-4">
        <div class="w-full max-w-[360px] rounded-lg border border-border bg-surface p-5 shadow-lg">
          <h2 class="text-base font-medium text-text-primary">Delete note?</h2>
          <p class="mt-2 text-sm text-text-secondary">
            This removes <span class="text-text-primary">{props.noteTitle}</span> from local storage.
          </p>

          <div class="mt-5 flex justify-end gap-2">
            <button
              type="button"
              class="rounded-md border border-border px-3 py-2 text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary"
              onClick={() => props.onCancel()}
            >
              Cancel
            </button>
            <button
              type="button"
              class="rounded-md bg-danger px-3 py-2 text-sm text-white hover:bg-danger-hover"
              onClick={() => props.onConfirm()}
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
