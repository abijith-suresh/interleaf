const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(", ");

export function getFocusableElements(container: HTMLElement | undefined) {
  if (!container) {
    return [];
  }

  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    return !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true";
  });
}

export function focusFirstDescendant(container: HTMLElement | undefined) {
  const [firstElement] = getFocusableElements(container);
  firstElement?.focus();
}

export function trapFocus(container: HTMLElement | undefined, event: KeyboardEvent) {
  if (!container || event.key !== "Tab") {
    return false;
  }

  const focusableElements = getFocusableElements(container);

  if (focusableElements.length === 0) {
    return false;
  }

  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];
  const activeElement = document.activeElement;

  if (!(activeElement instanceof HTMLElement) || !container.contains(activeElement)) {
    event.preventDefault();
    firstElement?.focus();
    return true;
  }

  if (event.shiftKey && activeElement === firstElement) {
    event.preventDefault();
    lastElement?.focus();
    return true;
  }

  if (!event.shiftKey && activeElement === lastElement) {
    event.preventDefault();
    firstElement?.focus();
    return true;
  }

  return false;
}
