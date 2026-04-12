import { For } from "solid-js";

import type { NoteRecord } from "@/types/note";
import { deriveTitle } from "@/utils/deriveTitle";

type TabBarProps = {
  tabs: NoteRecord[];
  activeNoteId: string | null;
  isBootstrapping: boolean;
  onCreateNote: () => void;
  onSelectTab: (noteId: string) => void;
  onCloseTab: (noteId: string) => void;
};

export default function TabBar(props: TabBarProps) {
  return (
    <div class="flex h-11 items-center gap-1 overflow-x-auto border-b border-border bg-surface px-2 py-1">
      <For each={props.tabs}>
        {(note) => (
          <div
            class={`flex h-8 max-w-[220px] shrink-0 items-center gap-1 rounded-md px-2 ${
              props.activeNoteId === note.id
                ? "text-text-primary"
                : "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
            }`}
            style={
              props.activeNoteId === note.id
                ? { "box-shadow": "inset 0 -2px 0 var(--color-accent)" }
                : {}
            }
          >
            <button
              type="button"
              disabled={props.isBootstrapping}
              aria-label={`Open ${deriveTitle(note.body)}`}
              class="min-w-0 flex-1 truncate text-left text-sm"
              onClick={() => props.onSelectTab(note.id)}
            >
              {deriveTitle(note.body)}
            </button>

            <button
              type="button"
              disabled={props.isBootstrapping}
              aria-label={`Close ${deriveTitle(note.body)}`}
              class="inline-flex h-6 w-6 items-center justify-center rounded text-xs text-text-tertiary hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => props.onCloseTab(note.id)}
            >
              ×
            </button>
          </div>
        )}
      </For>

      <button
        type="button"
        disabled={props.isBootstrapping}
        aria-label="New note"
        class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-base text-text-secondary hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => props.onCreateNote()}
      >
        +
      </button>
    </div>
  );
}
