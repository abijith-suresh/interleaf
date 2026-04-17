import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

/**
 * Maps lezer syntax tags → CSS class names that are defined in index.css.
 * This drives the visual rendering of markdown elements (heading sizes,
 * bold, italic, code, etc.) independently of the decoration plugins that
 * hide the raw syntax characters.
 */
export const interleafHighlightStyle = HighlightStyle.define([
  // ── Headings ────────────────────────────────────────────────────────────
  { tag: tags.heading1, class: "cm-heading cm-heading-1" },
  { tag: tags.heading2, class: "cm-heading cm-heading-2" },
  { tag: tags.heading3, class: "cm-heading cm-heading-3" },
  { tag: tags.heading4, class: "cm-heading cm-heading-4" },
  { tag: tags.heading5, class: "cm-heading cm-heading-4" },
  { tag: tags.heading6, class: "cm-heading cm-heading-4" },

  // ── Inline formatting ────────────────────────────────────────────────────
  { tag: tags.strong, class: "cm-strong" },
  { tag: tags.emphasis, class: "cm-emphasis" },
  { tag: tags.strikethrough, class: "cm-strikethrough" },

  // ── Code ────────────────────────────────────────────────────────────────
  { tag: tags.monospace, class: "cm-monospace" },

  // ── Links ───────────────────────────────────────────────────────────────
  { tag: tags.link, class: "cm-link" },
  { tag: tags.url, class: "cm-url" },

  // ── Blockquote ──────────────────────────────────────────────────────────
  { tag: tags.quote, class: "cm-blockquote-text" },

  // ── Markdown syntax characters (# marks, **, *, backticks, >, ---)
  //    These are visible on the cursor line — keep them muted.
  { tag: tags.processingInstruction, class: "cm-formatting" }, // ``` fences
  { tag: tags.contentSeparator, class: "cm-formatting" }, // --- hr
]);

export const interleafSyntaxHighlighting = syntaxHighlighting(
  interleafHighlightStyle,
);
