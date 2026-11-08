import { PASSWORD_MODAL_TITLE } from "../constants";

export function promptForPassword(
  fileName: string,
  isRetry: boolean,
  signal?: AbortSignal
): Promise<string | null> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(null);
      return;
    }
    // Store the element that triggered the modal so focus can be restored on close
    const triggerElement = document.activeElement as HTMLElement | null;

    // Native modal <dialog>: makes the rest of the page inert and traps focus.
    // It doubles as the backdrop so clicks outside the panel cancel.
    const backdrop = document.createElement("dialog");
    backdrop.className = "password-modal-backdrop";
    backdrop.setAttribute("aria-labelledby", "password-modal-title");

    const modal = document.createElement("div");
    modal.className = "password-modal";

    const title = document.createElement("h2");
    title.id = "password-modal-title";
    title.textContent = PASSWORD_MODAL_TITLE;
    title.className = "password-modal-title";

    const fileLabel = document.createElement("div");
    fileLabel.textContent = fileName;
    fileLabel.className = "password-modal-file";

    const errorMsg = document.createElement("div");
    errorMsg.id = "password-modal-error";
    errorMsg.textContent = "Incorrect password. Try again.";
    if (isRetry) errorMsg.setAttribute("role", "alert");
    errorMsg.className = `password-modal-error${isRetry ? "" : " is-hidden"}`;

    const input = document.createElement("input");
    input.type = "password";
    input.placeholder = "Enter password…";
    input.setAttribute("aria-label", "PDF password");
    input.name = "pdf-password";
    input.autocomplete = "off";
    input.className = "password-modal-input";
    if (isRetry) {
      input.setAttribute("aria-invalid", "true");
      input.setAttribute("aria-describedby", errorMsg.id);
    }

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
    if (typeof backdrop.showModal === "function") {
      backdrop.showModal();
    } else {
      backdrop.setAttribute("open", "");
    }

    const focusFrame = requestAnimationFrame(() => input.focus());

    const finish = (password: string | null) => {
      if (!backdrop.isConnected) return;
      cancelAnimationFrame(focusFrame);
      signal?.removeEventListener("abort", cancel);
      input.value = "";
      if (typeof backdrop.close === "function" && backdrop.open) {
        backdrop.close();
      }
      backdrop.remove();
      if (triggerElement?.isConnected) triggerElement.focus();
      resolve(password);
    };

    const submit = () => {
      finish(input.value);
    };

    const cancel = () => {
      finish(null);
    };

    signal?.addEventListener("abort", cancel, { once: true });

    unlockBtn.addEventListener("click", submit);
    cancelBtn.addEventListener("click", cancel);

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });

    // Escape fires the native cancel event on a modal dialog.
    backdrop.addEventListener("cancel", (e) => {
      e.preventDefault();
      cancel();
    });
    backdrop.addEventListener("keydown", (e) => {
      if (e.key === "Escape") cancel();
    });

    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) cancel();
    });
  });
}
