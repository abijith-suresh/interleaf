import { createRoot } from "solid-js";
import { createStore } from "solid-js/store";
import { describe, expect, it } from "vitest";
import {
  copyOrganizationPages,
  emptyOrganizationHistory,
  inactiveSourceSize,
  PAGE_HISTORY_LIMIT,
  recordOrganization,
  snapshotOrganization,
  trimOrganizationHistory,
} from "../editor-history";
import { createPageStates, duplicatePageState } from "../editor-page-state";

describe("page organization history", () => {
  it("copies mutable store fields and selection, keeping only original File references", () => {
    createRoot((dispose) => {
      const file = new File(["original bytes"], "source.pdf");
      const [pages, setPages] = createStore(createPageStates(file, 2));
      const selection = new Set([1]);
      const before = snapshotOrganization(pages, selection, pages[1].id);
      setPages(1, "rotation", 90);
      setPages(0, "markedForDeletion", true);
      selection.clear();
      const after = snapshotOrganization(pages, selection, pages[0].id);
      expect(before.pages.map((page) => page.rotation)).toEqual([0, 0]);
      expect(before.pages[0].markedForDeletion).toBe(false);
      expect(before.selectedIds).toEqual([pages[1].id]);
      expect(before.pages.every((page) => page.sourceFile === file)).toBe(true);
      const restored = copyOrganizationPages(before.pages);
      restored[1].rotation = 180;
      expect(before.pages[1].rotation).toBe(0);
      expect(after.pages[1].rotation).toBe(90);
      expect(restored[0].sourceFile).toBe(file);
      expect(Object.keys(before.pages[0]).sort()).toEqual([
        "id",
        "markedForDeletion",
        "rotation",
        "sourceFile",
        "sourcePageNumber",
      ]);
      dispose();
    });
  });

  it("bounds retained steps, skips no-ops without losing redo, and clears the redo branch on mutation", () => {
    const file = new File(["original"], "source.pdf");
    const pages = createPageStates(file, 1);
    let history = emptyOrganizationHistory();
    for (let step = 0; step < PAGE_HISTORY_LIMIT + 4; step++) {
      const before = snapshotOrganization(pages, new Set(), pages[0].id);
      pages[0].rotation = (pages[0].rotation + 90) % 360;
      history = recordOrganization(
        history,
        `rotation ${step}`,
        before,
        snapshotOrganization(pages, new Set(), pages[0].id)
      );
    }
    expect(history.undo).toHaveLength(PAGE_HISTORY_LIMIT);
    expect(history.undo[0].label).toBe("rotation 4");
    const entry = history.undo.at(-1);
    if (!entry) throw new Error("Missing history entry");
    history = { undo: history.undo.slice(0, -1), redo: [entry] };
    const before = snapshotOrganization(pages, new Set(), pages[0].id);
    const changedSelection = snapshotOrganization(pages, new Set([0]), null);
    expect(recordOrganization(history, "no change", before, changedSelection)).toBe(history);
    const copy = duplicatePageState(pages[0]);
    pages.push(copy);
    history = recordOrganization(
      history,
      "duplication",
      before,
      snapshotOrganization(pages, new Set([1]), copy.id)
    );
    expect(history.redo).toEqual([]);
    expect(history.undo.at(-1)?.after.pages[1].id).toBe(copy.id);
    expect(history.undo.at(-1)?.before.pages).toHaveLength(1);
    history = emptyOrganizationHistory();
    expect(history).toEqual({ undo: [], redo: [] });
  });
});

describe("source history retention", () => {
  const file = (size: number) => {
    const source = new File(["immutable"], "same.pdf");
    Object.defineProperty(source, "size", { value: size });
    return source;
  };
  const snapshot = (source: File) =>
    snapshotOrganization(createPageStates(source, 1), new Set(), null);

  it("counts identity once across both stacks and excludes active files", () => {
    const first = file(20 * 1024 * 1024);
    const sameName = file(20 * 1024 * 1024);
    const before = snapshot(first);
    const after = snapshot(sameName);
    const entry = { label: "add", before, after };
    const history = { undo: [entry, entry], redo: [entry] };
    expect(inactiveSourceSize(history, [])).toBe(40 * 1024 * 1024);
    expect(inactiveSourceSize(history, before.pages)).toBe(20 * 1024 * 1024);
    expect(inactiveSourceSize(history, [...before.pages, ...after.pages])).toBe(0);
    expect(trimOrganizationHistory(history, after.pages)).toEqual(history);
  });

  it("evicts old File references, keeps an oversized newest entry, and drops redo on branching", () => {
    const old = snapshot(file(30 * 1024 * 1024));
    const middle = snapshot(file(30 * 1024 * 1024));
    const newest = snapshot(file(60 * 1024 * 1024));
    const empty = snapshotOrganization([], new Set(), null);
    const first = { label: "old removal", before: old, after: empty };
    const second = { label: "middle removal", before: middle, after: empty };
    const third = { label: "newest removal", before: newest, after: empty };
    expect(trimOrganizationHistory({ undo: [first, second, third], redo: [] }, [])).toEqual({
      undo: [third],
      redo: [],
    });
    expect(trimOrganizationHistory({ undo: [], redo: [third, second, first] }, [])).toEqual({
      undo: [],
      redo: [third],
    });
    const branch = recordOrganization({ undo: [first], redo: [third] }, "add", empty, middle);
    expect(branch.redo).toEqual([]);
    expect(inactiveSourceSize(branch, middle.pages)).toBe(old.pages[0].sourceFile.size);
    expect(inactiveSourceSize(emptyOrganizationHistory(), [])).toBe(0);
  });

  it("applies the 32-entry bound to both stacks together", () => {
    const before = snapshot(file(1));
    const entries = Array.from({ length: 40 }, (_, index) => ({
      label: String(index),
      before,
      after: before,
    }));
    const trimmed = trimOrganizationHistory(
      { undo: entries.slice(0, 20), redo: entries.slice(20).reverse() },
      before.pages
    );
    expect(trimmed.undo).toHaveLength(12);
    expect(trimmed.undo[0].label).toBe("8");
    expect(trimmed.redo).toHaveLength(20);
  });
});
