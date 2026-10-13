import { For } from "solid-js";

export type EditorWorkspaceTool = "pages" | "read" | "add" | "replace" | "forms";

interface Props {
  activeTool: EditorWorkspaceTool;
  busy?: boolean;
  onChooseTool: (tool: EditorWorkspaceTool) => void;
}

const tools: { id: EditorWorkspaceTool; label: string; path: string }[] = [
  {
    id: "pages",
    label: "Pages",
    path: "M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z",
  },
  {
    id: "read",
    label: "Read",
    path: "M12 6v14 M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 M12 6c3-2 6-2 9-1v14c-3-1-6-1-9 1",
  },
  {
    id: "add",
    label: "Add text",
    path: "M3 5h12 M9 5v14 M6 19h6 M18 13v7 M14.5 16.5h7",
  },
  {
    id: "replace",
    label: "Edit text",
    path: "M3 5h12 M9 5v14 M6 19h5 M13 17l5-5 3 3-5 5-4 1z M17 13l3 3",
  },
  {
    id: "forms",
    label: "Fill forms",
    path: "M5 3h14v18H5z M8 7h8 M8 11h2v2H8z M13 12h3 M8 16h2v2H8z M13 17h3",
  },
];

export default function EditorToolRail(props: Props) {
  return (
    <nav class="editor-tool-rail" aria-label="Workspace tools">
      <div class="editor-tool-rail-brand">interleaf</div>
      <div class="editor-tool-rail-tools">
        <For each={tools}>
          {(tool) => (
            <button
              type="button"
              class="editor-tool-rail-item"
              aria-pressed={props.activeTool === tool.id}
              disabled={props.busy}
              onClick={() => props.onChooseTool(tool.id)}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d={tool.path} />
              </svg>
              <span>{tool.label}</span>
            </button>
          )}
        </For>
      </div>
    </nav>
  );
}
