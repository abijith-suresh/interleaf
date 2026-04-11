import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  Show,
} from "solid-js";

import type { NoteRecord } from "@/types/note";
import { renderMarkdown } from "@/utils/markdown";

type EditorProps = {
  note: NoteRecord | undefined;
  focusToken: number;
  onSave: (noteId: string, body: string) => Promise<void>;
};

export default function Editor(props: EditorProps) {
  let textareaRef: HTMLTextAreaElement | undefined;

  const [draft, setDraft] = createSignal("");
  const renderedMarkdown = createMemo(() => renderMarkdown(draft()));

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

    pendingSave = {
      noteId: note.id,
      body,
    };

    if (saveTimer) {
      window.clearTimeout(saveTimer);
    }

    saveTimer = window.setTimeout(() => {
      void flushPendingSave();
    }, 500);
  });

  createEffect(
    on(
      () => [props.focusToken, props.note?.id],
      ([, noteId]) => {
        if (!noteId) {
          return;
        }

        queueMicrotask(() => {
          textareaRef?.focus();
        });
      },
    ),
  );

  onCleanup(() => {
    void flushPendingSave();
  });

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
          <div class="flex-1 overflow-y-auto px-6 py-6">
            <div class="mx-auto flex w-full max-w-[720px] flex-col gap-4">
              <textarea
                ref={textareaRef}
                value={draft()}
                aria-label="Note editor"
                spellcheck={false}
                placeholder="Start writing..."
                class="min-h-[320px] w-full resize-none rounded-md border border-border bg-bg px-4 py-3 text-base text-text-primary outline-none focus:border-accent"
                onInput={(event) => setDraft(event.currentTarget.value)}
              />

              <Show when={draft().trim().length > 0}>
                <section class="rounded-md border border-border bg-surface px-4 py-3">
                  <div class="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-text-tertiary">
                    Preview
                  </div>
                  {/* renderMarkdown escapes content and sanitizes output before preview injection */}
                  <div
                    class="prose prose-sm max-w-none text-text-primary"
                    innerHTML={renderedMarkdown()}
                  />
                </section>
              </Show>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}
