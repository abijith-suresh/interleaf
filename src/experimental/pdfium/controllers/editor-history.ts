import type { PDFDocumentCheckpoint } from "../services/pdf-checkpoint";

export interface EditorHistoryEntry<State> {
  readonly label: string;
  readonly state: State;
  readonly documents: readonly {
    readonly file: File;
    readonly checkpoint: PDFDocumentCheckpoint;
  }[];
}

interface HistoryOptions {
  readonly maxSteps?: number;
  readonly maxBytes?: number;
}

/** Stores inverse actions; callers commit a stack move only after restoring successfully. */
export class EditorHistory<State> {
  private readonly undo: EditorHistoryEntry<State>[] = [];
  private readonly redo: EditorHistoryEntry<State>[] = [];
  private readonly maxSteps: number;
  private readonly maxBytes: number;

  constructor(options: HistoryOptions = {}) {
    this.maxSteps = Math.max(1, options.maxSteps ?? 32);
    this.maxBytes = Math.max(0, options.maxBytes ?? 48 * 1024 * 1024);
  }

  get undoCount(): number {
    return this.undo.length;
  }

  get redoCount(): number {
    return this.redo.length;
  }

  get byteLength(): number {
    return [...this.undo, ...this.redo].reduce((total, entry) => total + this.size(entry), 0);
  }

  getUndo(): EditorHistoryEntry<State> | undefined {
    return this.undo.at(-1);
  }

  getRedo(): EditorHistoryEntry<State> | undefined {
    return this.redo.at(-1);
  }

  record(entry: EditorHistoryEntry<State>): void {
    this.redo.length = 0;
    const stored = this.copy(entry);
    this.undo.push(stored);
    this.trim(stored);
  }

  commitUndo(inverse: EditorHistoryEntry<State>): void {
    if (!this.undo.length) return;
    this.undo.pop();
    const stored = this.copy(inverse);
    this.redo.push(stored);
    this.trim(stored);
  }

  commitRedo(inverse: EditorHistoryEntry<State>): void {
    if (!this.redo.length) return;
    this.redo.pop();
    const stored = this.copy(inverse);
    this.undo.push(stored);
    this.trim(stored);
  }

  clear(): void {
    this.undo.length = 0;
    this.redo.length = 0;
  }

  private copy(entry: EditorHistoryEntry<State>): EditorHistoryEntry<State> {
    return { ...entry, documents: entry.documents.slice() };
  }

  private size(entry: EditorHistoryEntry<State>): number {
    return entry.documents.reduce(
      (total, { checkpoint }) => total + checkpoint.bytes.byteLength,
      0
    );
  }

  private trim(latest: EditorHistoryEntry<State>): void {
    // A single large source must still support undoing the most recent action.
    while (this.undo.length + this.redo.length > 1) {
      const largest = Math.max(...[...this.undo, ...this.redo].map((entry) => this.size(entry)));
      if (
        this.undo.length + this.redo.length <= this.maxSteps &&
        this.byteLength <= Math.max(this.maxBytes, largest)
      )
        return;
      if (this.undo.length && this.undo[0] !== latest) this.undo.shift();
      else this.redo.shift();
    }
  }
}
