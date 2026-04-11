import { Show } from "solid-js";

import { appMeta } from "@/utils/meta";

type AboutOverlayProps = {
  open: boolean;
  onClose: () => void;
};

const links = [
  { href: "/about", label: "About" },
  { href: "/features", label: "Features" },
  { href: "/privacy", label: "Privacy" },
  { href: "/changelog", label: "Changelog" }
];

export default function AboutOverlay(props: AboutOverlayProps) {
  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-30 flex items-center justify-center px-4">
        <div class="w-full max-w-[420px] rounded-lg border border-border bg-surface p-5 shadow-lg">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h2 class="text-base font-medium text-text-primary">About brev</h2>
              <p class="mt-1 text-sm text-text-secondary">Version {appMeta.version}</p>
            </div>

            <button
              type="button"
              aria-label="Close about"
              class="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover hover:text-text-primary"
              onClick={() => props.onClose()}
            >
              x
            </button>
          </div>

          <p class="mt-4 text-sm leading-relaxed text-text-secondary">
            brev is a local-first notes app for quick writing, tabbed note switching, and simple export without accounts or sync.
          </p>

          <div class="mt-5 grid grid-cols-2 gap-2 text-sm">
            {links.map((link) => (
              <a
                href={link.href}
                class="rounded-md border border-border px-3 py-2 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </Show>
  );
}
