import { createMemo, createSignal, For } from "solid-js";
import { gridNavigationTarget } from "../../controllers/editor-page-state";
import type { PDFRuntime } from "../../services/pdf-runtime";
import type { PageState } from "../../types/interfaces";
import EditorPageTile from "./EditorPageTile";

const NAVIGATION_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]);

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
  onPageDuplicate: (index: number, e: MouseEvent) => void;
  onDragStart: (index: number, e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDragEnter: (index: number, e: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (index: number, e: DragEvent) => void;
  onDragEnd: () => void;
  onTouchDragStart: (index: number, y: number) => void;
  onTouchDragMove: (x: number, y: number) => void;
  onTouchDragEnd: () => void;
  onTouchDragCancel: () => void;
}

export default function EditorPageGrid(props: Props) {
  let scrollContainer!: HTMLDivElement;
  let grid!: HTMLUListElement;
  // Roving tabindex: the last focused page is the grid's only tab stop.
  const [focusedPageId, setFocusedPageId] = createSignal<string | null>(null);
  const tabStopId = createMemo(() => {
    const id = focusedPageId();
    return props.pages.some((page) => page.id === id) ? id : (props.pages[0]?.id ?? null);
  });

  function columnCount(): number {
    const template = getComputedStyle(grid).gridTemplateColumns;
    if (!template || template === "none") return 1;
    return template.split(/\s+/).filter(Boolean).length;
  }

  function handleTileKeyDown(index: number, event: KeyboardEvent): void {
    const modified = event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
    if (modified || !NAVIGATION_KEYS.has(event.key)) {
      props.onPageKeyDown(index, event);
      return;
    }
    // At an edge the key still belongs to the grid, so it never scrolls the page.
    event.preventDefault();
    const target = gridNavigationTarget(event.key, index, props.pages.length, columnCount());
    if (target === null) return;
    grid
      .querySelector<HTMLButtonElement>(
        `[data-testid="editor-page-tile"][data-page-index="${target}"]`
      )
      ?.focus();
  }

  return (
    <div ref={scrollContainer} class="editor-page-scroll">
      <p id="editor-page-grid-help" class="sr-only">
        Use the arrow keys to move between pages, or Home and End to jump to the first or last page.
        Press Space to select a page, R to rotate it, or Delete to mark it for deletion. Press Tab
        to reach its duplicate, delete, and rotate buttons. Hold Alt and press the left or right
        arrow key to move it.
      </p>
      <ul
        ref={grid}
        aria-label="Pages"
        aria-busy={props.busy}
        data-testid="editor-page-grid"
        class="editor-page-grid"
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onClearSelection();
        }}
        onFocusIn={(e) => {
          const row = (e.target as HTMLElement).closest<HTMLElement>("li[data-page-index]");
          const page = row ? props.pages[Number(row.dataset.pageIndex)] : undefined;
          if (page) setFocusedPageId(page.id);
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
              tabStop={page.id === tabStopId()}
              isDragSource={props.dragSourceIndex === index()}
              dragOverDirection={
                props.dragOverTarget?.index === index() ? props.dragOverTarget.direction : null
              }
              busy={props.busy}
              scrollRoot={scrollContainer}
              onClick={() => props.onPageClick(index())}
              onKeyDown={(e) => handleTileKeyDown(index(), e)}
              onRotate={(e) => props.onPageRotate(index(), e)}
              onDelete={(e) => props.onPageDelete(index(), e)}
              onDuplicate={(e) => props.onPageDuplicate(index(), e)}
              onDragStart={(e) => props.onDragStart(index(), e)}
              onDragOver={props.onDragOver}
              onDragEnter={(e) => props.onDragEnter(index(), e)}
              onDragLeave={props.onDragLeave}
              onDrop={(e) => props.onDrop(index(), e)}
              onDragEnd={props.onDragEnd}
              onTouchDragStart={props.onTouchDragStart}
              onTouchDragMove={props.onTouchDragMove}
              onTouchDragEnd={props.onTouchDragEnd}
              onTouchDragCancel={props.onTouchDragCancel}
            />
          )}
        </For>
      </ul>
    </div>
  );
}
