import { PASSWORD_MODAL_TITLE } from "../constants";

/**
 * Shows a modal prompting the user for a PDF password.
 * @param fileName - The name of the PDF file requiring a password.
 * @param isRetry - If true, shows an "Incorrect password" message.
 * @returns The entered password string, or null if the user cancelled.
 */
export function promptForPassword(fileName: string, isRetry: boolean): Promise<string | null> {
  return new Promise((resolve) => {
    // Store the element that triggered the modal so focus can be restored on close
    const triggerElement = document.activeElement as HTMLElement | null;

    // Backdrop
    const backdrop = document.createElement("div");
    backdrop.className = "password-modal-backdrop";

    // Modal panel
    const modal = document.createElement("div");
    modal.className = "password-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "password-modal-title");

    // Title
    const title = document.createElement("h2");
    title.id = "password-modal-title";
    title.textContent = PASSWORD_MODAL_TITLE;
    title.className = "password-modal-title";

    // File name
    const fileLabel = document.createElement("div");
    fileLabel.textContent = fileName;
    fileLabel.className = "password-modal-file";

    // Error message (only when retrying)
    const errorMsg = document.createElement("div");
    errorMsg.textContent = "Incorrect password. Try again.";
    errorMsg.setAttribute("aria-live", "polite");
    errorMsg.className = `password-modal-error${isRetry ? "" : " is-hidden"}`;

    // Password input
    const input = document.createElement("input");
    input.type = "password";
    input.placeholder = "Enter password…";
    input.setAttribute("aria-label", "PDF password");
    input.name = "pdf-password";
    input.autocomplete = "off";
    input.className = "password-modal-input";

    // Button row
    const buttonRow = document.createElement("div");
    buttonRow.className = "password-modal-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.className = "password-modal-button password-modal-button-secondary";

    const unlockBtn = document.createElement("button");
    unlockBtn.textContent = "Unlock";
    unlockBtn.className = "password-modal-button password-modal-button-primary";

    buttonRow.appendChild(cancelBtn);
    buttonRow.appendChild(unlockBtn);

    modal.appendChild(title);
    modal.appendChild(fileLabel);
    modal.appendChild(errorMsg);
    modal.appendChild(input);
    modal.appendChild(buttonRow);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    // Focus the input after mounting
    requestAnimationFrame(() => input.focus());

    const cleanup = () => {
      document.body.removeChild(backdrop);
      triggerElement?.focus();
    };

    const submit = () => {
      cleanup();
      resolve(input.value);
    };

    const cancel = () => {
      cleanup();
      resolve(null);
    };

    unlockBtn.addEventListener("click", submit);
    cancelBtn.addEventListener("click", cancel);

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });

    // Focus trap: Tab/Shift+Tab cycles within [input, cancelBtn, unlockBtn]
    // Escape closes the modal from anywhere in the backdrop
    const focusable = [input, cancelBtn, unlockBtn];
    backdrop.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        cancel();
        return;
      }
      if (e.key === "Tab") {
        const currentIndex = focusable.indexOf(
          document.activeElement as HTMLInputElement | HTMLButtonElement
        );
        e.preventDefault();
        if (e.shiftKey) {
          const prevIndex = currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1;
          focusable[prevIndex].focus();
        } else {
          const nextIndex = currentIndex >= focusable.length - 1 ? 0 : currentIndex + 1;
          focusable[nextIndex].focus();
        }
      }
    });

    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) cancel();
    });
  });
}
