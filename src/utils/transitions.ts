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

// Evaluated at build time, so reduced motion cannot be read here. The
// `prefers-reduced-motion` rule in global.css disables these at use time.
export const contentSlide = {
  forwards: animationPair,
  backwards: animationPair,
};
