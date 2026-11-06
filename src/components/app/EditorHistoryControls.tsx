import { Show } from "solid-js";
import EditorButton from "./ui/EditorButton";

interface Props {
  undoLabel?: string;
  redoLabel?: string;
  unavailable: boolean;
  /** Explains why available history is temporarily unavailable. */
  blockedReason?: string;
  onUndo: () => void;
  onRedo: () => void;
}

const BLOCKED_ID = "editor-history-blocked";

export default function EditorHistoryControls(props: Props) {
  const title = (verb: string, label?: string) =>
    label ? (props.blockedReason ?? `${verb} ${label}`) : `Nothing to ${verb.toLowerCase()}`;
  const describedBy = (label?: string) => (label && props.blockedReason ? BLOCKED_ID : undefined);
  return (
    <fieldset class="editor-history-controls" aria-label="Workspace history">
      <EditorButton
        data-testid="editor-undo-button"
        variant="plain"
        icon="undo"
        aria-label={props.undoLabel ? `Undo ${props.undoLabel}` : "Nothing to undo"}
        aria-keyshortcuts="Control+Z Meta+Z"
        aria-describedby={describedBy(props.undoLabel)}
        title={title("Undo", props.undoLabel)}
        aria-disabled={props.unavailable || !props.undoLabel}
        onClick={props.onUndo}
      />
      <EditorButton
        data-testid="editor-redo-button"
        variant="plain"
        icon="redo"
        aria-label={props.redoLabel ? `Redo ${props.redoLabel}` : "Nothing to redo"}
        aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y"
        aria-describedby={describedBy(props.redoLabel)}
        title={title("Redo", props.redoLabel)}
        aria-disabled={props.unavailable || !props.redoLabel}
        onClick={props.onRedo}
      />
      <Show when={props.blockedReason}>
        <span id={BLOCKED_ID} class="sr-only">
          {props.blockedReason}
        </span>
      </Show>
    </fieldset>
  );
}
