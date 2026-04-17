import { EditorView } from "@codemirror/view";

/**
 * CodeMirror EditorView theme that matches interleaf's warm editorial aesthetic.
 * Resets CM6's default chrome and inherits the app's CSS variables.
 */
export const interleafTheme = EditorView.theme({
  // Root editor element — transparent background, no border/outline
  "&": {
    background: "transparent",
    outline: "none",
    height: "100%",
    fontSize: "17px",
    fontFamily: "var(--font-serif)",
  },

  // The contenteditable region
  ".cm-content": {
    fontFamily: "var(--font-serif)",
    fontSize: "17px",
    lineHeight: "1.8",
    color: "var(--color-text-primary)",
    caretColor: "var(--color-accent)",
    padding: "2rem",
    maxWidth: "720px",
    margin: "0 auto",
  },

  // Cursor
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--color-accent)",
    borderLeftWidth: "2px",
  },

  // Text selection
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
    {
      backgroundColor:
        "color-mix(in srgb, var(--color-accent) 18%, transparent) !important",
    },

  // Remove the focus ring CM6 adds
  "&.cm-focused": {
    outline: "none",
  },

  // Scrollable area — match the app's thin scrollbar
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "var(--font-serif)",
  },

  // Placeholder text
  ".cm-placeholder": {
    color: "var(--color-text-tertiary)",
    fontStyle: "italic",
  },

  // Remove gutters (line numbers etc.)
  ".cm-gutters": {
    display: "none",
  },

  // Active line — very subtle highlight so the cursor line is identifiable
  ".cm-activeLine": {
    backgroundColor: "color-mix(in srgb, var(--color-accent) 4%, transparent)",
  },

  // Matched bracket highlighting
  ".cm-matchingBracket": {
    backgroundColor: "color-mix(in srgb, var(--color-accent) 15%, transparent)",
    outline: "none",
  },
});
