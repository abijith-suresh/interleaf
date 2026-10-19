import EditorButton from "./ui/EditorButton";

interface Props {
  undoLabel?: string;
  redoLabel?: string;
  unavailable: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export default function EditorHistoryControls(props: Props) {
  return (
    <fieldset class="editor-history-controls" aria-label="Page organization history">
      <EditorButton
        data-testid="editor-undo-button"
        variant="plain"
        icon="undo"
        aria-label={props.undoLabel ? `Undo ${props.undoLabel}` : "Nothing to undo"}
        aria-keyshortcuts="Control+Z Meta+Z"
        title={props.undoLabel ? `Undo ${props.undoLabel}` : "Nothing to undo"}
        aria-disabled={props.unavailable || !props.undoLabel}
        onClick={props.onUndo}
      />
      <EditorButton
        data-testid="editor-redo-button"
        variant="plain"
        icon="redo"
        aria-label={props.redoLabel ? `Redo ${props.redoLabel}` : "Nothing to redo"}
        aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y"
        title={props.redoLabel ? `Redo ${props.redoLabel}` : "Nothing to redo"}
        aria-disabled={props.unavailable || !props.redoLabel}
        onClick={props.onRedo}
      />
    </fieldset>
  );
}
