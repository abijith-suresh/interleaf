const pageLinks = [
  { href: "/about/", label: "About" },
  { href: "/features/", label: "Features" },
  { href: "/privacy/", label: "Privacy" },
  { href: "/changelog/", label: "Changelog" },
  { href: "/keyboard-shortcuts/", label: "Shortcuts" },
];

export default function SiteFooter() {
  const pathname =
    typeof window !== "undefined" ? window.location.pathname : "";

  return (
    <div class="mx-auto max-w-[680px]">
      {/* Single row: wordmark left, links right */}
      <div class="flex flex-col gap-5 sm:flex-row sm:items-baseline sm:justify-between">
        <a
          href="/"
          class="shrink-0 font-serif italic text-md font-normal text-text-primary"
        >
          interleaf
        </a>

        <nav class="flex flex-wrap items-baseline gap-x-5 gap-y-2">
          {pageLinks.map((link) => {
            const isActive =
              pathname === link.href || pathname === link.href.slice(0, -1);
            return isActive ? (
              <span class="font-sans text-sm font-medium text-text-primary">
                {link.label}
              </span>
            ) : (
              <a
                href={link.href}
                class="link-underline font-sans text-sm text-text-secondary"
              >
                {link.label}
              </a>
            );
          })}
          <a
            href="https://github.com/abijith-suresh/interleaf"
            target="_blank"
            rel="noopener noreferrer"
            class="link-underline font-sans text-sm text-text-secondary"
          >
            GitHub ↗
          </a>
        </nav>
      </div>

      <p class="mt-5 font-sans text-xs text-text-tertiary">
        Built with care · No accounts · No tracking · No cloud
      </p>
    </div>
  );
}
