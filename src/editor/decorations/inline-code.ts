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
 * Inline code decoration plugin.
 *
 * Hides the backtick CodeMark characters surrounding an InlineCode span when
 * the cursor is not on that line. The .cm-monospace CSS class (from the
 * HighlightStyle) handles the monospace visual styling of the code content.
 */
function buildInlineCodeDecorations(view: EditorView): DecorationSet {
  const widgets: Range<Decoration>[] = [];
  const hiddenDeco = Decoration.replace({});

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== "InlineCode") return;
        if (lineContainsCursor(view.state, node.from, node.to)) return;

        const marks = node.node.getChildren("CodeMark");
        for (const mark of marks) {
          widgets.push(hiddenDeco.range(mark.from, mark.to));
        }
      },
    });
  }

  return Decoration.set(widgets, true);
}

export const renderInlineCode = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildInlineCodeDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildInlineCodeDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
