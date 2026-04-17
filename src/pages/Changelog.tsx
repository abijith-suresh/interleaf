import { For } from "solid-js";
import SimplePage from "@/components/SimplePage";
import { appMeta } from "@/utils/meta";
import { parseChangelog } from "@/utils/changelog";
import rawChangelog from "../../CHANGELOG.md?raw";

const entries = parseChangelog(rawChangelog);

const categoryOrder = ["Added", "Changed", "Fixed", "Deprecated", "Removed"];

export default function Changelog() {
  return (
    <SimplePage title="Changelog">
      <p class="mb-2 text-text-secondary">
        All notable changes to interleaf are documented below. This project
        follows{" "}
        <a
          href="https://keepachangelog.com/en/1.1.0/"
          target="_blank"
          rel="noopener noreferrer"
          class="text-accent underline decoration-accent/30 underline-offset-2 transition-colors duration-150 hover:decoration-accent"
        >
          Keep a Changelog
        </a>{" "}
        and{" "}
        <a
          href="https://semver.org/spec/v2.0.0.html"
          target="_blank"
          rel="noopener noreferrer"
          class="text-accent underline decoration-accent/30 underline-offset-2 transition-colors duration-150 hover:decoration-accent"
        >
          Semantic Versioning
        </a>
        .
      </p>
      <p class="mb-8 text-sm text-text-tertiary">
        Current version: v{appMeta.version}
      </p>

      <div class="divide-y divide-border">
        <For each={entries}>
          {(entry) => (
            <section class="py-8 first:pt-0 last:pb-0">
              <div class="mb-4 flex items-baseline gap-3">
                <h2 class="font-serif text-lg font-normal text-text-primary">
                  v{entry.version}
                </h2>
                <span class="text-sm text-text-tertiary">{entry.date}</span>
                {entry.version === appMeta.version && (
                  <span class="rounded-sm bg-accent-subtle px-2 py-0.5 text-xs font-medium text-accent">
                    current
                  </span>
                )}
              </div>

              <div class="space-y-4">
                {categoryOrder
                  .filter((cat) => entry.categories[cat]?.length)
                  .map((cat) => (
                    <div>
                      <span class="mb-2 inline-block rounded-sm bg-accent-subtle px-2 py-0.5 text-xs font-medium text-accent">
                        {cat}
                      </span>
                      <ul class="m-0 list-none space-y-1.5 pl-0">
                        <For each={entry.categories[cat]}>
                          {(item) => (
                            <li class="flex gap-2 text-sm text-text-primary">
                              <span class="mt-0.5 text-text-tertiary">·</span>
                              <span>{item}</span>
                            </li>
                          )}
                        </For>
                      </ul>
                    </div>
                  ))}
              </div>
            </section>
          )}
        </For>
      </div>
    </SimplePage>
  );
}
