import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import EditorButton from "../ui/EditorButton";

describe("EditorButton", () => {
  it("keeps native refs, menu events and reactive caller classes through state changes", () => {
    const [marked, setMarked] = createSignal(false);
    const onKeyDown = vi.fn();
    let button: HTMLButtonElement | undefined;
    render(() => (
      <EditorButton
        ref={button}
        class={marked() ? "restore-page" : "mark-page"}
        classList={{ "is-marked": marked() }}
        icon={marked() ? "restore" : "delete"}
        aria-pressed={marked()}
        aria-disabled={marked()}
        role="menuitem"
        tabindex="-1"
        onKeyDown={onKeyDown}
        onClick={() => setMarked(!marked())}
      >
        {marked() ? "Restore page" : "Mark page"}
      </EditorButton>
    ));

    expect(button).toBe(screen.getByRole("menuitem", { name: "Mark page" }));
    if (!button) throw new Error("Button ref was not assigned");
    button.focus();
    expect(button).toHaveFocus();
    fireEvent.keyDown(button, { key: "Escape" });
    expect(onKeyDown).toHaveBeenCalledOnce();
    fireEvent.click(button);
    expect(button).toHaveClass("editor-button", "restore-page", "is-marked");
    expect(button).not.toHaveClass("mark-page");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    expect(button).toHaveAccessibleName("Restore page");
    expect(button?.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(button);
    expect(button).toHaveClass("editor-button", "mark-page");
    expect(button).not.toHaveClass("is-marked", "restore-page");
  });
});
