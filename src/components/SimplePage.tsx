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
    <main class="min-h-screen bg-bg px-6 py-10 text-text-primary">
      <div class="mx-auto max-w-[680px]">
        <a href="/" class="text-md font-medium text-text-primary">
          interleaf
        </a>
        <div class="mt-8 rounded-lg border border-border bg-surface p-6 shadow-sm">
          <a
            href="/"
            class="text-sm text-text-secondary underline underline-offset-4"
          >
            ← Back to app
          </a>
          <h1 class="mt-4 text-lg font-medium">{props.title}</h1>
          <nav class="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm text-text-secondary">
            <For each={pageLinks}>
              {(link) => (
                <a href={link.href} class="underline underline-offset-4">
                  {link.label}
                </a>
              )}
            </For>
          </nav>
          <div class="mt-4 space-y-4 text-sm leading-relaxed text-text-secondary">
            {props.children}
          </div>
        </div>
      </div>
    </main>
  );
}
