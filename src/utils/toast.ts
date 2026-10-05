export type ToastType = "success" | "error" | "info";

export interface ToastDetail {
  message: string;
  type: ToastType;
}

export const TOAST_EVENT_NAME = "interleaf:toast";

export function showToast(message: string, type: ToastType): void {
  document.dispatchEvent(
    new CustomEvent<ToastDetail>(TOAST_EVENT_NAME, {
      detail: { message, type },
    })
  );
}
