import { Show } from "solid-js";

import type { NoteExportFormat } from "@/utils/exportNote";

type ExportAllMenuProps = {
  open: boolean;
  onExport: (format: NoteExportFormat) => void;
};

export default function ExportAllMenu(props: ExportAllMenuProps) {
  return (
    <Show when={props.open}>
      <div class="absolute bottom-full left-1/2 z-40 mb-2 w-[220px] -translate-x-1/2 rounded-md border border-border bg-surface p-1 shadow-md">
        <button
          type="button"
          class="flex w-full rounded-sm px-3 py-2 text-left text-sm text-text-primary hover:bg-surface-hover"
          onClick={() => props.onExport("txt")}
        >
          Export all as .txt (.zip)
        </button>
        <button
          type="button"
          class="flex w-full rounded-sm px-3 py-2 text-left text-sm text-text-primary hover:bg-surface-hover"
          onClick={() => props.onExport("md")}
        >
          Export all as .md (.zip)
        </button>
      </div>
    </Show>
  );
}
