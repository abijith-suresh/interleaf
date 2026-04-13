import { For, Show } from "solid-js";
import {
  HiOutlinePlus,
  HiOutlineMagnifyingGlass,
  HiOutlineArrowDownOnSquare,
  HiOutlineInformationCircle,
} from "solid-icons/hi";

import type { NoteRecord } from "@/types/note";
import { deriveTitle } from "@/utils/deriveTitle";
import { toLocalDayKey } from "@/utils/dayKey";

type NoteGroup = {
  dayKey: string;
  label: string;
  notes: NoteRecord[];
};

type SidebarProps = {
  open: boolean;
  onClose: () => void;
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
    <>
      {/* Backdrop */}
      <div
        class={`fixed inset-0 z-[39] bg-overlay transition-opacity duration-200 ${
          props.open
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        }`}
        onClick={() => props.onClose()}
      />

      {/* Sidebar panel */}
      <aside
        class={`fixed top-0 left-0 z-40 flex h-full w-[232px] flex-col border-r border-border bg-surface transition-transform duration-200 ease-out ${
          props.open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Header */}
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
            class="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition-colors duration-150 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => {
              props.onCreateNote();
              props.onClose();
            }}
          >
            <HiOutlinePlus size={16} />
          </button>
        </div>

        {/* Note list */}
        <div class="flex-1 overflow-y-auto px-2 py-3">
          <Show when={props.isLoading}>
            <div class="px-2 py-2 text-sm text-text-secondary">
              Loading notes...
            </div>
          </Show>
          <Show when={!props.isLoading && props.groups.length === 0}>
            <div class="px-2 py-2 text-sm text-text-secondary">
              No notes yet.
            </div>
          </Show>
          <For each={props.groups}>
            {(group) => (
              <section class="mb-4 last:mb-0">
                <div class="mb-1 border-b border-border-subtle px-2 pb-1.5 pt-3 text-[10px] font-medium uppercase tracking-[0.12em] text-text-tertiary">
                  {group.label}
                </div>
                <div class="space-y-1">
                  <For each={group.notes}>
                    {(note) => (
                      <button
                        type="button"
                        disabled={props.isBootstrapping}
                        aria-label={`Open ${deriveTitle(note.body)}`}
                        class={`flex w-full items-center truncate rounded-md py-1.5 text-left text-sm transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${
                          props.activeNoteId === note.id
                            ? "border-l-2 border-accent bg-accent-subtle pl-[10px] pr-3 text-accent font-medium"
                            : "border-l-2 border-transparent px-3 text-text-secondary hover:bg-surface-hover"
                        }`}
                        onClick={() => {
                          props.onSelectNote(note.id);
                          props.onClose();
                        }}
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

        {/* Footer */}
        <div class="border-t border-border px-2 py-3">
          <div class="flex justify-around">
            <button
              type="button"
              aria-label="Search notes"
              class="flex flex-col items-center gap-1 rounded-md px-3 py-2 text-text-tertiary transition-colors duration-150 hover:bg-surface-hover hover:text-accent"
              onClick={() => props.onOpenSearch()}
            >
              <HiOutlineMagnifyingGlass size={16} />
              <span class="text-[10px] font-medium uppercase tracking-wide">
                search
              </span>
            </button>
            <button
              type="button"
              aria-label="Export all notes"
              disabled={props.isBootstrapping}
              class="flex flex-col items-center gap-1 rounded-md px-3 py-2 text-text-tertiary transition-colors duration-150 hover:bg-surface-hover hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => props.onExportAll()}
            >
              <HiOutlineArrowDownOnSquare size={16} />
              <span class="text-[10px] font-medium uppercase tracking-wide">
                export
              </span>
            </button>
            <a
              href="/about/"
              aria-label="About interleaf"
              class="flex flex-col items-center gap-1 rounded-md px-3 py-2 text-text-tertiary transition-colors duration-150 hover:bg-surface-hover hover:text-accent"
            >
              <HiOutlineInformationCircle size={16} />
              <span class="text-[10px] font-medium uppercase tracking-wide">
                about
              </span>
            </a>
          </div>
        </div>
      </aside>
    </>
  );
}
