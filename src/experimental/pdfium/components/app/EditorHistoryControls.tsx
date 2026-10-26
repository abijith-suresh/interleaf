import EditorButton from "./ui/EditorButton";

export interface EditorHistoryActions {
  undoLabel?: string;
  redoLabel?: string;
  busy?: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export default function EditorHistoryControls(props: EditorHistoryActions) {
  return (
    <fieldset class="editor-history-controls" aria-label="Edit history">
      <EditorButton
        variant="plain"
        icon="undo"
        iconOnly
        aria-label={props.undoLabel ? `Undo ${props.undoLabel}` : "Undo"}
        aria-keyshortcuts="Control+Z Meta+Z"
        title={props.undoLabel ? `Undo ${props.undoLabel}` : "Nothing to undo"}
        disabled={props.busy || !props.undoLabel}
        onClick={props.onUndo}
      />
      <EditorButton
        variant="plain"
        icon="redo"
        iconOnly
        aria-label={props.redoLabel ? `Redo ${props.redoLabel}` : "Redo"}
        aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y"
        title={props.redoLabel ? `Redo ${props.redoLabel}` : "Nothing to redo"}
        disabled={props.busy || !props.redoLabel}
        onClick={props.onRedo}
      />
    </fieldset>
  );
}
