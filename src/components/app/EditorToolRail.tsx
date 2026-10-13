import { createSignal, For, onCleanup, onMount, Show } from "solid-js";

export type EditorWorkspaceTool = "pages" | "read" | "add" | "replace" | "forms";

interface Props {
  activeTool: EditorWorkspaceTool;
  busy?: boolean;
  onChooseTool: (tool: EditorWorkspaceTool) => void;
}

const tools = [
  {
    id: "add" as const,
    label: "Add text",
    description: "Place new text anywhere on the page.",
    path: "M3 5h12 M9 5v14 M6 19h6 M18 13v7 M14.5 16.5h7",
  },
  {
    id: "replace" as const,
    label: "Edit text",
    description: "Replace supported original text.",
    path: "M3 5h12 M9 5v14 M6 19h5 M13 17l5-5 3 3-5 5-4 1z M17 13l3 3",
  },
  {
    id: "forms" as const,
    label: "Fill forms",
    description: "Fill the fields built into the PDF.",
    path: "M5 3h14v18H5z M8 7h8 M8 11h2v2H8z M13 12h3 M8 16h2v2H8z M13 17h3",
  },
];
const views = [
  {
    id: "pages" as const,
    label: "Pages",
    path: "M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z",
  },
  { id: "read" as const, label: "Document", path: "M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h7" },
];

function ToolIcon(props: { path: string }) {
  return (
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
      <path d={props.path} />
    </svg>
  );
}

export default function EditorToolRail(props: Props) {
  const [compact, setCompact] = createSignal(
    typeof window !== "undefined" && window.innerWidth <= 700
  );
  const [open, setOpen] = createSignal(false);
  let rail!: HTMLElement;
  let sheet!: HTMLDialogElement;
  let trigger!: HTMLButtonElement;
  const documentActive = () => props.activeTool !== "pages";
  const activeLabel = () => tools.find((tool) => tool.id === props.activeTool)?.label;
  const close = () => {
    setOpen(false);
    sheet?.close();
    trigger?.focus({ preventScroll: true });
  };
  const choose = (tool: EditorWorkspaceTool) => {
    if (props.busy) return;
    if (open()) close();
    props.onChooseTool(tool);
  };
  onMount(() => {
    const query = window.matchMedia(
      "(max-width: 700px), (pointer: coarse) and (max-height: 500px)"
    );
    const resize = () => {
      const focused = document.activeElement;
      const restoreFocus = rail.contains(focused);
      if (open()) close();
      setCompact(query.matches);
      if (restoreFocus) {
        queueMicrotask(() => {
          if (focused?.isConnected) return;
          const target = compact()
            ? trigger
            : (rail.querySelector<HTMLButtonElement>(
                '.editor-workspace-actions [aria-pressed="true"]'
              ) ?? rail.querySelector<HTMLButtonElement>('[aria-current="page"]'));
          target?.focus({ preventScroll: true });
        });
      }
    };
    setCompact(query.matches);
    query.addEventListener("change", resize);
    onCleanup(() => query.removeEventListener("change", resize));
  });

  return (
    <aside ref={rail} class="editor-tool-rail">
      <div class="editor-tool-rail-brand">interleaf</div>
      <div class="editor-tool-rail-tools">
        <nav class="editor-workspace-views" aria-label="Workspace views">
          <For each={views}>
            {(view) => (
              <button
                type="button"
                class="editor-tool-rail-item"
                aria-current={
                  (view.id === "pages" ? !documentActive() : documentActive()) ? "page" : undefined
                }
                disabled={props.busy}
                onClick={() => choose(view.id)}
              >
                <ToolIcon path={view.path} />
                <span>{view.label}</span>
              </button>
            )}
          </For>
        </nav>
        <Show
          when={!compact()}
          fallback={
            <button
              ref={trigger}
              type="button"
              class="editor-tool-rail-item editor-tools-trigger"
              aria-haspopup="dialog"
              aria-expanded={open()}
              disabled={props.busy}
              onClick={() => {
                setOpen(true);
                sheet.showModal();
              }}
            >
              <ToolIcon path="M3 6h18 M3 12h18 M3 18h18 M8 3v6 M16 9v6 M10 15v6" />
              <span>Tools</span>
              <Show when={activeLabel()}>
                <small>{activeLabel()}</small>
              </Show>
            </button>
          }
        >
          <fieldset class="editor-workspace-actions" aria-label="PDF tools">
            <legend>Tools</legend>
            <For each={tools}>
              {(tool) => (
                <button
                  type="button"
                  class="editor-tool-rail-item"
                  aria-pressed={props.activeTool === tool.id}
                  disabled={props.busy}
                  onClick={() => choose(tool.id)}
                >
                  <ToolIcon path={tool.path} />
                  <span>{tool.label}</span>
                </button>
              )}
            </For>
          </fieldset>
        </Show>
      </div>
      <Show when={compact()}>
        <dialog
          ref={sheet}
          class="editor-tools-sheet"
          aria-label="PDF tools"
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              event.preventDefault();
              close();
            }
          }}
          onClick={(event) => {
            if (event.target === sheet) close();
          }}
        >
          <header>
            <h2>Tools</h2>
            <button type="button" aria-label="Close tools" onClick={close}>
              ×
            </button>
          </header>
          <div class="editor-tools-sheet-list">
            <For each={tools}>
              {(tool) => (
                <button
                  type="button"
                  aria-label={tool.label}
                  aria-describedby={`pdf-tool-${tool.id}-description`}
                  aria-pressed={props.activeTool === tool.id}
                  disabled={props.busy}
                  onClick={() => choose(tool.id)}
                >
                  <ToolIcon path={tool.path} />
                  <span>
                    <strong>{tool.label}</strong>
                    <small id={`pdf-tool-${tool.id}-description`}>{tool.description}</small>
                  </span>
                </button>
              )}
            </For>
          </div>
        </dialog>
      </Show>
    </aside>
  );
}
