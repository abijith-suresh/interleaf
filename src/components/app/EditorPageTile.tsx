import type { PDFRuntime } from "../../services/pdf-runtime";
import type { PageState } from "../../types/interfaces";
import EditorPageCanvas from "./EditorPageCanvas";

interface Props {
  page: PageState;
  runtime: PDFRuntime;
  index: number;
  busy: boolean;
  selected: boolean;
  isDragSource: boolean;
  dragOverDirection: "before" | "after" | null;
  scrollRoot: HTMLDivElement;
  onClick: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
  onRotate: (e: MouseEvent) => void;
  onDelete: (e: MouseEvent) => void;
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
    <li
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
      <div class="editor-page-preview">
        <EditorPageCanvas
          page={props.page}
          runtime={props.runtime}
          rotation={props.page.rotation}
          scrollRoot={props.scrollRoot}
        />
        <button
          type="button"
          data-testid="editor-page-tile"
          data-page-index={props.index}
          data-source-page={props.page.sourcePageNumber}
          data-selected={props.selected}
          data-marked-for-deletion={props.page.markedForDeletion}
          class="editor-page-hitarea"
          aria-pressed={props.selected}
          aria-label={
            props.page.markedForDeletion
              ? `Page ${props.index + 1}, marked for deletion`
              : `Page ${props.index + 1}`
          }
          aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
          disabled={props.busy}
          onClick={props.onClick}
          onKeyDown={props.onKeyDown}
        />
      </div>
      <div class="page-controls">
        <span class="page-label" aria-hidden="true">
          {props.index + 1}
        </span>
        <span class="page-action-buttons">
          <button
            type="button"
            data-testid="editor-page-delete-button"
            class="btn-page-delete"
            classList={{ "is-marked": props.page.markedForDeletion }}
            title={props.page.markedForDeletion ? "Restore page" : "Mark page for deletion"}
            aria-label={
              props.page.markedForDeletion
                ? `Restore page ${props.index + 1} from deletion`
                : `Mark page ${props.index + 1} for deletion`
            }
            aria-pressed={props.page.markedForDeletion}
            disabled={props.busy}
            draggable={false}
            onClick={props.onDelete}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path
                d={
                  props.page.markedForDeletion
                    ? "M4 8.5a6 6 0 1 1 2 4.5M4 8.5V4.5M4 8.5h4"
                    : "M4.5 6.5h11M8 6.5V4h4v2.5M6.5 8.5v6m3.5-6v6m3.5-6v6M5.5 6.5l.5 10h8l.5-10"
                }
              />
            </svg>
          </button>
          <button
            type="button"
            data-testid="editor-page-rotate-button"
            class="btn-page-rotate"
            title="Rotate 90°"
            aria-label={`Rotate page ${props.index + 1} 90 degrees`}
            disabled={props.busy}
            draggable={false}
            onClick={props.onRotate}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M15.5 7A6 6 0 1 0 16 11M15.5 7V3.5M15.5 7H12" />
            </svg>
          </button>
        </span>
      </div>
    </li>
  );
}
