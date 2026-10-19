import type { PageState } from "../types/interfaces";

export const PAGE_HISTORY_LIMIT = 32;

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
    sourcePageNumber: page.sourcePageNumber,
    rotation: page.rotation,
    markedForDeletion: page.markedForDeletion,
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
        page.markedForDeletion === next.markedForDeletion
      );
    });
  if (unchanged) return history;
  return { undo: [...history.undo, { label, before, after }].slice(-PAGE_HISTORY_LIMIT), redo: [] };
}
