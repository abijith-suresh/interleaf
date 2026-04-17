import { Show, createEffect } from "solid-js";

import { trapFocus, focusFirstDescendant } from "@/utils/focusTrap";
import type { NoteExportFormat } from "@/utils/exportNote";

type NoteActionsMenuProps = {
  open: boolean;
  onClose: () => void;
  onExport: (format: NoteExportFormat) => void;
};

export default function NoteActionsMenu(props: NoteActionsMenuProps) {
  let menuRef: HTMLDivElement | undefined;

  createEffect(() => {
    if (!props.open) {
      return;
    }

    queueMicrotask(() => {
      focusFirstDescendant(menuRef);
    });
  });

  return (
    <Show when={props.open}>
      <div
        ref={menuRef}
        class="animate-dropdown-in fixed top-12 right-2 z-50 min-w-[160px] rounded-md border border-border bg-surface p-1 shadow-md"
        role="menu"
        aria-label="Export note"
        onKeyDown={(event) => {
          if (trapFocus(menuRef, event)) {
            return;
          }

          if (event.key === "Escape") {
            event.preventDefault();
            props.onClose();
            return;
          }

          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
            return;
          }

          event.preventDefault();

          const items = menuRef
            ? Array.from(
                menuRef.querySelectorAll<HTMLElement>(
                  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
                ),
              )
            : [];

          const currentIndex = items.findIndex(
            (el) => el === document.activeElement,
          );
          const nextIndex =
            event.key === "ArrowDown"
              ? (currentIndex + 1) % items.length
              : (currentIndex - 1 + items.length) % items.length;

          items[nextIndex]?.focus();
        }}
      >
        <p class="px-3 pt-2 pb-1 text-[10px] font-medium uppercase tracking-[0.12em] text-text-tertiary">
          Export note
        </p>
        <button
          type="button"
          role="menuitem"
          aria-label="Export note as plain text"
          class="flex w-full rounded-sm px-3 py-2 text-left text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary"
          onClick={() => props.onExport("txt")}
        >
          Plain text (.txt)
        </button>
        <button
          type="button"
          role="menuitem"
          aria-label="Export note as markdown"
          class="flex w-full rounded-sm px-3 py-2 text-left text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary"
          onClick={() => props.onExport("md")}
        >
          Markdown (.md)
        </button>
      </div>
    </Show>
  );
}
