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
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
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
    notes: dayNotes,
  }));
}

export default function Sidebar(props: SidebarProps) {
  return (
    <aside class="flex w-[232px] shrink-0 flex-col border-r border-border bg-surface">
      <div class="flex items-center justify-between border-b border-border px-4 py-3">
        <a
          href="/"
          class="font-serif text-lg italic font-normal text-text-primary"
        >
          interleaf
        </a>
        <button
          type="button"
          aria-label="New note"
          disabled={props.isBootstrapping}
          class="inline-flex h-8 w-8 items-center justify-center text-base text-tertiary hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => props.onCreateNote()}
        >
          +
        </button>
      </div>

      <div class="flex-1 overflow-y-auto px-2 py-3">
        <Show when={props.isLoading}>
          <div class="px-2 py-2 text-sm text-text-secondary">
            Loading notes...
          </div>
        </Show>

        <Show when={!props.isLoading && props.groups.length === 0}>
          <div class="px-2 py-2 text-sm text-text-secondary">No notes yet.</div>
        </Show>

        <For each={props.groups}>
          {(group) => (
            <section class="mb-5 last:mb-0">
              <div class="px-2 pb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-text-tertiary">
                {group.label}
              </div>

              <div class="space-y-1">
                <For each={group.notes}>
                  {(note) => (
                    <button
                      type="button"
                      disabled={props.isBootstrapping}
                      aria-label={`Open ${deriveTitle(note.body)}`}
                      class={`note-item-hover flex w-full items-center truncate px-3 py-1.5 text-left text-sm ${
                        props.activeNoteId === note.id
                          ? "text-accent font-medium"
                          : "text-text-secondary"
                      } disabled:cursor-not-allowed disabled:opacity-60`}
                      onClick={() => props.onSelectNote(note.id)}
                      onContextMenu={(event) =>
                        props.onNoteContextMenu(note.id, event)
                      }
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
            class="px-2 py-2 text-[11px] text-text-tertiary hover:text-accent"
            onClick={() => props.onOpenSearch()}
          >
            search
          </button>
          <button
            type="button"
            aria-label={`Switch to ${props.theme === "light" ? "dark" : "light"} theme`}
            class="px-2 py-2 text-[11px] text-text-tertiary hover:text-accent"
            onClick={() => props.onToggleTheme()}
          >
            theme
          </button>
          <button
            type="button"
            aria-label="Export all notes"
            disabled={props.isBootstrapping}
            class="px-2 py-2 text-[11px] text-text-tertiary hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => props.onExportAll()}
          >
            export
          </button>
          <a
            href="/about/"
            aria-label="About interleaf"
            class="px-2 py-2 text-center text-[11px] text-text-tertiary hover:text-accent"
          >
            about
          </a>
        </div>
      </div>
    </aside>
  );
}
