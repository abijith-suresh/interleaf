import { createEffect, on, onCleanup, onMount } from "solid-js";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createInterleafExtensions } from "@/editor";

type CodeMirrorEditorProps = {
  /** Current raw markdown value */
  value: string;
  /** Increments when the active note changes — triggers a full doc reset */
  resetToken: string;
  /** Increments when the editor should receive focus */
  focusToken: number;
  /** Called on every keystroke with the updated raw markdown string */
  onChange: (value: string) => void;
};

/**
 * Thin SolidJS wrapper around CodeMirror 6.
 *
 * Responsibilities:
 *  - Mount an EditorView into the container div on onMount
 *  - Reset the document when resetToken changes (note switch)
 *  - Forward focus requests via focusToken
 *  - Destroy the view on cleanup
 */
export default function CodeMirrorEditor(props: CodeMirrorEditorProps) {
  let containerRef: HTMLDivElement | undefined;
  let editorView: EditorView | undefined;

  onMount(() => {
    const state = EditorState.create({
      doc: props.value,
      extensions: createInterleafExtensions({
        onChange: (value) => props.onChange(value),
      }),
    });

    editorView = new EditorView({
      state,
      parent: containerRef!,
    });
  });

  // When the note changes (resetToken = note ID), replace the full document.
  // Using `on` with defer=false so the initial value is set by onMount above.
  createEffect(
    on(
      () => props.resetToken,
      (token, prevToken) => {
        if (!editorView || token === prevToken) return;

        const currentDoc = editorView.state.doc.toString();
        if (currentDoc === props.value) return;

        editorView.dispatch({
          changes: {
            from: 0,
            to: editorView.state.doc.length,
            insert: props.value,
          },
          // Move cursor to the start of the new document
          selection: { anchor: 0 },
        });
      },
      { defer: true },
    ),
  );

  // Forward focus requests from AppShell's focusToken pattern
  createEffect(
    on(
      () => props.focusToken,
      () => {
        if (!editorView) return;
        queueMicrotask(() => {
          editorView?.focus();
        });
      },
      { defer: true },
    ),
  );

  onCleanup(() => {
    editorView?.destroy();
    editorView = undefined;
  });

  return (
    <div
      ref={containerRef}
      class="min-h-0 flex-1 overflow-y-auto"
      aria-label="Note editor"
    />
  );
}
