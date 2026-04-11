import { For, Show } from "solid-js";

import type { NoteRecord } from "@/types/note";
import { deriveTitle } from "@/utils/deriveTitle";
import { toLocalDayKey } from "@/utils/dayKey";

type NoteGroup = {
  dayKey: string;
  label: string;
  notes: NoteRecord[];
};

type SidebarProps = {
  groups: NoteGroup[];
  activeNoteId: string | null;
  theme: "light" | "dark";
  isLoading: boolean;
  isBootstrapping: boolean;
  onCreateNote: () => void;
  onSelectNote: (noteId: string) => void;
  onNoteContextMenu: (noteId: string, event: MouseEvent) => void;
  onOpenSearch: () => void;
  onToggleTheme: () => void;
  onExportAll: () => void;
};

function formatDayLabel(dayKey: string) {
  if (dayKey === toLocalDayKey()) {
    return "Today";
  }

  const date = new Date(`${dayKey}T00:00:00`);

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric"
  }).format(date);
}

export function groupNotesByDay(notes: NoteRecord[]): NoteGroup[] {
  const groups = new Map<string, NoteRecord[]>();

  for (const note of notes) {
    const group = groups.get(note.dayKey);

    if (group) {
      group.push(note);
      continue;
    }

    groups.set(note.dayKey, [note]);
  }

  return [...groups.entries()].map(([dayKey, dayNotes]) => ({
    dayKey,
    label: formatDayLabel(dayKey),
    notes: dayNotes
  }));
}

export default function Sidebar(props: SidebarProps) {
  return (
    <aside class="flex w-[240px] shrink-0 flex-col border-r border-border bg-surface">
      <div class="flex items-center justify-between border-b border-border px-4 py-3">
        <a href="/" class="text-md font-medium text-text-primary">
          interleaf
        </a>
        <button
          type="button"
          aria-label="New note"
          disabled={props.isBootstrapping}
          class="inline-flex h-8 w-8 items-center justify-center rounded-md text-base text-text-secondary hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => props.onCreateNote()}
        >
          +
        </button>
      </div>

      <div class="flex-1 overflow-y-auto px-2 py-3">
        <Show when={props.isLoading}>
          <div class="px-2 py-2 text-sm text-text-secondary">Loading notes...</div>
        </Show>

        <Show when={!props.isLoading && props.groups.length === 0}>
          <div class="px-2 py-2 text-sm text-text-secondary">No notes yet.</div>
        </Show>

        <For each={props.groups}>
          {(group) => (
            <section class="mb-5 last:mb-0">
              <div class="px-2 pb-2 text-xs font-medium uppercase tracking-[0.08em] text-text-tertiary">
                {group.label}
              </div>

              <div class="space-y-1">
                <For each={group.notes}>
                  {(note) => (
                    <button
                      type="button"
                      disabled={props.isBootstrapping}
                      aria-label={`Open ${deriveTitle(note.body)}`}
                      class={`flex w-full items-center truncate rounded-sm border-l-2 px-3 py-2 text-left text-sm ${
                        props.activeNoteId === note.id
                          ? "border-l-accent bg-accent-subtle text-text-primary"
                          : "border-l-transparent text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                       } disabled:cursor-not-allowed disabled:opacity-60`}
                      onClick={() => props.onSelectNote(note.id)}
                      onContextMenu={(event) => props.onNoteContextMenu(note.id, event)}
                    >
                      <span class="truncate">{deriveTitle(note.body)}</span>
                    </button>
                  )}
                </For>
              </div>
            </section>
          )}
        </For>
      </div>

      <div class="border-t border-border px-2 py-2">
        <div class="grid grid-cols-4 gap-1">
          <button
            type="button"
            aria-label="Search notes"
            class="rounded-md px-2 py-2 text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary"
            onClick={() => props.onOpenSearch()}
          >
            Search
          </button>
          <button
            type="button"
            aria-label={`Switch to ${props.theme === "light" ? "dark" : "light"} theme`}
            class="rounded-md px-2 py-2 text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary"
            onClick={() => props.onToggleTheme()}
          >
            {props.theme === "light" ? "Dark" : "Light"}
          </button>
          <button
            type="button"
            aria-label="Export all notes"
            disabled={props.isBootstrapping}
            class="rounded-md px-2 py-2 text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => props.onExportAll()}
          >
            Export
          </button>
          <a
            href="/about/"
            aria-label="About interleaf"
            class="rounded-md px-2 py-2 text-center text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary"
          >
            About
          </a>
        </div>
      </div>
    </aside>
  );
}
