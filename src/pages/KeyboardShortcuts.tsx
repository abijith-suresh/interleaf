import SimplePage from "@/components/SimplePage";

const categories = [
  {
    heading: "Note management",
    shortcuts: [
      { keys: "Ctrl/Cmd + N", description: "Create a new note" },
      { keys: "Ctrl/Cmd + K", description: "Open search" },
      { keys: "Ctrl/Cmd + W", description: "Close the active tab" },
    ],
  },
  {
    heading: "Text formatting",
    shortcuts: [
      { keys: "Ctrl/Cmd + B", description: "Toggle bold on selected text" },
      { keys: "Ctrl/Cmd + I", description: "Toggle italic on selected text" },
      {
        keys: "Ctrl/Cmd + L",
        description: "Insert link (wraps selection as [text]())",
      },
    ],
  },
  {
    heading: "Navigation",
    shortcuts: [
      { keys: "Ctrl + PageDown", description: "Switch to the next open tab" },
      {
        keys: "Ctrl + PageUp",
        description: "Switch to the previous open tab",
      },
      { keys: "Alt + ]", description: "Switch to the next open tab" },
      { keys: "Alt + [", description: "Switch to the previous open tab" },
      { keys: "Escape", description: "Close search, menus, or dialogs" },
    ],
  },
];

export default function KeyboardShortcuts() {
  return (
    <SimplePage title="Keyboard Shortcuts">
      <p class="mb-8 text-text-secondary">
        interleaf keeps shortcuts focused on combinations that work reliably in
        the browser.
      </p>

      <div class="divide-y divide-border">
        {categories.map((category) => (
          <section class="py-7 first:pt-0 last:pb-0">
            <h2 class="mb-4 font-sans text-[11px] font-medium uppercase tracking-[0.12em] text-text-tertiary">
              {category.heading}
            </h2>
            <div class="divide-y divide-border-subtle">
              {category.shortcuts.map((shortcut) => (
                <div class="flex items-center gap-6 py-2.5 first:pt-0 last:pb-0">
                  <div class="w-[160px] shrink-0">
                    <kbd>{shortcut.keys}</kbd>
                  </div>
                  <span class="text-sm text-text-primary">
                    {shortcut.description}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div class="mt-8 space-y-3 border-t border-border pt-8 text-sm text-text-secondary">
        <p>
          <kbd>Ctrl+Tab</kbd> and <kbd>Ctrl+Shift+Tab</kbd> are intentionally
          not supported because browsers commonly reserve them for browser tab
          switching.
        </p>
        <p>
          Use <kbd>Ctrl+PageDown</kbd> and <kbd>Ctrl+PageUp</kbd>, or{" "}
          <kbd>Alt+[</kbd> and <kbd>Alt+]</kbd>, as the in-app alternatives.
        </p>
      </div>
    </SimplePage>
  );
}
