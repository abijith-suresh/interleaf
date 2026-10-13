import { describe, expect, it } from "vitest";
import { EditorHistory, type EditorHistoryEntry } from "../editor-history";

type State = { readonly pages: readonly string[] };
const file = new File(["PDF"], "form.pdf");
const entry = (label: string, pages: readonly string[], bytes = 0): EditorHistoryEntry<State> => ({
  label,
  state: { pages },
  documents: bytes ? [{ file, checkpoint: { bytes: new Uint8Array(bytes) } }] : [],
});

describe("workspace inverse history", () => {
  it("retains the action while restore is pending or rejected and moves it only on success", () => {
    const history = new EditorHistory<State>();
    const before = entry("Delete page", ["page 1", "page 2"]);
    history.record(before);
    const undo = history.getUndo();
    expect(undo?.state.pages).toEqual(["page 1", "page 2"]);
    expect(history.getUndo()).toBe(undo);
    expect(history.redoCount).toBe(0);
    history.commitUndo(entry("Delete page", ["page 1"]));
    expect(history.undoCount).toBe(0);
    expect(history.getRedo()?.state.pages).toEqual(["page 1"]);
    history.commitRedo(before);
    expect(history.getUndo()?.state.pages).toEqual(["page 1", "page 2"]);
    expect(history.redoCount).toBe(0);
  });

  it("records a new action on the restored state and discards the abandoned redo path", () => {
    const history = new EditorHistory<State>();
    history.record(entry("Delete page", ["page 1", "page 2"]));
    history.commitUndo(entry("Delete page", ["page 1"]));
    history.record(entry("Duplicate page", ["page 1", "page 2"]));
    expect(history.getUndo()?.label).toBe("Duplicate page");
    expect(history.getRedo()).toBeUndefined();
  });

  it("bounds total steps and evicts the oldest undo state", () => {
    const history = new EditorHistory<State>({ maxSteps: 2 });
    history.record(entry("Rotate page", ["original"]));
    history.record(entry("Add answer", ["rotated"], 2));
    history.record(entry("Mark checkbox", ["answered"], 2));
    expect(history.undoCount).toBe(2);
    history.commitUndo(entry("Mark checkbox", ["checked"]));
    expect(history.getUndo()?.label).toBe("Add answer");
    history.commitUndo(entry("Add answer", ["answered"]));
    expect(history.getUndo()).toBeUndefined();
    expect(history.redoCount).toBe(2);
  });

  it("budgets serialized bytes across both stacks without retaining native handles", () => {
    const history = new EditorHistory<State>({ maxBytes: 6 });
    history.record(entry("First answer", ["blank"], 3));
    history.record(entry("Second answer", ["first answer"], 3));
    history.commitUndo(entry("Second answer", ["both answers"], 5));
    expect(history.undoCount).toBe(0);
    expect(history.redoCount).toBe(1);
    expect(history.byteLength).toBe(5);
  });

  it("keeps the latest action when its checkpoint alone exceeds the byte limit", () => {
    const history = new EditorHistory<State>({ maxBytes: 4 });
    history.record(entry("Small edit", ["blank"], 2));
    history.record(entry("Large edit", ["small edit"], 10));
    expect(history.undoCount).toBe(1);
    expect(history.getUndo()?.label).toBe("Large edit");
    expect(history.byteLength).toBe(10);
    history.commitUndo(entry("Large edit", ["large edit"], 12));
    expect(history.getRedo()?.label).toBe("Large edit");
    expect(history.byteLength).toBe(12);
  });

  it("preserves the latest redo inverse even when older redo states take all the budget", () => {
    const history = new EditorHistory<State>({ maxBytes: 12 });
    history.record(entry("First", ["blank"], 4));
    history.record(entry("Second", ["first"], 4));
    history.commitUndo(entry("Second", ["second"], 4));
    history.commitUndo(entry("First", ["first"], 4));
    history.commitRedo(entry("First", ["blank"], 20));
    expect(history.getUndo()?.label).toBe("First");
    expect(history.redoCount).toBe(0);
    expect(history.byteLength).toBe(20);
  });

  it("copies the document list and clears all checkpoint references on session reset", () => {
    const history = new EditorHistory<State>();
    const action = entry("Remove source", ["source"], 8);
    history.record(action);
    expect(history.getUndo()?.documents).not.toBe(action.documents);
    expect(history.getUndo()?.documents[0].file).toBe(file);
    history.commitUndo(entry("Remove source", [], 8));
    history.clear();
    expect(history.getUndo()).toBeUndefined();
    expect(history.getRedo()).toBeUndefined();
    expect(history.byteLength).toBe(0);
  });
});
