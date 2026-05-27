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
    backdrop.className = "fixed inset-0 bg-black/50 z-50 flex items-center justify-center";

    // Modal panel
    const modal = document.createElement("div");
    modal.className = "bg-white p-8 min-w-[320px] max-w-[420px] w-[90%] font-display";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "password-modal-title");

    // Title
    const title = document.createElement("div");
    title.id = "password-modal-title";
    title.textContent = PASSWORD_MODAL_TITLE;
    title.className = "text-2xl tracking-[0.05em] text-primary mb-1.5";

    // File name
    const fileLabel = document.createElement("div");
    fileLabel.textContent = fileName;
    fileLabel.className =
      "text-[11px] tracking-[0.1em] uppercase text-muted mb-4 font-mono whitespace-nowrap overflow-hidden text-ellipsis";

    // Error message (only when retrying)
    const errorMsg = document.createElement("div");
    errorMsg.textContent = "Incorrect password. Try again.";
    errorMsg.setAttribute("aria-live", "polite");
    errorMsg.className = `text-accent text-xs tracking-[0.05em] mb-3 font-mono${isRetry ? "" : " hidden"}`;

    // Password input
    const input = document.createElement("input");
    input.type = "password";
    input.placeholder = "Enter password";
    input.setAttribute("aria-label", "PDF password");
    input.autocomplete = "current-password";
    input.className =
      "w-full box-border px-3 py-2.5 border border-border outline-none text-sm font-mono mb-5 focus:border-primary";

    // Button row
    const buttonRow = document.createElement("div");
    buttonRow.className = "flex gap-3 justify-end";

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.className =
      "py-2 px-5 border border-primary bg-white text-primary cursor-pointer font-display text-sm tracking-[0.05em] focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2";

    const unlockBtn = document.createElement("button");
    unlockBtn.textContent = "Unlock";
    unlockBtn.className =
      "py-2 px-5 border border-primary bg-primary text-white cursor-pointer font-display text-sm tracking-[0.05em] focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2";

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
