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
 * Link decoration plugin.
 *
 * For Markdown links of the form [label](url):
 *  - Hides the opening `[`
 *  - Hides from the closing `]` through the end of `(url)` (i.e. `](url)`)
 *  - Leaves only the label text visible, styled with .cm-link
 *
 * Applied only when the cursor is not on that line.
 */
function buildLinkDecorations(view: EditorView): DecorationSet {
  const widgets: Range<Decoration>[] = [];
  const hiddenDeco = Decoration.replace({});

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== "Link") return;
        if (lineContainsCursor(view.state, node.from, node.to)) return false;

        // LinkMark children: [ ] ( )
        const marks = node.node.getChildren("LinkMark");

        // A proper inline link has at least 3 marks: [, ], (
        // (Reference-style links have fewer — skip those)
        if (marks.length < 3) return false;

        const openBracket = marks[0]; // [
        const closeBracket = marks[1]; // ]
        const closeNode = node.node; // the whole Link node ends at )

        if (!openBracket || !closeBracket) return false;

        // Guard: don't hide an empty label — that would collapse the whole link
        if (openBracket.to === closeBracket.from) return false;

        // Hide the `[` character
        widgets.push(hiddenDeco.range(openBracket.from, openBracket.to));

        // Hide `](url)` — from the `]` to the end of the Link node
        widgets.push(hiddenDeco.range(closeBracket.from, closeNode.to));

        return false; // don't recurse
      },
    });
  }

  return Decoration.set(widgets, true);
}

export const renderLinks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildLinkDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildLinkDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
