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
 * Emphasis decoration plugin.
 *
 * Hides EmphasisMark tokens (**  /  *  /  ~~) for StrongEmphasis, Emphasis,
 * and Strikethrough nodes when the cursor is not on that line.
 * The underlying CSS classes (cm-strong, cm-emphasis, cm-strikethrough) applied
 * by the HighlightStyle handle the visual rendering.
 */
function buildEmphasisDecorations(view: EditorView): DecorationSet {
  const widgets: Range<Decoration>[] = [];
  const hiddenDeco = Decoration.replace({});

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        const name = node.name;
        if (
          name !== "StrongEmphasis" &&
          name !== "Emphasis" &&
          name !== "Strikethrough"
        ) {
          return;
        }

        if (lineContainsCursor(view.state, node.from, node.to)) return;

        const markName =
          name === "Strikethrough" ? "StrikethroughMark" : "EmphasisMark";
        const marks = node.node.getChildren(markName);
        for (const mark of marks) {
          widgets.push(hiddenDeco.range(mark.from, mark.to));
        }
      },
    });
  }

  return Decoration.set(widgets, true);
}

export const renderEmphasis = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildEmphasisDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildEmphasisDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
