import type { EditorState } from "@codemirror/state";

/**
 * Returns true if the cursor's current line intersects the given range [from, to].
 * Used to decide whether to hide markdown syntax tokens (Bear-style):
 *  - cursor IS on the line  → keep raw syntax visible
 *  - cursor is NOT on line  → hide syntax, show rendered form
 *
 * Handles multi-line nodes (e.g. fenced code blocks) by checking whether the
 * cursor's line falls anywhere within the node's span.
 */
export function lineContainsCursor(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  const cursorPos = state.selection.main.head;
  const cursorLine = state.doc.lineAt(cursorPos);
  // The cursor line overlaps the node if the line starts before the node ends
  // AND the line ends after the node starts.
  return cursorLine.from <= to && cursorLine.to >= from;
}
