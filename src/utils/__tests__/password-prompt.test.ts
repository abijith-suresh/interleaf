import { fireEvent, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { promptForPassword } from "../password-prompt";

describe("promptForPassword", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it.each([false, true])("shows the retry error only when isRetry=%s", async (isRetry) => {
    const result = promptForPassword("protected.pdf", isRetry);
    const dialog = screen.getByRole("dialog", { name: "Password required" });
    const error = within(dialog).getByText("Incorrect password. Try again.");

    expect(within(dialog).getByText("protected.pdf")).toBeInTheDocument();
    if (isRetry) {
      expect(screen.getByLabelText("PDF password")).toHaveAccessibleDescription(error.textContent!);
    } else {
      expect(screen.getByLabelText("PDF password")).not.toHaveAttribute("aria-describedby");
    }

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await expect(result).resolves.toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each(["Unlock", "Enter"])(
    "returns the password through %s and removes the dialog",
    async (action) => {
      const result = promptForPassword("protected.pdf", false);
      const input = screen.getByLabelText<HTMLInputElement>("PDF password");
      fireEvent.input(input, { target: { value: "mypassword" } });

      if (action === "Unlock") {
        fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
      } else {
        fireEvent.keyDown(input, { key: "Enter" });
      }

      await expect(result).resolves.toBe("mypassword");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    }
  );

  it("associates the retry error with the input and announces it", async () => {
    const result = promptForPassword("protected.pdf", true);
    const input = screen.getByLabelText("PDF password");
    const error = screen.getByText("Incorrect password. Try again.");

    expect(error).toHaveAttribute("role", "alert");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Incorrect password. Try again.");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await result;
  });

  it("does not flag the input on the first attempt", async () => {
    const result = promptForPassword("protected.pdf", false);
    const input = screen.getByLabelText("PDF password");

    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
    expect(screen.getByText("Incorrect password. Try again.")).not.toHaveAttribute("role");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await result;
  });

  it("is a native dialog that cancels on Escape and clears the typed password", async () => {
    const result = promptForPassword("protected.pdf", false);
    const dialog = screen.getByRole("dialog", { name: "Password required" });
    const input = screen.getByLabelText<HTMLInputElement>("PDF password");
    expect(dialog.tagName).toBe("DIALOG");
    fireEvent.input(input, { target: { value: "secret" } });

    fireEvent.keyDown(dialog, { key: "Escape" });

    await expect(result).resolves.toBeNull();
    expect(input.value).toBe("");
  });

  it("does not focus a trigger that left the document", async () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const result = promptForPassword("protected.pdf", false);
    const focus = vi.spyOn(trigger, "focus");
    trigger.remove();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await result;
    expect(focus).not.toHaveBeenCalled();
  });

  it("closes an interrupted prompt and restores focus", async () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const controller = new AbortController();
    const result = promptForPassword("protected.pdf", false, controller.signal);
    screen.getByLabelText("PDF password").focus();

    controller.abort();

    await expect(result).resolves.toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("does not open a prompt for an already interrupted operation", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(promptForPassword("protected.pdf", false, controller.signal)).resolves.toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
