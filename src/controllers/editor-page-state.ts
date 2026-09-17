import type { PageState } from "../types/interfaces";

export type DeletionAction = "mark" | "restore";

export function createPageStates(
  file: File,
  pageCount: number,
  createdAt: number = Date.now()
): PageState[] {
  return Array.from({ length: pageCount }, (_, index) => ({
    id: `${file.name}-${index + 1}-${createdAt}`,
    sourceFile: file,
    sourcePageNumber: index + 1,
    rotation: 0,
    markedForDeletion: false,
  }));
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
