export const LEAVE_EDITOR_TITLE = "Leave the editor?";
export const LEAVE_EDITOR_DETAIL = "Your pages aren't saved anywhere.";

/**
 * Asks in the page, in the password dialog's modal pattern, whether to leave
 * the editor. Resolves true to leave. Escape, Cancel and the backdrop stay.
 */
export function confirmLeave(): Promise<boolean> {
  return new Promise((resolve) => {
    const trigger = document.activeElement as HTMLElement | null;

    const backdrop = document.createElement("dialog");
    backdrop.className = "password-modal-backdrop";
    backdrop.setAttribute("aria-labelledby", "leave-modal-title");
    backdrop.setAttribute("aria-describedby", "leave-modal-detail");

    const modal = document.createElement("div");
    modal.className = "password-modal";

    const title = document.createElement("h2");
    title.id = "leave-modal-title";
    title.className = "password-modal-title";
    title.textContent = LEAVE_EDITOR_TITLE;

    const detail = document.createElement("div");
    detail.id = "leave-modal-detail";
    detail.className = "password-modal-file";
    detail.textContent = LEAVE_EDITOR_DETAIL;

    const actions = document.createElement("div");
    actions.className = "password-modal-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "editor-button editor-button-secondary";
    cancelBtn.textContent = "Cancel";

    const leaveBtn = document.createElement("button");
    leaveBtn.type = "button";
    leaveBtn.className = "editor-button editor-button-primary";
    leaveBtn.textContent = "Leave";

    actions.append(cancelBtn, leaveBtn);
    modal.append(title, detail, actions);
    backdrop.append(modal);
    document.body.append(backdrop);
    if (typeof backdrop.showModal === "function") backdrop.showModal();
    else backdrop.setAttribute("open", "");
    // Staying is the safe default, so it takes the first focus.
    cancelBtn.focus();

    const finish = (leave: boolean) => {
      if (!backdrop.isConnected) return;
      if (typeof backdrop.close === "function" && backdrop.open) backdrop.close();
      backdrop.remove();
      if (!leave && trigger?.isConnected) trigger.focus();
      resolve(leave);
    };

    leaveBtn.addEventListener("click", () => finish(true));
    cancelBtn.addEventListener("click", () => finish(false));
    // Escape fires the native cancel event on a modal dialog.
    backdrop.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(false);
    });
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) finish(false);
    });
  });
}
