import { fireEvent, render, screen, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EditorToolRail, { type EditorWorkspaceTool } from "../EditorToolRail";

function viewport(compact: boolean) {
  const query = new EventTarget();
  Object.assign(query, { matches: compact, media: "(max-width: 700px)" });
  vi.spyOn(window, "matchMedia").mockReturnValue(query as MediaQueryList);
  return (matches: boolean) => {
    Object.assign(query, { matches });
    query.dispatchEvent(new Event("change"));
  };
}

describe("EditorToolRail", () => {
  beforeEach(() => {
    // jsdom lacks native modal methods. Real focus containment is checked in browser smoke.
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: vi.fn(function (this: HTMLDialogElement) {
        this.open = true;
      }),
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value: vi.fn(function (this: HTMLDialogElement) {
        this.open = false;
      }),
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  });

  it("separates desktop workspace views from all three PDF tools", () => {
    viewport(false);
    const choose = vi.fn();
    render(() => <EditorToolRail activeTool="pages" onChooseTool={choose} />);
    const views = screen.getByRole("navigation", { name: "Workspace views" });
    expect(
      within(views)
        .getAllByRole("button")
        .map((button) => button.textContent)
    ).toEqual(["Pages", "Document"]);
    const actions = screen.getByRole("group", { name: "PDF tools" });
    expect(within(actions).getAllByRole("button")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Tools" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Document" }));
    expect(choose).toHaveBeenCalledWith("read");
  });

  it.each(["pages", "read", "add", "replace", "forms"] as const)(
    "keeps the same three mobile destinations in %s mode",
    (activeTool) => {
      viewport(true);
      render(() => <EditorToolRail activeTool={activeTool} onChooseTool={vi.fn()} />);
      const buttons = screen.getAllByRole("button");
      expect(buttons).toHaveLength(3);
      expect(buttons.map((button) => button.querySelector("span")?.textContent)).toEqual([
        "Pages",
        "Document",
        "Tools",
      ]);
      const current = screen.getByRole("button", {
        name: activeTool === "pages" ? "Pages" : "Document",
      });
      expect(current).toHaveAttribute("aria-current", "page");
      expect(screen.queryByRole("button", { name: "Add text" })).not.toBeInTheDocument();
    }
  );

  it("uses a native modal, handles Escape without closing its viewer, and restores trigger focus", async () => {
    const changeViewport = viewport(true);
    const viewerClose = vi.fn();
    const [active, setActive] = createSignal<EditorWorkspaceTool>("read");
    render(() => (
      <div
        role="dialog"
        aria-label="Document viewer"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") viewerClose();
        }}
      >
        <EditorToolRail activeTool={active()} onChooseTool={setActive} />
      </div>
    ));
    const trigger = screen.getByRole("button", { name: "Tools" });
    trigger.focus();
    fireEvent.click(trigger);
    const modal = screen.getByRole("dialog", { name: "PDF tools" });
    expect(modal).toBeInstanceOf(HTMLDialogElement);
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(
      within(modal)
        .getAllByRole("button")
        .map(
          (button) =>
            button.getAttribute("aria-label") ?? button.querySelector("strong")?.textContent
        )
    ).toEqual(["Close tools", "Add text", "Edit text", "Fill forms"]);
    within(modal)
      .getByRole("button", { name: /^Add text/ })
      .focus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "PDF tools" })).not.toBeInTheDocument();
    expect(viewerClose).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: /^Fill forms/ }));
    expect(screen.getByRole("button", { name: "Document" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    changeViewport(false);
    expect(screen.queryByRole("dialog", { name: "PDF tools" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fill forms" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await Promise.resolve();
    expect(screen.getByRole("button", { name: "Fill forms" })).toHaveFocus();
    changeViewport(true);
    await Promise.resolve();
    expect(screen.getByRole("button", { name: /^Tools/ })).toHaveFocus();
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalledTimes(3);
  });
});
