import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { history, defaultKeymap, historyKeymap } from "@codemirror/commands";
import { keymap, placeholder, EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

import { interleafTheme } from "./theme";
import { interleafSyntaxHighlighting } from "./syntax";
import { toggleBold, toggleItalic, insertLink } from "./utils/commands";
import { renderHeadings } from "./decorations/headings";
import { renderEmphasis } from "./decorations/emphasis";
import { renderInlineCode } from "./decorations/inline-code";
import { renderLinks } from "./decorations/links";
import { renderHorizontalRules } from "./decorations/hr";
import { renderBlockquotes } from "./decorations/blockquotes";
import { renderLists } from "./decorations/lists";
import { renderCodeBlocks } from "./decorations/code-blocks";

export interface InterleafExtensionOptions {
  onChange: (value: string) => void;
}

/**
 * Assembles all CodeMirror extensions for the interleaf markdown editor.
 * Returns a flat Extension array ready to pass to EditorState.create().
 */
export function createInterleafExtensions(
  opts: InterleafExtensionOptions,
): Extension[] {
  return [
    // ── Language & parsing ────────────────────────────────────────────────
    markdown({ extensions: [GFM] }),

    // ── Visual theme & syntax colours ─────────────────────────────────────
    interleafTheme,
    interleafSyntaxHighlighting,

    // ── Editor behaviour ──────────────────────────────────────────────────
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ spellcheck: "true" }),
    placeholder("Start writing…"),

    // ── History (undo/redo) ───────────────────────────────────────────────
    history(),

    // ── Keybindings ───────────────────────────────────────────────────────
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      { key: "Mod-b", run: toggleBold },
      { key: "Mod-i", run: toggleItalic },
      { key: "Mod-l", run: insertLink },
    ]),

    // ── Bear-style markdown decorations ───────────────────────────────────
    renderHeadings,
    renderEmphasis,
    renderInlineCode,
    renderLinks,
    renderHorizontalRules, // StateField — block-level
    renderBlockquotes,
    renderLists,
    renderCodeBlocks,

    // ── Save callback ─────────────────────────────────────────────────────
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        opts.onChange(update.state.doc.toString());
      }
    }),
  ];
}
