import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import EditorButton from "./ui/EditorButton";
import EditorIcon from "./ui/EditorIcon";

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
    icon: "add" as const,
  },
  {
    id: "replace" as const,
    label: "Edit text",
    description: "Replace supported original text.",
    icon: "edit" as const,
  },
  {
    id: "forms" as const,
    label: "Fill forms",
    description: "Fill fields or place text on blanks.",
    icon: "forms" as const,
  },
];
const views = [
  {
    id: "pages" as const,
    label: "Pages",
    icon: "pages" as const,
  },
  { id: "read" as const, label: "Document", icon: "document" as const },
];

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
              <EditorButton
                variant="plain"
                type="button"
                class="editor-tool-rail-item"
                aria-current={
                  (view.id === "pages" ? !documentActive() : documentActive()) ? "page" : undefined
                }
                disabled={props.busy}
                onClick={() => choose(view.id)}
              >
                <EditorIcon name={view.icon} />
                <span>{view.label}</span>
              </EditorButton>
            )}
          </For>
        </nav>
        <Show
          when={!compact()}
          fallback={
            <EditorButton
              variant="plain"
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
              <EditorIcon name="tools" />
              <span>Tools</span>
              <Show when={activeLabel()}>
                <small>{activeLabel()}</small>
              </Show>
            </EditorButton>
          }
        >
          <fieldset class="editor-workspace-actions" aria-label="PDF tools">
            <legend>Tools</legend>
            <For each={tools}>
              {(tool) => (
                <EditorButton
                  variant="plain"
                  type="button"
                  class="editor-tool-rail-item"
                  aria-pressed={props.activeTool === tool.id}
                  disabled={props.busy}
                  onClick={() => choose(tool.id)}
                >
                  <EditorIcon name={tool.icon} />
                  <span>{tool.label}</span>
                </EditorButton>
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
            <EditorButton variant="plain" type="button" aria-label="Close tools" onClick={close}>
              <EditorIcon name="close" />
            </EditorButton>
          </header>
          <div class="editor-tools-sheet-list">
            <For each={tools}>
              {(tool) => (
                <EditorButton
                  variant="plain"
                  type="button"
                  aria-label={tool.label}
                  aria-describedby={`pdf-tool-${tool.id}-description`}
                  aria-pressed={props.activeTool === tool.id}
                  disabled={props.busy}
                  onClick={() => choose(tool.id)}
                >
                  <EditorIcon name={tool.icon} />
                  <span>
                    <strong>{tool.label}</strong>
                    <small id={`pdf-tool-${tool.id}-description`}>{tool.description}</small>
                  </span>
                </EditorButton>
              )}
            </For>
          </div>
        </dialog>
      </Show>
    </aside>
  );
}
