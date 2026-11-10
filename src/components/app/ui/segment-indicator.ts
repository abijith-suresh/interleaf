export function attachSegmentIndicator(container: HTMLElement, indicator: HTMLElement): () => void {
  const buttons = container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]");
  const update = () => {
    const pressed = container.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
    indicator.toggleAttribute("data-hidden", !pressed);
    if (!pressed) return;
    const bounds = pressed.getBoundingClientRect();
    const parent = container.getBoundingClientRect();
    indicator.style.setProperty(
      "--segment-x",
      `${bounds.left - parent.left - container.clientLeft + container.scrollLeft}px`
    );
    indicator.style.setProperty("--segment-w", `${bounds.width}px`);
    if (!indicator.hasAttribute("data-ready")) {
      // Commit the first placement before enabling transitions.
      indicator.getBoundingClientRect();
      indicator.setAttribute("data-ready", "");
    }
  };
  const mutations = new MutationObserver(update);
  mutations.observe(container, {
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-pressed"],
  });
  const resizes = new ResizeObserver(update);
  resizes.observe(container);
  for (const button of buttons) resizes.observe(button);
  update();
  return () => {
    mutations.disconnect();
    resizes.disconnect();
  };
}
