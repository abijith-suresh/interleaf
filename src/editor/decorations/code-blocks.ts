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
 * Fenced code block decoration plugin.
 *
 * For each FencedCode node:
 *  1. Applies `.cm-code-block-line` to every line inside the block
 *     (including fence lines) for the tinted monospace background styling.
 *  2. When the cursor is NOT anywhere inside the block, hides:
 *     - The opening CodeMark (``` + optional language tag)
 *     - The closing CodeMark (```)
 */
function buildCodeBlockDecorations(view: EditorView): DecorationSet {
  const widgets: Range<Decoration>[] = [];
  const hiddenDeco = Decoration.replace({});

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== "FencedCode") return;

        const cursorInBlock = lineContainsCursor(
          view.state,
          node.from,
          node.to,
        );

        // 1. Apply line class to every line of the code block
        let pos = node.from;
        while (pos <= node.to) {
          const line = view.state.doc.lineAt(pos);
          widgets.push(
            Decoration.line({ class: "cm-code-block-line" }).range(line.from),
          );
          if (line.to >= node.to) break;
          pos = line.to + 1;
        }

        // 2. Hide fences + CodeInfo when cursor is outside the block
        if (!cursorInBlock) {
          const codeMarks = node.node.getChildren("CodeMark");
          const codeInfos = node.node.getChildren("CodeInfo");

          for (const mark of codeMarks) {
            // Hide the entire fence line: mark + newline
            const line = view.state.doc.lineAt(mark.from);
            widgets.push(hiddenDeco.range(line.from, line.to + 1));
          }
          for (const info of codeInfos) {
            widgets.push(hiddenDeco.range(info.from, info.to));
          }
        }

        return false; // don't recurse into CodeText
      },
    });
  }

  return Decoration.set(widgets, true);
}

export const renderCodeBlocks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildCodeBlockDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildCodeBlockDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
