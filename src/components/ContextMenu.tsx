import { Show } from "solid-js";

type ContextMenuProps = {
  open: boolean;
  x: number;
  y: number;
  exportOpen: boolean;
  noteTitle: string;
  onToggleExport: () => void;
  onExport: (format: "txt" | "md") => void;
  onDelete: () => void;
};

export default function ContextMenu(props: ContextMenuProps) {
  return (
    <Show when={props.open}>
      <div
        class="fixed z-40 min-w-[168px] rounded-md border border-border bg-surface p-1 shadow-md"
        style={{
          left: `${props.x}px`,
          top: `${props.y}px`
        }}
        role="menu"
        aria-label={`Actions for ${props.noteTitle}`}
      >
        <button
          type="button"
          class="flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm text-text-primary hover:bg-surface-hover"
          onClick={() => props.onToggleExport()}
        >
          <span>Export note</span>
          <span class="text-xs text-text-tertiary">{props.exportOpen ? "-" : "+"}</span>
        </button>

        <Show when={props.exportOpen}>
          <div class="mb-1 space-y-1 px-2 pb-1">
            <button
              type="button"
              class="flex w-full rounded-sm px-3 py-2 text-left text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary"
              onClick={() => props.onExport("txt")}
            >
              .txt
            </button>
            <button
              type="button"
              class="flex w-full rounded-sm px-3 py-2 text-left text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary"
              onClick={() => props.onExport("md")}
            >
              .md
            </button>
          </div>
        </Show>

        <button
          type="button"
          class="flex w-full rounded-sm px-3 py-2 text-left text-sm text-danger hover:bg-surface-hover"
          onClick={() => props.onDelete()}
        >
          Delete note
        </button>
      </div>
    </Show>
  );
}
