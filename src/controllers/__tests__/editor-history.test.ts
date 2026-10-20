import { createRoot } from "solid-js";
import { createStore } from "solid-js/store";
import { describe, expect, it } from "vitest";
import {
  copyOrganizationPages,
  emptyOrganizationHistory,
  inactiveSourceSize,
  PAGE_HISTORY_LIMIT,
  type PageOrganizationHistory,
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
  const snapshotOf = (...sources: File[]) =>
    snapshotOrganization(
      sources.flatMap((source) => createPageStates(source, 1)),
      new Set(),
      null
    );

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
    // redo stores future steps nearest-last: "old removal" is the next redo
    // step, so the farthest future entry is evicted to keep the timeline
    // contiguous with the present.
    expect(trimOrganizationHistory({ undo: [], redo: [third, second, first] }, [])).toEqual({
      undo: [],
      redo: [first],
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
    expect(trimmed.undo.at(-1)?.label).toBe("19");
    expect(trimmed.redo).toHaveLength(20);
    expect(trimmed.redo.at(-1)?.label).toBe("20");
  });

  // Mirrors the Editor's travel movement: pop the nearest step onto the other
  // stack, then re-trim around the restored pages, exactly as Editor.tsx does.
  const undoStep = (history: PageOrganizationHistory): PageOrganizationHistory => {
    const entry = history.undo.at(-1);
    if (!entry) throw new Error("Nothing to undo");
    return trimOrganizationHistory(
      { undo: history.undo.slice(0, -1), redo: [...history.redo, entry] },
      entry.before.pages
    );
  };
  const redoStep = (history: PageOrganizationHistory): PageOrganizationHistory => {
    const entry = history.redo.at(-1);
    if (!entry) throw new Error("Nothing to redo");
    return trimOrganizationHistory(
      { undo: [...history.undo, entry], redo: history.redo.slice(0, -1) },
      entry.after.pages
    );
  };

  it("keeps the next redo step contiguous when undoing into source size pressure", () => {
    const first = file(1024);
    const second = file(30 * 1024 * 1024);
    const third = file(30 * 1024 * 1024);
    const stateA = snapshotOf(first);
    const stateAB = snapshotOf(first, second);
    const stateABC = snapshotOf(first, second, third);
    const addSecond = { label: "add second", before: stateA, after: stateAB };
    const addThird = { label: "add third", before: stateAB, after: stateABC };
    let history: PageOrganizationHistory = { undo: [addSecond, addThird], redo: [] };
    history = undoStep(history);
    expect(history.redo.map((entry) => entry.label)).toEqual(["add third"]);
    history = undoStep(history);
    // Retaining the farthest future step instead of the next one would leave
    // redoing "add third" on top of [first], silently skipping [first, second].
    expect(history.redo.map((entry) => entry.label)).toEqual(["add second"]);
    const nextRedo = history.redo.at(-1);
    if (!nextRedo) throw new Error("Missing next redo step");
    const restored = nextRedo.after.pages.map((page) => page.sourceFile);
    expect(restored).toHaveLength(2);
    expect(restored[0]).toBe(first);
    expect(restored[1]).toBe(second);
    expect(inactiveSourceSize(history, stateA.pages)).toBe(30 * 1024 * 1024);
    expect(history.undo.length + history.redo.length).toBeLessThanOrEqual(PAGE_HISTORY_LIMIT);
    history = redoStep(history);
    expect(history.redo).toEqual([]);
    expect(history.undo.at(-1)?.label).toBe("add second");
    expect(inactiveSourceSize(history, stateAB.pages)).toBe(0);
  });

  it("trims mixed stacks from the far past and the far future, keeping the next redo step", () => {
    const kept = file(1024);
    const active = snapshotOf(kept);
    const rotate = (label: string) => ({ label, before: active, after: active });
    const stateF1 = snapshotOf(kept, file(20 * 1024 * 1024));
    const stateF2 = snapshotOf(kept, stateF1.pages[1].sourceFile, file(20 * 1024 * 1024));
    const stateF3 = snapshotOf(
      kept,
      stateF1.pages[1].sourceFile,
      stateF2.pages[2].sourceFile,
      file(20 * 1024 * 1024)
    );
    const futureOne = { label: "future 1", before: active, after: stateF1 };
    const futureTwo = { label: "future 2", before: stateF1, after: stateF2 };
    const futureThree = { label: "future 3", before: stateF2, after: stateF3 };
    const trimmed = trimOrganizationHistory(
      {
        undo: [rotate("rotation 1"), rotate("rotation 2")],
        // redo stores future steps nearest-last.
        redo: [futureThree, futureTwo, futureOne],
      },
      active.pages
    );
    expect(trimmed.undo).toEqual([]);
    expect(trimmed.redo.map((entry) => entry.label)).toEqual(["future 2", "future 1"]);
    const nextRedo = trimmed.redo.at(-1);
    if (!nextRedo) throw new Error("Missing next redo step");
    const restored = nextRedo.after.pages.map((page) => page.sourceFile);
    expect(restored).toHaveLength(2);
    expect(restored[0]).toBe(kept);
    expect(restored[1]).toBe(stateF1.pages[1].sourceFile);
    expect(inactiveSourceSize(trimmed, active.pages)).toBe(40 * 1024 * 1024);
    expect(trimmed.undo.length + trimmed.redo.length).toBeLessThanOrEqual(PAGE_HISTORY_LIMIT);
  });

  it("retains an oversized next redo step when it is the only entry left", () => {
    const first = file(1024);
    const huge = file(60 * 1024 * 1024);
    const stateA = snapshotOf(first);
    const stateAH = snapshotOf(first, huge);
    const addHuge = { label: "add huge", before: stateA, after: stateAH };
    let history: PageOrganizationHistory = { undo: [addHuge], redo: [] };
    history = undoStep(history);
    expect(history.undo).toEqual([]);
    expect(history.redo.map((entry) => entry.label)).toEqual(["add huge"]);
    expect(inactiveSourceSize(history, stateA.pages)).toBe(60 * 1024 * 1024);
    const restored = history.redo[0].after.pages.map((page) => page.sourceFile);
    expect(restored).toHaveLength(2);
    expect(restored[0]).toBe(first);
    expect(restored[1]).toBe(huge);
  });
});
