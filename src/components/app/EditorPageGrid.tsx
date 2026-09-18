import { For } from "solid-js";
import type { PDFRuntime } from "../../services/pdf-runtime";
import type { PageState } from "../../types/interfaces";
import EditorPageTile from "./EditorPageTile";

interface DragOverTarget {
  index: number;
  direction: "before" | "after";
}

interface Props {
  busy: boolean;
  pages: PageState[];
  runtime: PDFRuntime;
  selectedIndices: Set<number>;
  dragSourceIndex: number | null;
  dragOverTarget: DragOverTarget | null;
  onPageClick: (index: number) => void;
  onClearSelection: () => void;
  onPageKeyDown: (index: number, e: KeyboardEvent) => void;
  onPageRotate: (index: number, e: MouseEvent) => void;
  onPageDelete: (index: number, e: MouseEvent) => void;
  onDragStart: (index: number, e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDragEnter: (index: number, e: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (index: number, e: DragEvent) => void;
  onDragEnd: () => void;
}

export default function EditorPageGrid(props: Props) {
  let scrollContainer!: HTMLDivElement;

  return (
    <div ref={scrollContainer} class="editor-page-scroll">
      <p id="editor-page-grid-help" class="sr-only">
        Select a page. Hold Alt and press the left or right arrow key to move it.
      </p>
      <ul
        aria-label="Pages"
        aria-describedby="editor-page-grid-help"
        aria-busy={props.busy}
        data-testid="editor-page-grid"
        class="editor-page-grid"
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onClearSelection();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            props.onClearSelection();
          }
        }}
      >
        <For each={props.pages}>
          {(page, index) => (
            <EditorPageTile
              page={page}
              runtime={props.runtime}
              index={index()}
              selected={props.selectedIndices.has(index())}
              isDragSource={props.dragSourceIndex === index()}
              dragOverDirection={
                props.dragOverTarget?.index === index() ? props.dragOverTarget.direction : null
              }
              busy={props.busy}
              scrollRoot={scrollContainer}
              onClick={() => props.onPageClick(index())}
              onKeyDown={(e) => props.onPageKeyDown(index(), e)}
              onRotate={(e) => props.onPageRotate(index(), e)}
              onDelete={(e) => props.onPageDelete(index(), e)}
              onDragStart={(e) => props.onDragStart(index(), e)}
              onDragOver={props.onDragOver}
              onDragEnter={(e) => props.onDragEnter(index(), e)}
              onDragLeave={props.onDragLeave}
              onDrop={(e) => props.onDrop(index(), e)}
              onDragEnd={props.onDragEnd}
            />
          )}
        </For>
      </ul>
    </div>
  );
}
