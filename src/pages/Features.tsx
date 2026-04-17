import SimplePage from "@/components/SimplePage";

const features = [
  {
    heading: "Local-first note storage",
    body: "Notes are stored in your browser using IndexedDB. Nothing is sent to a server. Your data stays on your device, under your control, available even when you're offline.",
  },
  {
    heading: "Fast note switching",
    body: "A sidebar groups notes by day so you can find what you wrote this morning — or last week — without scrolling through an endless list. Tabs let you keep a few notes open and flip between them instantly.",
  },
  {
    heading: "Keyboard-first workflow",
    body: "Create notes, search, format text, switch tabs, and export — all from the keyboard. Shortcuts use combinations that work reliably in the browser, so muscle memory transfers across sessions.",
  },
  {
    heading: "Offline-capable PWA",
    body: "Install interleaf as a standalone app on your device. It loads without a network connection and runs in its own window, separate from your browser tabs. Like a native app, without the app store.",
  },
];

export default function Features() {
  return (
    <SimplePage title="Features">
      <p class="mb-8 text-text-secondary">
        interleaf is designed around a small set of opinions. Each feature
        exists to make writing and managing short-lived notes faster and calmer.
      </p>

      <div class="divide-y divide-border">
        {features.map((feature, i) => (
          <section class="group rounded-md py-7 transition-colors duration-200 hover:bg-surface-hover first:pt-0 last:pb-0">
            <div class="mb-3 flex items-baseline gap-3">
              <span class="font-mono text-[11px] text-text-tertiary">
                0{i + 1}
              </span>
              <h2 class="font-sans text-[11px] font-medium uppercase tracking-[0.12em] text-text-tertiary">
                {feature.heading}
              </h2>
            </div>
            <p class="text-text-primary">{feature.body}</p>
          </section>
        ))}
      </div>
    </SimplePage>
  );
}
