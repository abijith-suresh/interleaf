import { Show, createEffect } from "solid-js";

import type { NoteExportFormat } from "@/utils/exportNote";
import { focusFirstDescendant, getFocusableElements, trapFocus } from "@/utils/focusTrap";

type ExportAllMenuProps = {
  open: boolean;
  onExport: (format: NoteExportFormat) => void;
};

export default function ExportAllMenu(props: ExportAllMenuProps) {
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
        class="absolute bottom-full left-1/2 z-40 mb-2 w-[220px] -translate-x-1/2 rounded-md border border-border bg-surface p-1 shadow-md"
        role="menu"
        aria-label="Export all notes"
        onKeyDown={(event) => {
          if (trapFocus(menuRef, event)) {
            return;
          }

          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
            return;
          }

          event.preventDefault();
          const items = getFocusableElements(menuRef);
          const currentIndex = items.findIndex((element) => element === document.activeElement);
          const nextIndex =
            event.key === "ArrowDown"
              ? (currentIndex + 1 + items.length) % items.length
              : (currentIndex - 1 + items.length) % items.length;

          items[nextIndex]?.focus();
        }}
      >
        <button
          type="button"
          role="menuitem"
          aria-label="Export all notes as text zip"
          class="flex w-full rounded-sm px-3 py-2 text-left text-sm text-text-primary hover:bg-surface-hover"
          onClick={() => props.onExport("txt")}
        >
          Export all as .txt (.zip)
        </button>
        <button
          type="button"
          role="menuitem"
          aria-label="Export all notes as markdown zip"
          class="flex w-full rounded-sm px-3 py-2 text-left text-sm text-text-primary hover:bg-surface-hover"
          onClick={() => props.onExport("md")}
        >
          Export all as .md (.zip)
        </button>
      </div>
    </Show>
  );
}
