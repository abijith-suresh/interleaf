import type { TransitionBeforePreparationEvent } from "astro:transitions/client";
import { confirmLeave } from "./leave-prompt";

/**
 * Leaves an Astro router navigation pending until the router supersedes it.
 * Calling preventDefault() alone makes the router fall back to a full page load.
 */
function hold(event: TransitionBeforePreparationEvent): void {
  event.loader = () =>
    new Promise<void>((resolve) => {
      event.signal.addEventListener(
        "abort",
        () => {
          event.preventDefault();
          resolve();
        },
        { once: true }
      );
    });
}

/**
 * Asks before the page unloads, or before the client router leaves it, while
 * `shouldAsk` holds. Tab close and reload can only show the browser's own
 * prompt. Router navigation asks in the page and resumes once confirmed.
 * Returns a function that removes the guard.
 */
export function guardLeave(
  shouldAsk: () => boolean,
  confirm: () => Promise<boolean> = confirmLeave
): () => void {
  let restoring = false;
  let leaving = false;
  let asking = false;
  // The client router numbers its history entries. Without a number, assume one step.
  const entry = (state: unknown) =>
    typeof (state as { index?: unknown } | null)?.index === "number"
      ? (state as { index: number }).index
      : undefined;
  const home = entry(history.state);

  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (leaving || !shouldAsk()) return;
    event.preventDefault();
    // Older browsers show the prompt only when returnValue is set.
    event.returnValue = "";
  };

  const beforePreparation = (event: Event) => {
    const navigation = event as TransitionBeforePreparationEvent;
    if (restoring) {
      restoring = false;
      // The return to this page's own history entry must not reload it.
      if (navigation.to.href === navigation.from.href) {
        hold(navigation);
        return;
      }
    }
    if (leaving || !shouldAsk()) return;
    hold(navigation);
    // Back and Forward have already moved the history entry. Return to this one.
    let step = 0;
    if (navigation.navigationType === "traverse") {
      restoring = true;
      const target = entry(history.state);
      step =
        home !== undefined && target !== undefined
          ? home - target
          : navigation.direction === "back"
            ? 1
            : -1;
      history.go(step);
    }
    if (asking) return;
    asking = true;
    void confirm().then((leave) => {
      asking = false;
      if (!leave) return;
      leaving = true;
      if (step) history.go(-step);
      else window.location.assign(navigation.to.href);
    });
  };

  window.addEventListener("beforeunload", beforeUnload);
  document.addEventListener("astro:before-preparation", beforePreparation);
  return () => {
    window.removeEventListener("beforeunload", beforeUnload);
    document.removeEventListener("astro:before-preparation", beforePreparation);
  };
}
