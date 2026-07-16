import type { PageState } from "../../types/interfaces";
import EditorPageCanvas from "./EditorPageCanvas";

interface Props {
  page: PageState;
  index: number;
  busy: boolean;
  selected: boolean;
  isDragSource: boolean;
  dragOverDirection: "before" | "after" | null;
  scrollRoot: HTMLDivElement;
  onClick: () => void;
  onRotate: (e: MouseEvent) => void;
  onDragStart: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDragEnter: (e: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent) => void;
  onDragEnd: () => void;
}

export default function EditorPageTile(props: Props) {
  const tileClass = () => {
    const classes = ["editor-page"];
    if (props.selected) classes.push("selected");
    if (props.page.markedForDeletion) classes.push("marked-deleted");
    if (props.isDragSource) classes.push("dragging");
    if (props.dragOverDirection === "before") classes.push("drag-insert-before");
    if (props.dragOverDirection === "after") classes.push("drag-insert-after");
    return classes.join(" ");
  };

  return (
    <div
      role="application"
      data-page-index={props.index}
      data-source-page={props.page.sourcePageNumber}
      data-selected={props.selected}
      data-marked-for-deletion={props.page.markedForDeletion}
      class={tileClass()}
      draggable={!props.busy}
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDragEnter={props.onDragEnter}
      onDragLeave={props.onDragLeave}
      onDrop={props.onDrop}
      onDragEnd={props.onDragEnd}
    >
      <button
        type="button"
        data-testid="editor-page-tile"
        data-page-index={props.index}
        data-source-page={props.page.sourcePageNumber}
        data-selected={props.selected}
        data-marked-for-deletion={props.page.markedForDeletion}
        class="editor-page-hitarea"
        role="option"
        aria-selected={props.selected}
        aria-label={
          props.page.markedForDeletion
            ? `Page ${props.index + 1}, marked for deletion`
            : `Page ${props.index + 1}`
        }
        disabled={props.busy}
        onClick={props.onClick}
      >
        <EditorPageCanvas
          page={props.page}
          rotation={props.page.rotation}
          scrollRoot={props.scrollRoot}
        />
      </button>
      <div class="page-controls">
        <span class="page-label">Page {props.index + 1}</span>
        <button
          type="button"
          data-testid="editor-page-rotate-button"
          class="btn-page-rotate"
          title="Rotate 90°"
          aria-hidden="true"
          tabIndex={-1}
          disabled={props.busy}
          onClick={props.onRotate}
        >
          &#x21BB;
        </button>
      </div>
    </div>
  );
}
