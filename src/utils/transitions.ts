const animationPair = {
  old: [
    {
      name: "pageFadeOut",
      duration: "0.18s",
      easing: "ease-in",
      fillMode: "forwards",
    },
  ],
  new: [
    {
      name: "pageFadeIn",
      duration: "0.32s",
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      fillMode: "backwards",
      delay: "0.05s",
    },
  ],
};

export const pageTransition = {
  forwards: animationPair,
  backwards: animationPair,
};
