import type { JSX } from "solid-js";
import { createSignal, onCleanup, onMount } from "solid-js";
import EditorButton from "./EditorButton";

interface Props {
  id: string;
  label: string;
  class?: string;
  triggerTestId?: string;
  ref?: (trigger: HTMLButtonElement) => void;
  children: JSX.Element;
}

/**
 * Lower-priority controls. Wide layouts show them inline; narrow layouts
 * collect them behind a "More" disclosure. The controls are the same
 * elements at every width, so names, test IDs, and focus targets stay stable.
 */
export default function EditorOverflow(props: Props) {
  let container!: HTMLDivElement;
  let trigger!: HTMLButtonElement;
  let panel!: HTMLDivElement;
  const [open, setOpen] = createSignal(false);

  const close = (restoreFocus = false) => {
    if (!open()) return;
    setOpen(false);
    if (restoreFocus) trigger.focus({ preventScroll: true });
  };

  onMount(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.contains(event.target)) close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !open()) return;
      event.preventDefault();
      close(container.contains(document.activeElement));
    };
    // Activating a control inside the list closes it. Focus returns to the
    // trigger only when the control itself has gone away.
    const handlePanelClick = (event: MouseEvent) => {
      if (
        !open() ||
        !(event.target instanceof Element) ||
        !event.target.closest("button, a") ||
        event.target.closest("[data-overflow-keep-open]")
      )
        return;
      setOpen(false);
      queueMicrotask(() => {
        const focused = document.activeElement;
        if (!focused || focused === document.body || !focused.getClientRects().length)
          trigger.focus({ preventScroll: true });
      });
    };
    panel.addEventListener("click", handlePanelClick);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown, true);
    onCleanup(() => {
      panel.removeEventListener("click", handlePanelClick);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown, true);
    });
  });

  return (
    <div
      ref={container}
      class={`editor-overflow${props.class ? ` ${props.class}` : ""}`}
      classList={{ "is-open": open() }}
    >
      <EditorButton
        ref={(element) => {
          trigger = element;
          props.ref?.(element);
        }}
        data-testid={props.triggerTestId}
        class="editor-overflow-trigger"
        variant="plain"
        icon="more"
        aria-label={props.label}
        title={props.label}
        aria-expanded={open()}
        aria-controls={props.id}
        onClick={() => {
          if (!open()) {
            // Narrow layouts open the list under the trigger, kept on screen.
            const box = trigger.getBoundingClientRect();
            container.style.setProperty("--overflow-top", `${box.bottom + 8}px`);
            container.style.setProperty("--overflow-right", `${window.innerWidth - box.right}px`);
          }
          setOpen(!open());
        }}
      />
      <div id={props.id} ref={panel} class="editor-overflow-panel">
        {props.children}
      </div>
    </div>
  );
}
