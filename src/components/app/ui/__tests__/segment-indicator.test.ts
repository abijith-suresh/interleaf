import { afterEach, expect, it, vi } from "vitest";
import { attachSegmentIndicator } from "../segment-indicator";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it("tracks the pressed segment, resizing, hidden state, and observer cleanup", async () => {
  let resize = () => {};
  const disconnect = vi.fn();
  const observe = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe = observe;
      disconnect = disconnect;
    }
  );
  const mutationDisconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
  const container = document.createElement("div");
  container.innerHTML =
    '<span></span><button aria-pressed="true"></button><button aria-pressed="false"></button>';
  document.body.append(container);
  const indicator = container.querySelector("span");
  if (!indicator) throw new Error("Missing indicator");
  const buttons = container.querySelectorAll("button");
  const rect = (left: number, width: number) => ({ left, width }) as DOMRect;
  container.getBoundingClientRect = () => rect(100, 200);
  Object.defineProperty(container, "clientLeft", { value: 2 });
  buttons[0].getBoundingClientRect = () => rect(106, 70);
  buttons[1].getBoundingClientRect = () => rect(180, 110);
  const cleanup = attachSegmentIndicator(container, indicator);
  expect(indicator.style.getPropertyValue("--segment-x")).toBe("4px");
  expect(indicator.style.getPropertyValue("--segment-w")).toBe("70px");
  expect(indicator.hasAttribute("data-ready")).toBe(true);
  expect(observe.mock.calls.map(([element]) => element)).toEqual([container, ...buttons]);
  buttons[0].setAttribute("aria-pressed", "false");
  buttons[1].setAttribute("aria-pressed", "true");
  await Promise.resolve();
  expect(indicator.style.getPropertyValue("--segment-x")).toBe("78px");
  expect(indicator.style.getPropertyValue("--segment-w")).toBe("110px");
  buttons[1].getBoundingClientRect = () => rect(190, 120);
  resize();
  expect(indicator.style.getPropertyValue("--segment-x")).toBe("88px");
  expect(indicator.style.getPropertyValue("--segment-w")).toBe("120px");
  buttons[1].setAttribute("aria-pressed", "false");
  await Promise.resolve();
  expect(indicator.hasAttribute("data-hidden")).toBe(true);
  buttons[0].setAttribute("aria-pressed", "true");
  await Promise.resolve();
  expect(indicator.hasAttribute("data-hidden")).toBe(false);
  cleanup();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(mutationDisconnect).toHaveBeenCalledOnce();
  mutationDisconnect.mockRestore();
});
