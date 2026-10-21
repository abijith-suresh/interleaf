import type { PageState } from "../types/interfaces";
import { copyAddedCheckmarks, equalAddedCheckmarks } from "./editor-checkmark-state";
import { copyFieldAnswers, equalFieldAnswers } from "./editor-field-state";
import { copyAddedTexts, equalAddedTexts } from "./editor-text-state";

export const PAGE_HISTORY_LIMIT = 32;
export const INACTIVE_SOURCE_SIZE_LIMIT = 48 * 1024 * 1024;

export interface PageOrganizationSnapshot {
  readonly pages: readonly PageState[];
  readonly selectedIds: readonly string[];
  readonly activePageId: string | null;
}

export interface PageOrganizationEntry {
  readonly label: string;
  readonly before: PageOrganizationSnapshot;
  readonly after: PageOrganizationSnapshot;
}

export interface PageOrganizationHistory {
  readonly undo: readonly PageOrganizationEntry[];
  readonly redo: readonly PageOrganizationEntry[];
}

// Copy fields explicitly: Solid store proxies must never become history entries.
// File is immutable and deliberately retains its original identity.
export function copyOrganizationPages(pages: readonly PageState[]): PageState[] {
  return pages.map((page) => ({
    id: page.id,
    sourceFile: page.sourceFile,
    fieldGroupId: page.fieldGroupId,
    fieldAnswers: copyFieldAnswers(page.fieldAnswers),
    sourcePageNumber: page.sourcePageNumber,
    rotation: page.rotation,
    markedForDeletion: page.markedForDeletion,
    addedText: copyAddedTexts(page.addedText),
    addedCheckmarks: copyAddedCheckmarks(page.addedCheckmarks),
  }));
}

export function snapshotOrganization(
  pages: readonly PageState[],
  selection: ReadonlySet<number>,
  activePageId: string | null
): PageOrganizationSnapshot {
  return {
    pages: copyOrganizationPages(pages),
    selectedIds: pages.filter((_, index) => selection.has(index)).map((page) => page.id),
    activePageId,
  };
}

export function emptyOrganizationHistory(): PageOrganizationHistory {
  return { undo: [], redo: [] };
}

export function recordOrganization(
  history: PageOrganizationHistory,
  label: string,
  before: PageOrganizationSnapshot,
  after: PageOrganizationSnapshot
): PageOrganizationHistory {
  const unchanged =
    before.pages.length === after.pages.length &&
    before.pages.every((page, index) => {
      const next = after.pages[index];
      return (
        page.id === next.id &&
        page.sourceFile === next.sourceFile &&
        page.sourcePageNumber === next.sourcePageNumber &&
        page.rotation === next.rotation &&
        page.fieldGroupId === next.fieldGroupId &&
        equalFieldAnswers(page.fieldAnswers, next.fieldAnswers) &&
        page.markedForDeletion === next.markedForDeletion &&
        equalAddedTexts(page.addedText, next.addedText) &&
        equalAddedCheckmarks(page.addedCheckmarks, next.addedCheckmarks)
      );
    });
  if (unchanged) return history;
  return trimOrganizationHistory(
    { undo: [...history.undo, { label, before, after }], redo: [] },
    after.pages
  );
}

// Count original File identities, including generated image PDFs, across both stacks.
// This bounds retained source sizes, not the browser's document or rendering memory.
export function inactiveSourceSize(
  history: PageOrganizationHistory,
  activePages: readonly PageState[]
): number {
  const active = new Set(activePages.map((page) => page.sourceFile));
  const inactive = new Set<File>();
  for (const entry of [...history.undo, ...history.redo]) {
    for (const snapshot of [entry.before, entry.after]) {
      for (const page of snapshot.pages) {
        if (!active.has(page.sourceFile)) inactive.add(page.sourceFile);
      }
    }
  }
  return [...inactive].reduce((size, file) => size + file.size, 0);
}

export function trimOrganizationHistory(
  history: PageOrganizationHistory,
  activePages: readonly PageState[]
): PageOrganizationHistory {
  let { undo, redo } = history;
  while (
    undo.length + redo.length > 1 &&
    (undo.length + redo.length > PAGE_HISTORY_LIMIT ||
      inactiveSourceSize({ undo, redo }, activePages) > INACTIVE_SOURCE_SIZE_LIMIT)
  ) {
    // Timeline runs undo[0..n] through the present into reversed redo, out to
    // the farthest future. Evict the farthest past first, then the farthest
    // future, so the next undo and redo steps stay contiguous with the
    // current workspace state.
    if (undo.length > 0) undo = undo.slice(1);
    else redo = redo.slice(1);
  }
  return { undo, redo };
}
