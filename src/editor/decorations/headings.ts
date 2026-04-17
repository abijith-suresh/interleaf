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
 * Heading decoration plugin.
 *
 * For each ATXHeading node:
 *  1. Always applies a `.cm-heading-N` LINE decoration so the entire line
 *     gets the correct font size via CSS (regardless of cursor position).
 *  2. When the cursor is NOT on that line, hides the HeaderMark (the `#` chars
 *     + trailing space) so only the heading text is visible.
 */
function buildHeadingDecorations(view: EditorView): DecorationSet {
  const widgets: Range<Decoration>[] = [];
  const hiddenDeco = Decoration.replace({});

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        if (!node.name.startsWith("ATXHeading")) return;

        // Determine heading level from node name (ATXHeading1 … ATXHeading6)
        const level = parseInt(node.name.slice(10), 10);
        if (isNaN(level)) return;

        const levelClass = Math.min(level, 4); // h4-h6 share .cm-heading-4
        const line = view.state.doc.lineAt(node.from);

        // 1. Line-level class for font sizing — always applied
        widgets.push(
          Decoration.line({
            class: `cm-heading cm-heading-${levelClass}`,
          }).range(line.from),
        );

        // 2. Hide the HeaderMark + its trailing space when cursor is elsewhere
        if (!lineContainsCursor(view.state, node.from, node.to)) {
          const mark = node.node.getChild("HeaderMark");
          if (mark) {
            // Also consume the space between the mark and the heading text
            const afterMark = view.state.sliceDoc(mark.to, mark.to + 1);
            const extraSpace = afterMark === " " ? 1 : 0;
            widgets.push(hiddenDeco.range(mark.from, mark.to + extraSpace));
          }
        }

        return false; // don't recurse into children
      },
    });
  }

  // Line decorations must come before inline ones — sort by from position,
  // with line decorations (point ranges) first.
  return Decoration.set(widgets, true);
}

export const renderHeadings = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildHeadingDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildHeadingDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
