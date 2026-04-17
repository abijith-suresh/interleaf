import {
  WidgetType,
  Decoration,
  type DecorationSet,
  EditorView,
} from "@codemirror/view";
import { StateField } from "@codemirror/state";
import type { Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { lineContainsCursor } from "../utils/cursor";

/**
 * Widget that renders a styled <hr> element in place of a HorizontalRule node.
 */
class HrWidget extends WidgetType {
  toDOM(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-hr-widget";
    const hr = document.createElement("hr");
    wrapper.append(hr);
    return wrapper;
  }
  eq(_other: HrWidget): boolean {
    return true; // All HR widgets are identical
  }
  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * StateField (block decoration) — must scan the full document because <hr>
 * is a block-level replacement that spans line boundaries.
 *
 * Replaces `---` / `***` / `___` HorizontalRule nodes with an <hr> widget
 * when the cursor is not on that line.
 */
export const renderHorizontalRules = StateField.define<DecorationSet>({
  create(state) {
    return buildHrDecorations(state);
  },
  update(deco, tr) {
    return buildHrDecorations(tr.state);
  },
  provide: (f) => EditorView.decorations.from(f),
});

function buildHrDecorations(state: EditorView["state"]): DecorationSet {
  const widgets: Range<Decoration>[] = [];

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "HorizontalRule") return;
      if (lineContainsCursor(state, node.from, node.to)) return;

      widgets.push(
        Decoration.replace({
          widget: new HrWidget(),
          block: true,
        }).range(node.from, node.to),
      );
    },
  });

  return Decoration.set(widgets, true);
}
