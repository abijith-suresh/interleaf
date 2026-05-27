const animationPair = {
  old: [
    {
      name: "contentFadeOut",
      duration: "0.15s",
      easing: "ease-in",
      fillMode: "forwards",
    },
  ],
  new: [
    {
      name: "contentFadeIn",
      duration: "0.3s",
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      fillMode: "backwards",
      delay: "0.05s",
    },
  ],
};

const prefersReducedMotion =
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const contentSlide = prefersReducedMotion
  ? undefined
  : {
      forwards: animationPair,
      backwards: animationPair,
    };
