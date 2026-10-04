import { fireEvent, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
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
      expect(error).not.toHaveClass("is-hidden");
    } else {
      expect(error).toHaveClass("is-hidden");
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
});
