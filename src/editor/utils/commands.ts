import type { Command } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";

/**
 * Expands a cursor position (from === to) to the word boundaries on that line.
 * Uses \w to detect word characters — stops at punctuation like * and [.
 * Returns the original range unchanged if there is already a selection.
 */
function expandToWord(
  state: Parameters<Command>[0]["state"],
  from: number,
  to: number,
): { from: number; to: number } {
  if (from !== to) return { from, to };

  const line = state.doc.lineAt(from);
  const text = line.text;
  const offset = from - line.from;

  let start = offset;
  let end = offset;
  while (start > 0 && /\w/.test(text[start - 1]!)) start--;
  while (end < text.length && /\w/.test(text[end]!)) end++;

  return { from: line.from + start, to: line.from + end };
}

/**
 * Wraps the current selection (or the word under the cursor if no selection)
 * with `marker` on both sides. Toggles off correctly in both cases:
 *
 *  Case A — selection is INSIDE the markers:
 *    cursor on "hello" inside **hello** → checks chars just outside the
 *    selection range, finds **, removes them.
 *
 *  Case B — selection INCLUDES the markers:
 *    user manually selects **hello** → selectedText starts and ends with **,
 *    removes the outer markers from the selected text.
 */
function toggleInlineMarker(marker: string): Command {
  return (view) => {
    const { state, dispatch } = view;

    const changes = state.changeByRange((range) => {
      const { from, to } = expandToWord(state, range.from, range.to);
      const len = marker.length;
      const selectedText = state.sliceDoc(from, to);

      // ── Case A: markers sit just outside the current selection ────────────
      const before = from >= len ? state.sliceDoc(from - len, from) : "";
      const after =
        to + len <= state.doc.length ? state.sliceDoc(to, to + len) : "";

      if (before === marker && after === marker) {
        return {
          changes: [
            { from: from - len, to: from, insert: "" },
            { from: to, to: to + len, insert: "" },
          ],
          range: EditorSelection.range(from - len, to - len),
        };
      }

      // ── Case B: selection itself is wrapped (user selected **hello**) ─────
      if (
        selectedText.startsWith(marker) &&
        selectedText.endsWith(marker) &&
        selectedText.length >= len * 2 + 1
      ) {
        const inner = selectedText.slice(len, selectedText.length - len);
        return {
          changes: { from, to, insert: inner },
          range: EditorSelection.range(from, from + inner.length),
        };
      }

      // ── Default: wrap with markers ────────────────────────────────────────
      return {
        changes: [
          { from, insert: marker },
          { from: to, insert: marker },
        ],
        range: EditorSelection.range(from + len, to + len),
      };
    });

    dispatch(
      state.update(changes, { scrollIntoView: true, userEvent: "input" }),
    );
    return true;
  };
}

/** Cmd+B — toggle **bold** */
export const toggleBold: Command = toggleInlineMarker("**");

/** Cmd+I — toggle *italic* */
export const toggleItalic: Command = toggleInlineMarker("*");

/**
 * Cmd+L — wrap selection (or the word under the cursor) as [text]() and
 * place the cursor inside the parens ready to type the URL.
 * If the cursor is not on a word, inserts a bare []() template.
 */
export const insertLink: Command = (view) => {
  const { state, dispatch } = view;

  const changes = state.changeByRange((range) => {
    // Expand to word under cursor when there is no selection
    const { from, to } = expandToWord(state, range.from, range.to);
    const selectedText = state.sliceDoc(from, to);

    if (selectedText.length === 0) {
      // No word found — insert bare template, cursor between [ and ]
      const insert = "[]()";
      return {
        changes: { from, to, insert },
        range: EditorSelection.cursor(from + 1),
      };
    }

    const insert = `[${selectedText}]()`;
    // Position cursor inside the () ready to type the URL
    const cursorPos = from + insert.length - 1;
    return {
      changes: { from, to, insert },
      range: EditorSelection.cursor(cursorPos),
    };
  });

  dispatch(state.update(changes, { scrollIntoView: true, userEvent: "input" }));
  return true;
};
