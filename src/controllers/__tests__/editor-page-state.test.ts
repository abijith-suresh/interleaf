import { describe, expect, it } from "vitest";
import {
  areAllPagesSelected,
  createPageStates,
  duplicatePageState,
  getDeletionAction,
  remapSelectionAfterMove,
  toggleSelectAll,
  toggleSelection,
} from "../editor-page-state";

describe("editor page state controller", () => {
  const file = new File(["plain"], "sample.pdf", { type: "application/pdf" });

  it("creates page state entries for each source page", () => {
    const pageStates = createPageStates(file, 3, 1234);

    expect(pageStates.map(({ id, ...state }) => state)).toEqual([
      { sourceFile: file, sourcePageNumber: 1, rotation: 0, markedForDeletion: false },
      { sourceFile: file, sourcePageNumber: 2, rotation: 0, markedForDeletion: false },
      { sourceFile: file, sourcePageNumber: 3, rotation: 0, markedForDeletion: false },
    ]);
    for (const page of pageStates) {
      expect(page.sourceFile).toBe(file);
      expect(page.id).toEqual(expect.any(String));
      expect(page.id).not.toBe("");
    }
  });

  it("keeps batches unique when files share a name and timestamp", () => {
    const firstBatch = createPageStates(file, 2, 1234);
    const secondBatch = createPageStates(file, 2, 1234);

    expect(new Set([...firstBatch, ...secondBatch].map((page) => page.id)).size).toBe(4);
  });

  it("toggles an individual selection", () => {
    expect(toggleSelection(new Set<number>(), 1)).toEqual(new Set([1]));
    expect(toggleSelection(new Set([1, 2]), 1)).toEqual(new Set([2]));
  });

  it("creates rapid copies with unique organization state and the same immutable source", () => {
    const original = createPageStates(file, 1)[0];
    original.rotation = 270;
    original.markedForDeletion = true;
    const copies = Array.from({ length: 100 }, () => duplicatePageState(original));
    copies.push(duplicatePageState(copies[0]));
    expect(new Set([original, ...copies].map((page) => page.id)).size).toBe(102);
    for (const copy of copies) {
      expect(copy.sourceFile).toBe(file);
      expect(copy.sourcePageNumber).toBe(1);
      expect(copy.rotation).toBe(270);
      expect(copy.markedForDeletion).toBe(false);
    }
    copies[0].rotation = 90;
    copies[0].markedForDeletion = true;
    expect(copies[1].rotation).toBe(270);
    expect(copies[1].markedForDeletion).toBe(false);
    expect(original.rotation).toBe(270);
    expect(original.markedForDeletion).toBe(true);
  });

  it("toggles select-all against the total page count", () => {
    expect(toggleSelectAll(3, new Set([0]))).toEqual(new Set([0, 1, 2]));
    expect(toggleSelectAll(3, new Set([0, 1, 2]))).toEqual(new Set<number>());
  });

  it("only treats the complete page set as selected", () => {
    expect(areAllPagesSelected(3, new Set([0, 1, 2]))).toBe(true);
    expect(areAllPagesSelected(3, new Set([0, 1, 3]))).toBe(false);
    expect(areAllPagesSelected(0, new Set<number>())).toBe(false);
  });

  it("describes the action needed for the selected deletion states", () => {
    const pages = createPageStates(file, 3, 1234);

    expect(getDeletionAction(pages, new Set())).toBe("mark");
    expect(getDeletionAction(pages, new Set([0]))).toBe("mark");

    pages[0].markedForDeletion = true;
    expect(getDeletionAction(pages, new Set([0]))).toBe("restore");
    expect(getDeletionAction(pages, new Set([0, 1]))).toBe("mark");
  });

  it("remaps selections when an item moves forward", () => {
    const remapped = remapSelectionAfterMove(new Set([0, 1, 3]), 1, 3);
    expect(remapped).toEqual(new Set([0, 2, 3]));
  });

  it("remaps selections when an item moves backward", () => {
    const remapped = remapSelectionAfterMove(new Set([1, 2, 4]), 4, 1);
    expect(remapped).toEqual(new Set([2, 3, 1]));
  });
});
