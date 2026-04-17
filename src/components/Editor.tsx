import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  Show,
} from "solid-js";

import CodeMirrorEditor from "@/components/CodeMirrorEditor";
import type { NoteRecord } from "@/types/note";

type EditorProps = {
  note: NoteRecord | undefined;
  focusToken: number;
  onSave: (noteId: string, body: string) => Promise<void>;
};

export default function Editor(props: EditorProps) {
  const [draft, setDraft] = createSignal("");

  let saveTimer: number | undefined;
  let pendingSave: { noteId: string; body: string } | null = null;

  async function flushPendingSave() {
    const nextSave = pendingSave;

    if (!nextSave) {
      return;
    }

    pendingSave = null;

    if (saveTimer) {
      window.clearTimeout(saveTimer);
      saveTimer = undefined;
    }

    await props.onSave(nextSave.noteId, nextSave.body);
  }

  // When the active note changes, flush the previous note's pending save and
  // reset the draft to the new note's body.
  createEffect(
    on(
      () => props.note?.id,
      (noteId, previousNoteId) => {
        if (previousNoteId && previousNoteId !== noteId) {
          void flushPendingSave();
        }
        setDraft(props.note?.body ?? "");
      },
    ),
  );

  // Debounced save — fires 500 ms after the last keystroke.
  createEffect(() => {
    const note = props.note;
    const body = draft();

    if (!note) {
      if (saveTimer) {
        window.clearTimeout(saveTimer);
        saveTimer = undefined;
      }
      pendingSave = null;
      return;
    }

    if (body === note.body) {
      if (saveTimer) {
        window.clearTimeout(saveTimer);
        saveTimer = undefined;
      }
      pendingSave = null;
      return;
    }

    pendingSave = { noteId: note.id, body };

    if (saveTimer) {
      window.clearTimeout(saveTimer);
    }

    saveTimer = window.setTimeout(() => {
      void flushPendingSave();
    }, 500);
  });

  onCleanup(() => {
    void flushPendingSave();
  });

  // resetToken — derived from the note id so CodeMirrorEditor knows when to
  // replace the full document (note switched) rather than treating it as a
  // regular keystroke edit.
  const resetToken = createMemo(() => props.note?.id ?? "");

  return (
    <Show
      when={props.note}
      fallback={
        <div class="mx-auto flex w-full max-w-[720px] flex-1 items-center justify-center px-8 py-12">
          <div class="text-center text-sm text-text-secondary">
            <p>No note open.</p>
            <p class="mt-2 text-xs text-text-tertiary">
              Create a note or open one from the sidebar.
            </p>
          </div>
        </div>
      }
    >
      {(_note) => (
        <div class="flex min-h-0 flex-1 flex-col">
          <CodeMirrorEditor
            value={draft()}
            resetToken={resetToken()}
            focusToken={props.focusToken}
            onChange={(value) => setDraft(value)}
          />
        </div>
      )}
    </Show>
  );
}
