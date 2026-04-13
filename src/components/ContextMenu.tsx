import { Show, createEffect } from "solid-js";
import { HiOutlineChevronDown, HiOutlineChevronRight } from "solid-icons/hi";

import {
  focusFirstDescendant,
  getFocusableElements,
  trapFocus,
} from "@/utils/focusTrap";

type ContextMenuProps = {
  open: boolean;
  x: number;
  y: number;
  exportOpen: boolean;
  noteTitle: string;
  onToggleExport: () => void;
  onExport: (format: "txt" | "md") => void;
  onDelete: () => void;
  onClose: () => void;
};

export default function ContextMenu(props: ContextMenuProps) {
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
        class="fixed z-40 min-w-[168px] rounded-md border border-border bg-surface p-1 shadow-md"
        style={{
          left: `${props.x}px`,
          top: `${props.y}px`,
        }}
        role="menu"
        aria-label={`Actions for ${props.noteTitle}`}
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
          const items = getFocusableElements(menuRef);
          const currentIndex = items.findIndex(
            (element) => element === document.activeElement,
          );
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
          aria-label="Toggle export note options"
          class="flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm text-text-primary hover:bg-surface-hover"
          onClick={() => props.onToggleExport()}
        >
          <span>Export note</span>
          <span class="text-text-tertiary">
            {props.exportOpen ? (
              <HiOutlineChevronDown class="h-3.5 w-3.5" />
            ) : (
              <HiOutlineChevronRight class="h-3.5 w-3.5" />
            )}
          </span>
        </button>

        <Show when={props.exportOpen}>
          <div class="mb-1 space-y-1 px-2 pb-1">
            <button
              type="button"
              role="menuitem"
              aria-label="Export note as text"
              class="flex w-full rounded-sm px-3 py-2 text-left text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary"
              onClick={() => props.onExport("txt")}
            >
              .txt
            </button>
            <button
              type="button"
              role="menuitem"
              aria-label="Export note as markdown"
              class="flex w-full rounded-sm px-3 py-2 text-left text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary"
              onClick={() => props.onExport("md")}
            >
              .md
            </button>
          </div>
        </Show>

        <button
          type="button"
          role="menuitem"
          aria-label="Delete note"
          class="flex w-full rounded-sm px-3 py-2 text-left text-sm text-danger hover:bg-surface-hover"
          onClick={() => props.onDelete()}
        >
          Delete note
        </button>
      </div>
    </Show>
  );
}
