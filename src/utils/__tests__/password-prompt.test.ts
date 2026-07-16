import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("password-prompt utility", () => {
  let promptForPassword: typeof import("../password-prompt").promptForPassword;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await import("../password-prompt");
    promptForPassword = module.promptForPassword;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("should return a promise", () => {
    const result = promptForPassword("test.pdf", false);
    expect(result).toBeInstanceOf(Promise);
    result.then(() => {}).catch(() => {});
  });

  it("should show error message when isRetry is true", async () => {
    const promise = promptForPassword("test.pdf", true);

    const errorMsg = document.querySelector('[aria-live="polite"]');
    expect(errorMsg).not.toBeNull();
    expect(errorMsg?.textContent).toContain("Incorrect password");

    const cancelBtn = document.querySelector("button");
    if (cancelBtn) {
      cancelBtn.click();
    }

    await promise;
  });

  it("should resolve with entered password on submit", async () => {
    const promise = promptForPassword("test.pdf", false);

    const input = document.querySelector('input[type="password"]') as HTMLInputElement;
    const unlockBtn = document.querySelectorAll("button")[1];

    if (input && unlockBtn) {
      input.value = "mypassword";
      unlockBtn.click();
    }

    const result = await promise;
    expect(result).toBe("mypassword");
  });

  it("should resolve to null when cancel button is clicked", async () => {
    const promise = promptForPassword("test.pdf", false);

    const cancelBtn = document.querySelector("button");

    if (cancelBtn) {
      cancelBtn.click();
    }

    const result = await promise;
    expect(result).toBeNull();
  });

  it("should submit on Enter key", async () => {
    const promise = promptForPassword("test.pdf", false);

    const input = document.querySelector('input[type="password"]') as HTMLInputElement;

    if (input) {
      input.value = "enterpassword";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    }

    const result = await promise;
    expect(result).toBe("enterpassword");
  });
});
