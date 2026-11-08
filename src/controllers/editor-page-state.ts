import type { PageState } from "../types/interfaces";
import { copyAddedCheckmarks } from "./editor-checkmark-state";
import { copyFieldAnswers } from "./editor-field-state";
import { copyAddedTexts } from "./editor-text-state";

export type DeletionAction = "mark" | "restore";

let nextPageBatchId = 0;

export function createPageBatchId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  nextPageBatchId += 1;
  return `batch-${nextPageBatchId}`;
}

export function createPageStates(
  file: File,
  pageCount: number,
  createdAt: number = Date.now()
): PageState[] {
  const batchId = createPageBatchId();

  return Array.from({ length: pageCount }, (_, index) => ({
    id: `${file.name}-${index + 1}-${createdAt}-${batchId}`,
    sourceFile: file,
    fieldGroupId: batchId,
    sourcePageNumber: index + 1,
    rotation: 0,
    markedForDeletion: false,
  }));
}

export function duplicatePageState(page: PageState): PageState {
  const id = `copy-${createPageBatchId()}`;
  return {
    ...page,
    id,
    fieldGroupId: id,
    fieldAnswers: copyFieldAnswers(page.fieldAnswers),
    addedText: copyAddedTexts(page.addedText),
    addedCheckmarks: copyAddedCheckmarks(page.addedCheckmarks),
    markedForDeletion: false,
  };
}

export function toggleSelection(selectedIndices: Set<number>, index: number): Set<number> {
  const next = new Set(selectedIndices);

  if (next.has(index)) {
    next.delete(index);
  } else {
    next.add(index);
  }

  return next;
}

export function areAllPagesSelected(pageCount: number, selectedIndices: Set<number>): boolean {
  if (pageCount <= 0 || selectedIndices.size !== pageCount) return false;

  for (let index = 0; index < pageCount; index += 1) {
    if (!selectedIndices.has(index)) return false;
  }

  return true;
}

export function toggleSelectAll(pageCount: number, selectedIndices: Set<number>): Set<number> {
  if (areAllPagesSelected(pageCount, selectedIndices)) {
    return new Set<number>();
  }

  return new Set(Array.from({ length: pageCount }, (_, index) => index));
}

export function getDeletionAction(
  pages: Pick<PageState, "markedForDeletion">[],
  selectedIndices: Set<number>
): DeletionAction {
  const selectedDeletionStates = Array.from(selectedIndices)
    .map((index) => pages[index]?.markedForDeletion)
    .filter((marked): marked is boolean => marked !== undefined);

  if (selectedDeletionStates.length === 0 || selectedDeletionStates.some((marked) => !marked)) {
    return "mark";
  }

  return "restore";
}

export function remapSelectionAfterMove(
  selectedIndices: Set<number>,
  from: number,
  to: number
): Set<number> {
  const next = new Set<number>();

  for (const oldIndex of selectedIndices) {
    let newIndex = oldIndex;

    if (oldIndex === from) {
      newIndex = to;
    } else if (from < to && oldIndex > from && oldIndex <= to) {
      newIndex = oldIndex - 1;
    } else if (from > to && oldIndex >= to && oldIndex < from) {
      newIndex = oldIndex + 1;
    }

    next.add(newIndex);
  }

  return next;
}

/** Shifts selected indices past a page inserted at `insertedIndex`, so the same pages stay selected. */
export function remapSelectionAfterInsert(
  selectedIndices: Set<number>,
  insertedIndex: number
): Set<number> {
  return new Set(
    Array.from(selectedIndices, (index) => (index >= insertedIndex ? index + 1 : index))
  );
}

/**
 * The page a grid navigation key moves focus to, or null when the key does
 * not navigate or focus is already at that edge. Down from a full row moves
 * to the last page when the next row is shorter.
 */
export function gridNavigationTarget(
  key: string,
  index: number,
  pageCount: number,
  columns: number
): number | null {
  if (pageCount === 0 || index < 0 || index >= pageCount) return null;
  const cols = Math.max(1, Math.floor(columns));
  const last = pageCount - 1;
  let target: number;
  switch (key) {
    case "ArrowLeft":
      target = index - 1;
      break;
    case "ArrowRight":
      target = index + 1;
      break;
    case "ArrowUp":
      target = index - cols;
      break;
    case "ArrowDown":
      target =
        index + cols <= last
          ? index + cols
          : Math.floor(index / cols) < Math.floor(last / cols)
            ? last
            : index;
      break;
    case "Home":
      target = 0;
      break;
    case "End":
      target = last;
      break;
    default:
      return null;
  }
  return target < 0 || target > last || target === index ? null : target;
}
