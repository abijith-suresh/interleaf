import Fuse from "fuse.js";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";

import type { NoteRecord } from "@/types/note";
import { trapFocus } from "@/utils/focusTrap";
import { deriveTitle } from "@/utils/deriveTitle";

type SearchOverlayProps = {
  open: boolean;
  notes: NoteRecord[];
  onClose: () => void;
  onOpenNote: (noteId: string) => void;
};

type SearchResult = {
  note: NoteRecord;
  title: string;
  snippet: string;
};

const MAX_RECENT_RESULTS = 10;
const MAX_SEARCH_RESULTS = 20;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createSnippet(body: string, query: string) {
  const normalizedBody = body.replace(/\s+/g, " ").trim();

  if (!normalizedBody) {
    return "Empty note";
  }

  if (!query.trim()) {
    return normalizedBody.slice(0, 140);
  }

  const regex = new RegExp(escapeRegExp(query.trim()), "i");
  const match = regex.exec(normalizedBody);

  if (!match) {
    return normalizedBody.slice(0, 140);
  }

  const start = Math.max(0, match.index - 50);
  const end = Math.min(normalizedBody.length, match.index + match[0].length + 90);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < normalizedBody.length ? "..." : "";

  return `${prefix}${normalizedBody.slice(start, end)}${suffix}`;
}

function highlightSnippet(snippet: string, query: string) {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    return [{ text: snippet, match: false }];
  }

  const regex = new RegExp(`(${escapeRegExp(trimmedQuery)})`, "ig");
  const parts = snippet.split(regex).filter((part) => part.length > 0);

  return parts.map((part) => ({
    text: part,
    match: part.toLowerCase() === trimmedQuery.toLowerCase()
  }));
}

export default function SearchOverlay(props: SearchOverlayProps) {
  let inputRef: HTMLInputElement | undefined;
  let dialogRef: HTMLDivElement | undefined;

  const [query, setQuery] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(0);

  const fuse = createMemo(
    () =>
      new Fuse(props.notes, {
        keys: ["body"],
        includeScore: true,
        shouldSort: true,
        threshold: 0.35,
        ignoreLocation: true,
        minMatchCharLength: 2
      })
  );

  const results = createMemo<SearchResult[]>(() => {
    const trimmedQuery = query().trim();

    if (!trimmedQuery) {
      return props.notes.slice(0, MAX_RECENT_RESULTS).map((note) => ({
        note,
        title: deriveTitle(note.body),
        snippet: createSnippet(note.body, "")
      }));
    }

    return fuse()
      .search(trimmedQuery, { limit: MAX_SEARCH_RESULTS })
      .map(({ item }) => ({
        note: item,
        title: deriveTitle(item.body),
        snippet: createSnippet(item.body, trimmedQuery)
      }));
  });

  createEffect(() => {
    if (!props.open) {
      setQuery("");
      setSelectedIndex(0);
      return;
    }

    window.setTimeout(() => {
      inputRef?.focus();
      inputRef?.select();
    }, 0);
  });

  createEffect(() => {
    const maxIndex = Math.max(0, results().length - 1);
    setSelectedIndex((current) => Math.min(current, maxIndex));
  });

  function openSelectedResult(index = selectedIndex()) {
    const result = results()[index];

    if (!result) {
      return;
    }

    props.onOpenNote(result.note.id);
    props.onClose();
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (trapFocus(dialogRef, event)) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      props.onClose();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((current) => Math.min(current + 1, Math.max(0, results().length - 1)));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((current) => Math.max(0, current - 1));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      openSelectedResult();
    }
  }

  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-30 flex items-start justify-center px-4 pt-[12vh]" role="presentation">
        <div
          ref={dialogRef}
          class="w-full max-w-[640px] rounded-lg border border-border bg-surface shadow-lg"
          role="dialog"
          aria-modal="true"
          aria-labelledby="search-overlay-title"
          onKeyDown={handleKeyDown}
        >
          <h2 id="search-overlay-title" class="sr-only">Search notes</h2>
          <div class="border-b border-border p-3">
            <input
              ref={inputRef}
              type="text"
              value={query()}
              aria-label="Search notes"
              placeholder="Search notes..."
              class="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-tertiary"
              onInput={(event) => {
                setQuery(event.currentTarget.value);
                setSelectedIndex(0);
              }}
            />
          </div>

          <div class="max-h-[420px] overflow-y-auto p-2">
            <Show when={results().length > 0} fallback={<div class="px-3 py-6 text-sm text-text-secondary">No matching notes.</div>}>
              <For each={results()}>
                {(result, index) => {
                  const isSelected = () => index() === selectedIndex();

                  return (
                    <button
                      type="button"
                      class={`mb-1 flex w-full flex-col rounded-md px-3 py-3 text-left last:mb-0 ${
                        isSelected() ? "bg-surface-hover text-text-primary" : "text-text-secondary hover:bg-surface-hover"
                      }`}
                      onMouseEnter={() => setSelectedIndex(index())}
                      onClick={() => openSelectedResult(index())}
                    >
                      <span class="truncate text-sm font-medium text-text-primary">{result.title}</span>
                      <span class="mt-1 text-xs leading-relaxed text-text-secondary">
                        <For each={highlightSnippet(result.snippet, query())}>
                          {(part) => (
                            <Show
                              when={part.match}
                              fallback={<span>{part.text}</span>}
                            >
                              <mark class="bg-transparent font-medium text-text-primary">{part.text}</mark>
                            </Show>
                          )}
                        </For>
                      </span>
                    </button>
                  );
                }}
              </For>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
