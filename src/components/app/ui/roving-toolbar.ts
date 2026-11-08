import { onCleanup, onMount } from "solid-js";

const ITEMS = "button, a[href]";
const PREVIOUS = new Set(["ArrowLeft"]);
const NEXT = new Set(["ArrowRight"]);

/**
 * Makes a `role="toolbar"` element one Tab stop. Arrow keys, Home, and End
 * move between its visible, enabled controls. Controls inside a menu or a
 * nested toolbar are left alone. Unavailable (`aria-disabled`) controls stay
 * reachable so their reason can be read.
 */
export function createRovingToolbar(root: () => HTMLElement | undefined): void {
  let current: HTMLElement | null = null;

  const owned = (element: HTMLElement, toolbar: HTMLElement) =>
    element.closest('[role="toolbar"]') === toolbar && !element.closest('[role="menu"]');

  const items = (toolbar: HTMLElement) =>
    Array.from(toolbar.querySelectorAll<HTMLElement>(ITEMS)).filter(
      (element) =>
        owned(element, toolbar) &&
        !(element as HTMLButtonElement).disabled &&
        element.getClientRects().length > 0
    );

  const sync = () => {
    const toolbar = root();
    if (!toolbar) return;
    const available = items(toolbar);
    if (!current || !available.includes(current)) current = available[0] ?? null;
    for (const element of toolbar.querySelectorAll<HTMLElement>(ITEMS)) {
      if (!owned(element, toolbar)) continue;
      const tabIndex = element === current ? 0 : -1;
      if (element.tabIndex !== tabIndex) element.tabIndex = tabIndex;
    }
  };

  onMount(() => {
    const toolbar = root();
    if (!toolbar) return;

    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.matches(ITEMS) && owned(target, toolbar)) {
        current = target;
        sync();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (!(target instanceof HTMLElement) || !owned(target, toolbar)) return;
      // Inside an open overflow list, the vertical arrows also move.
      const vertical = !!target.closest(".editor-overflow.is-open .editor-overflow-panel");
      const previous = PREVIOUS.has(event.key) || (vertical && event.key === "ArrowUp");
      const next = NEXT.has(event.key) || (vertical && event.key === "ArrowDown");
      if (!previous && !next && event.key !== "Home" && event.key !== "End") return;
      const available = items(toolbar);
      const index = available.indexOf(target);
      if (index < 0) return;
      event.preventDefault();
      const destination =
        event.key === "Home"
          ? available[0]
          : event.key === "End"
            ? available[available.length - 1]
            : available[(index + (next ? 1 : -1) + available.length) % available.length];
      destination?.focus();
    };

    const observer = new MutationObserver(sync);
    observer.observe(toolbar, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["disabled", "class", "hidden", "style"],
    });
    toolbar.addEventListener("focusin", handleFocusIn);
    toolbar.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", sync);
    sync();
    onCleanup(() => {
      observer.disconnect();
      toolbar.removeEventListener("focusin", handleFocusIn);
      toolbar.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", sync);
    });
  });
}
