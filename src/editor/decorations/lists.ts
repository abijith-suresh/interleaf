import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { Range } from "@codemirror/state";
import { lineContainsCursor } from "../utils/cursor";

/**
 * Bullet widget — replaces a `-` / `*` / `+` list marker with a `•` glyph.
 */
class BulletWidget extends WidgetType {
  constructor(readonly indent: number) {
    super();
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-bullet";
    span.textContent = "•";
    span.style.paddingRight = "0.5em";
    return span;
  }
  eq(other: BulletWidget): boolean {
    return this.indent === other.indent;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * List decoration plugin.
 *
 * For BulletList items: replaces the `-` / `*` / `+` ListMark with a `•`
 * widget when the cursor is not on that line.
 * OrderedList markers (1. 2. etc.) are left as-is.
 */
function buildListDecorations(view: EditorView): DecorationSet {
  const widgets: Range<Decoration>[] = [];

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        // Only handle bullet lists (not ordered)
        if (node.name !== "ListItem") return;
        if (node.node.parent?.name !== "BulletList") return;

        const listMarks = node.node.getChildren("ListMark");
        for (const mark of listMarks) {
          if (lineContainsCursor(view.state, mark.from, mark.to)) continue;

          // Indent level: number of leading spaces on this line
          const line = view.state.doc.lineAt(mark.from);
          const indent = mark.from - line.from;

          widgets.push(
            Decoration.replace({
              widget: new BulletWidget(indent),
            }).range(mark.from, mark.to),
          );
        }
      },
    });
  }

  return Decoration.set(widgets, true);
}

export const renderLists = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildListDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildListDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
