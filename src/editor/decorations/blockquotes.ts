import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { Range } from "@codemirror/state";
import { lineContainsCursor } from "../utils/cursor";

/**
 * Blockquote decoration plugin.
 *
 * For each Blockquote node:
 *  1. Always applies a `.cm-blockquote-line` LINE decoration to every line
 *     of the blockquote — this gives the left-border styling via CSS.
 *  2. When the cursor is NOT on a given line, hides the QuoteMark (`>` + space)
 *     on that line so only the quoted text is visible.
 */
function buildBlockquoteDecorations(view: EditorView): DecorationSet {
  const widgets: Range<Decoration>[] = [];
  const hiddenDeco = Decoration.replace({});

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== "Blockquote") return;

        // Walk through every QuoteMark in this blockquote
        const quoteMarks = node.node.getChildren("QuoteMark");

        for (const mark of quoteMarks) {
          const line = view.state.doc.lineAt(mark.from);

          // 1. Line decoration — always present for left-border styling
          widgets.push(
            Decoration.line({ class: "cm-blockquote-line" }).range(line.from),
          );

          // 2. Hide the `> ` marker when cursor is not on this line
          if (!lineContainsCursor(view.state, mark.from, mark.to)) {
            // Also consume the trailing space after the `>`
            const afterMark = view.state.sliceDoc(mark.to, mark.to + 1);
            const extraSpace = afterMark === " " ? 1 : 0;
            widgets.push(hiddenDeco.range(mark.from, mark.to + extraSpace));
          }
        }

        return false; // don't recurse into nested blockquotes separately
      },
    });
  }

  return Decoration.set(widgets, true);
}

export const renderBlockquotes = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildBlockquoteDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildBlockquoteDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
