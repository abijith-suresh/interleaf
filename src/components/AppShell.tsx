import { appMeta } from "@/utils/meta";

const noteGroups = [
  {
    label: "Today",
    items: ["Untitled note", "Project handoff"]
  },
  {
    label: "Apr 10",
    items: ["Meeting notes"]
  },
  {
    label: "Apr 9",
    items: ["Launch checklist", "Ideas"]
  }
];

const tabs = ["Untitled note", "Project handoff", "Meeting notes"];
const toolbarItems = ["Search", "Theme", "Export", "About"];

export default function AppShell() {
  return (
    <div class="flex min-h-screen bg-bg text-text-primary">
      <aside class="flex w-[220px] shrink-0 flex-col border-r border-border bg-surface">
        <div class="px-5 pt-5">
          <div class="text-md font-medium text-text-primary">brev</div>
        </div>

        <div class="flex-1 overflow-y-auto px-2 py-4">
          {noteGroups.map((group) => (
            <section class="mb-5">
              <div class="px-2 pb-2 text-xs font-medium uppercase tracking-[0.08em] text-text-tertiary">
                {group.label}
              </div>
              <div class="space-y-1">
                {group.items.map((item, index) => (
                  <button
                    type="button"
                    class={`flex w-full items-center truncate rounded-sm border-l-2 px-4 py-2 text-left text-sm ${
                      group.label === "Today" && index === 0
                        ? "border-l-accent bg-accent-subtle text-accent"
                        : "border-l-transparent text-text-primary hover:bg-surface-hover"
                    }`}
                  >
                    <span class="truncate">{item}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div class="border-t border-border px-4 py-3">
          <div class="flex items-center gap-2">
            {toolbarItems.map((item) => (
              <button
                type="button"
                aria-label={item}
                class="inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary"
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      </aside>

      <main class="flex min-w-0 flex-1 flex-col bg-bg">
        <div class="flex h-10 items-center gap-1 overflow-x-auto border-b border-border bg-surface px-2">
          <div class="flex min-w-0 items-center gap-1">
            {tabs.map((tab, index) => (
              <button
                type="button"
                class={`flex h-8 max-w-[160px] items-center rounded-md px-4 text-sm ${
                  index === 0
                    ? "bg-accent-subtle text-text-primary border-b-2 border-accent"
                    : "text-text-secondary hover:bg-surface-hover"
                }`}
              >
                <span class="truncate">{tab}</span>
              </button>
            ))}
            <button
              type="button"
              aria-label="New note"
              class="inline-flex h-8 w-8 items-center justify-center rounded-md text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary"
            >
              +
            </button>
          </div>
        </div>

        <div class="flex flex-1 bg-bg">
          <div class="mx-auto flex w-full max-w-[680px] flex-1 items-center justify-center px-8 py-12">
            <div class="text-center text-sm text-text-tertiary">
              <p>Press Ctrl+N to start a new note</p>
              <p class="mt-3 text-xs text-text-secondary">brev v{appMeta.version}</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
