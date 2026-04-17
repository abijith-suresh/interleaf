import type { JSX } from "solid-js";
import { HiOutlineSun, HiOutlineMoon } from "solid-icons/hi";
import SiteFooter from "./SiteFooter";
import { toggleTheme, useUi } from "@/stores/ui";

type SimplePageProps = {
  title: string;
  children: JSX.Element;
};

export default function SimplePage(props: SimplePageProps) {
  const ui = useUi();

  return (
    <div class="flex min-h-screen flex-col bg-bg text-text-primary">
      {/* Header bar */}
      <header class="relative flex h-10 shrink-0 items-center border-b border-border bg-surface px-4">
        {/* Left: back to app */}
        <a
          href="/"
          class="back-arrow flex items-center gap-1 text-[13px] text-text-secondary transition-colors duration-150 hover:text-accent"
        >
          <span class="back-arrow-icon">←</span>
          <span>App</span>
        </a>

        {/* Center: wordmark */}
        <div class="absolute left-1/2 -translate-x-1/2">
          <a
            href="/"
            class="font-serif text-lg italic font-normal text-text-primary"
          >
            interleaf
          </a>
        </div>

        {/* Right: theme toggle */}
        <div class="ml-auto flex items-center">
          <button
            type="button"
            aria-label={`Switch to ${ui.theme === "light" ? "dark" : "light"} theme`}
            class="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition-all duration-150 hover:text-text-primary active:scale-95"
            onClick={() => toggleTheme()}
          >
            {ui.theme === "light" ? (
              <span class="animate-icon-in inline-flex">
                <HiOutlineMoon size={16} />
              </span>
            ) : (
              <span class="animate-icon-in inline-flex">
                <HiOutlineSun size={16} />
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Page title */}
      <div class="animate-page-title border-b border-border px-6 pb-8 pt-10 sm:px-10 sm:pb-10 sm:pt-12">
        <h1 class="mx-auto max-w-[680px] font-serif text-2xl font-normal leading-tight text-text-primary">
          {props.title}
        </h1>
      </div>

      {/* Content */}
      <div class="animate-page-content flex-1 px-6 py-10 sm:px-10">
        <div class="mx-auto max-w-[680px] font-serif text-md font-light leading-relaxed text-text-primary">
          {props.children}
        </div>
      </div>

      {/* Footer */}
      <div class="animate-page-footer border-t border-border bg-surface px-6 py-10 sm:px-10">
        <SiteFooter />
      </div>
    </div>
  );
}
