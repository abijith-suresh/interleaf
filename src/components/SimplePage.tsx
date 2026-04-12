import { For, type JSX } from "solid-js";

type SimplePageProps = {
  title: string;
  children: JSX.Element;
};

const pageLinks = [
  { href: "/about/", label: "About" },
  { href: "/features/", label: "Features" },
  { href: "/privacy/", label: "Privacy" },
  { href: "/changelog/", label: "Changelog" },
  { href: "/keyboard-shortcuts/", label: "Keyboard Shortcuts" },
];

export default function SimplePage(props: SimplePageProps) {
  return (
    <main class="min-h-screen bg-bg px-8 py-16 text-text-primary">
      <div class="mx-auto max-w-[680px]">
        <a href="/" class="text-md font-medium text-text-primary">
          interleaf
        </a>
        <a
          href="/"
          class="mt-8 block text-[13px] text-tertiary hover:text-accent"
        >
          ← Back to app
        </a>
        <h1 class="mb-8 mt-4 font-serif text-lg font-normal">{props.title}</h1>
        <nav class="mb-8 flex flex-wrap gap-x-4 gap-y-2 text-[13px] text-tertiary">
          <For each={pageLinks}>
            {(link) => (
              <a href={link.href} class="hover:text-accent">
                {link.label}
              </a>
            )}
          </For>
        </nav>
        <div class="space-y-4 font-serif text-md font-light leading-relaxed text-text-primary">
          {props.children}
        </div>
      </div>
    </main>
  );
}
