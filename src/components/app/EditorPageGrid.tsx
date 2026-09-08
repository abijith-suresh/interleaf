import { For } from "solid-js";
import type { PageState } from "../../types/interfaces";
import EditorPageTile from "./EditorPageTile";

interface DragOverTarget {
  index: number;
  direction: "before" | "after";
}

interface Props {
  busy: boolean;
  pages: PageState[];
  selectedIndices: Set<number>;
  dragSourceIndex: number | null;
  dragOverTarget: DragOverTarget | null;
  onPageClick: (index: number) => void;
  onPageRotate: (index: number, e: MouseEvent) => void;
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
    <div ref={scrollContainer} class="flex-1 overflow-y-auto p-4">
      <div
        role="listbox"
        aria-multiselectable="true"
        aria-label="PDF pages"
        aria-busy={props.busy}
        data-testid="editor-page-grid"
        class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-3 items-start"
      >
        <For each={props.pages}>
          {(page, index) => (
            <EditorPageTile
              page={page}
              index={index()}
              selected={props.selectedIndices.has(index())}
              isDragSource={props.dragSourceIndex === index()}
              dragOverDirection={
                props.dragOverTarget?.index === index() ? props.dragOverTarget.direction : null
              }
              busy={props.busy}
              scrollRoot={scrollContainer}
              onClick={() => props.onPageClick(index())}
              onRotate={(e) => props.onPageRotate(index(), e)}
              onDragStart={(e) => props.onDragStart(index(), e)}
              onDragOver={props.onDragOver}
              onDragEnter={(e) => props.onDragEnter(index(), e)}
              onDragLeave={props.onDragLeave}
              onDrop={(e) => props.onDrop(index(), e)}
              onDragEnd={props.onDragEnd}
            />
          )}
        </For>
      </div>
    </div>
  );
}
