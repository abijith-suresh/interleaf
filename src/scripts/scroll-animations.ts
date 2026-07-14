function initScrollAnimations() {
  const elements = document.querySelectorAll(".animate-on-scroll:not(.is-visible)");

  if (elements.length === 0) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.1,
      rootMargin: "0px 0px -40px 0px",
    }
  );

  for (const el of elements) observer.observe(el);
}

// Run on initial load
initScrollAnimations();

// Run on View Transition page loads
document.addEventListener("astro:page-load", initScrollAnimations);
