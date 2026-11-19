import { fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { confirmLeave } from "../leave-prompt";

describe("confirmLeave", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("names the dialog, describes it, and focuses Cancel first", () => {
    void confirmLeave();
    const dialog = screen.getByRole("dialog", { name: "Leave the editor?" });
    expect(dialog).toHaveAccessibleDescription("Your pages aren't saved anywhere.");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("resolves true only for Leave", async () => {
    const result = confirmLeave();
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    await expect(result).resolves.toBe(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("stays on Cancel, Escape, and the backdrop, and returns focus to the trigger", async () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    for (const dismiss of [
      () => fireEvent.click(screen.getByRole("button", { name: "Cancel" })),
      () => fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true })),
      () => fireEvent.click(screen.getByRole("dialog")),
    ]) {
      trigger.focus();
      const result = confirmLeave();
      dismiss();
      await expect(result).resolves.toBe(false);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    }
  });
});
