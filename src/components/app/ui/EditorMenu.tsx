import type { JSX } from "solid-js";
import { createContext, createSignal, onCleanup, onMount, Show, useContext } from "solid-js";
import EditorButton from "./EditorButton";
import EditorIcon, { type EditorIconName } from "./EditorIcon";

interface MenuContextValue {
  run: (action: () => void, disabled: boolean) => void;
}

const MenuContext = createContext<MenuContextValue>();

interface MenuProps {
  id: string;
  label: string;
  /** Accessible name of the trigger. Defaults to `label`. */
  ariaLabel?: string;
  menuLabel: string;
  testId?: string;
  menuTestId?: string;
  icon?: EditorIconName;
  variant?: "secondary" | "primary";
  class?: string;
  busy?: boolean;
  busyLabel?: string;
  ref?: (trigger: HTMLButtonElement) => void;
  /** Content shown at the top of the open menu, outside the item list. */
  header?: JSX.Element;
  children: JSX.Element;
}

/** A menu button: Cards' menu panel with arrow, Home, End, Escape, and Tab support. */
export function EditorMenu(props: MenuProps) {
  let container!: HTMLDivElement;
  let trigger!: HTMLButtonElement;
  let panel: HTMLDivElement | undefined;
  const [open, setOpen] = createSignal(false);

  const items = () =>
    panel ? Array.from(panel.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')) : [];

  const focusItem = (index: number) =>
    queueMicrotask(() => {
      const list = items();
      list[index < 0 ? list.length + index : index]?.focus();
    });

  const close = (restoreFocus = false) => {
    if (!open()) return;
    setOpen(false);
    if (restoreFocus) queueMicrotask(() => trigger.focus());
  };

  const toggle = () => {
    if (props.busy) return;
    if (open()) {
      close(true);
      return;
    }
    setOpen(true);
    focusItem(0);
  };

  const nextTabbable = (from: HTMLElement, backwards: boolean) => {
    const all = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex="-1"])'
      )
    ).filter(
      (element) =>
        (element === from || element.tabIndex >= 0) &&
        !element.closest('[role="menu"]') &&
        element.getClientRects().length > 0
    );
    const index = all.indexOf(from);
    return backwards ? from : (all[index + 1] ?? from);
  };

  const handleMenuKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const target = nextTabbable(trigger, event.shiftKey);
      close();
      queueMicrotask(() => target.focus());
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const list = items();
    if (list.length === 0) return;
    const index = Math.max(list.indexOf(event.target as HTMLButtonElement), 0);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? list.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + list.length) % list.length;
    list[next]?.focus();
  };

  onMount(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.contains(event.target)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && open()) {
        event.preventDefault();
        close(true);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown, true);
    onCleanup(() => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown, true);
    });
  });

  return (
    <div ref={container} class={`editor-menu-group${props.class ? ` ${props.class}` : ""}`}>
      <EditorButton
        ref={(element) => {
          trigger = element;
          props.ref?.(element);
        }}
        data-testid={props.testId}
        class="editor-menu-trigger"
        variant={props.variant ?? "secondary"}
        icon={props.icon}
        aria-haspopup="menu"
        aria-label={props.busy ? props.busyLabel : (props.ariaLabel ?? props.label)}
        aria-controls={props.id}
        aria-expanded={open()}
        aria-disabled={props.busy}
        title={props.busy ? props.busyLabel : (props.ariaLabel ?? props.label)}
        onClick={toggle}
        onKeyDown={(event) => {
          if (props.busy || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
          event.preventDefault();
          setOpen(true);
          focusItem(event.key === "ArrowUp" ? -1 : 0);
        }}
      >
        <span class="editor-menu-trigger-label">{props.label}</span>
        <EditorIcon name="chevron-down" />
      </EditorButton>
      <Show when={open()}>
        <div
          ref={panel}
          id={props.id}
          data-testid={props.menuTestId}
          class="editor-menu-panel"
          role="menu"
          aria-label={props.menuLabel}
          onKeyDown={handleMenuKeyDown}
        >
          {props.header}
          <MenuContext.Provider
            value={{
              run: (action, disabled) => {
                if (disabled) return;
                close(true);
                action();
              },
            }}
          >
            {props.children}
          </MenuContext.Provider>
        </div>
      </Show>
    </div>
  );
}

interface ItemProps {
  testId?: string;
  label: string;
  ariaLabel: string;
  hint?: string;
  disabled: boolean;
  onSelect: () => void;
}

/** A menu item. Unavailable items stay focusable and say why. */
export function EditorMenuItem(props: ItemProps) {
  const menu = useContext(MenuContext);
  return (
    <EditorButton
      role="menuitem"
      tabindex="-1"
      data-testid={props.testId}
      aria-disabled={props.disabled}
      aria-label={props.ariaLabel}
      title={props.ariaLabel}
      class="editor-menu-item"
      variant="plain"
      onClick={() => menu?.run(props.onSelect, props.disabled)}
    >
      <span class="editor-menu-item-copy">
        <span>{props.label}</span>
        <Show when={props.hint}>
          <span class="editor-menu-item-hint">{props.hint}</span>
        </Show>
      </span>
    </EditorButton>
  );
}
