import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { ROTATION_STEP } from "../../constants";
import {
  areAllPagesSelected,
  createPageStates,
  type DeletionAction,
  getDeletionAction,
  remapSelectionAfterMove,
  toggleSelectAll,
  toggleSelection,
} from "../../controllers/editor-page-state";
import { pdfOperationsService } from "../../services/pdf-operations-service";
import { pdfService } from "../../services/pdf-service";
import type { PageState } from "../../types/interfaces";
import { PDFPasswordRequiredError } from "../../types/interfaces";
import { downloadPDF } from "../../utils/download";
import { promptForPassword } from "../../utils/password-prompt";
import {
  showToast as dispatchToast,
  getToastDismissTimeout,
  TOAST_EVENT_NAME,
  type ToastDetail,
} from "../../utils/toast";
import EditorPageGrid from "./EditorPageGrid";
import EditorSidebar from "./EditorSidebar";
import EditorWorkflowStart from "./EditorWorkflowStart";

interface DragOverTarget {
  index: number;
  direction: "before" | "after";
}

type EditorOperation = "idle" | "uploading" | "adding" | "extracting" | "building";
type ToastTone = "success" | "error" | "info";

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

const deletionActionCopy: Record<DeletionAction, { label: string; ariaLabel: string }> = {
  mark: {
    label: "Mark for deletion",
    ariaLabel: "Mark selected pages for deletion",
  },
  restore: {
    label: "Restore from deletion",
    ariaLabel: "Restore selected pages from deletion",
  },
  toggle: {
    label: "Toggle deletion",
    ariaLabel: "Toggle deletion for selected pages",
  },
};

export default function Editor() {
  const base = import.meta.env.BASE_URL;
  let nextToastId = 0;
  const toastTimers = new Map<number, number>();

  const [phase, setPhase] = createSignal<"upload" | "edit">("upload");
  const [pages, setPages] = createStore<PageState[]>([]);
  const [selectedIndices, setSelectedIndices] = createSignal<Set<number>>(new Set<number>());
  const [dragSourceIndex, setDragSourceIndex] = createSignal<number | null>(null);
  const [dragOverTarget, setDragOverTarget] = createSignal<DragOverTarget | null>(null);
  const [operation, setOperation] = createSignal<EditorOperation>("idle");
  const [statusMessage, setStatusMessage] = createSignal("Drop a PDF to begin");
  const [toasts, setToasts] = createSignal<Toast[]>([]);

  onMount(() => {
    pdfService.reset();
    pdfOperationsService.clearCache();
  });

  const activePageCount = () => pages.filter((p) => !p.markedForDeletion).length;
  const isBusy = () => operation() !== "idle";
  const allPagesSelected = () => areAllPagesSelected(pages.length, selectedIndices());
  const selectedDeletionAction = () => getDeletionAction(pages, selectedIndices());
  const deletionCopy = () => deletionActionCopy[selectedDeletionAction()];
  const selectAllLabel = () => (allPagesSelected() ? "Deselect all" : "Select all");
  const selectedPageIndex = () => {
    if (selectedIndices().size !== 1) return null;
    return Array.from(selectedIndices())[0] ?? null;
  };

  function setReadyStatus() {
    setOperation("idle");
    setStatusMessage(phase() === "edit" ? "Ready" : "Drop a PDF to begin");
  }

  function dismissToast(id: number) {
    const timer = toastTimers.get(id);
    if (timer) {
      window.clearTimeout(timer);
      toastTimers.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }

  function addToast(message: string, tone: ToastTone) {
    const id = ++nextToastId;
    const timer = window.setTimeout(() => dismissToast(id), getToastDismissTimeout());
    toastTimers.set(id, timer);
    setToasts((current) => [...current, { id, message, tone }]);
  }

  const handleToast = (event: Event) => {
    const customEvent = event as CustomEvent<ToastDetail>;
    addToast(customEvent.detail.message, customEvent.detail.type);
  };

  if (typeof document !== "undefined") {
    document.addEventListener(TOAST_EVENT_NAME, handleToast);
  }

  onCleanup(() => {
    if (typeof document !== "undefined") {
      document.removeEventListener(TOAST_EVENT_NAME, handleToast);
    }
    for (const timer of toastTimers.values()) {
      window.clearTimeout(timer);
    }
    toastTimers.clear();
    pdfService.reset();
    pdfOperationsService.clearCache();
  });

  function formatPageCount(pageCount: number) {
    return `${pageCount} page${pageCount === 1 ? "" : "s"}`;
  }

  function getLoadErrorMessage(file: File, error: unknown) {
    if (error instanceof Error && error.message) {
      return `Failed to load ${file.name}: ${error.message}`;
    }
    return `Failed to load ${file.name}.`;
  }

  async function unlockPdf(file: File, isRetry: boolean): Promise<number | null> {
    const password = await promptForPassword(file.name, isRetry);
    if (password === null) {
      setReadyStatus();
      return null;
    }

    setStatusMessage("Unlocking PDF…");

    try {
      await pdfService.loadPDFWithPassword(file, password);
      return pdfService.getPageCount();
    } catch (err) {
      if (err instanceof PDFPasswordRequiredError) {
        return unlockPdf(file, true);
      }
      dispatchToast(getLoadErrorMessage(file, err), "error");
      setReadyStatus();
      return null;
    }
  }

  async function loadPdfFile(file: File, mode: "upload" | "add"): Promise<number | null> {
    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
      dispatchToast("Please upload a valid PDF file.", "error");
      return null;
    }

    setOperation(mode === "upload" ? "uploading" : "adding");
    setStatusMessage(mode === "upload" ? "Loading PDF…" : "Adding PDF…");

    try {
      await pdfService.loadPDF(file);
      return pdfService.getPageCount();
    } catch (err) {
      if (err instanceof PDFPasswordRequiredError) {
        return unlockPdf(file, err.reason === "wrong-password");
      }
      dispatchToast(getLoadErrorMessage(file, err), "error");
      setReadyStatus();
      return null;
    }
  }

  // --- File loading ---

  function handleFileLoaded(file: File, pageCount: number): void {
    setPages(createPageStates(file, pageCount));
    setSelectedIndices(new Set<number>());
    setPhase("edit");
    setReadyStatus();
    setStatusMessage(`${file.name} loaded with ${formatPageCount(pageCount)}.`);
  }

  async function handleAddPdf(file: File): Promise<void> {
    if (isBusy()) return;

    const pageCount = await loadPdfFile(file, "add");
    if (pageCount === null) return;

    setPages(
      produce((draftPages) => {
        draftPages.push(...createPageStates(file, pageCount));
      })
    );

    setReadyStatus();
    setStatusMessage(`Added ${formatPageCount(pageCount)} from ${file.name}.`);
  }

  async function handleInitialUpload(file: File): Promise<void> {
    if (isBusy()) return;

    const pageCount = await loadPdfFile(file, "upload");
    if (pageCount === null) return;

    handleFileLoaded(file, pageCount);
  }

  // --- Selection ---

  function handlePageClick(index: number): void {
    if (isBusy()) return;
    setSelectedIndices((previousSelection) => toggleSelection(previousSelection, index));
  }

  function clearSelection(): void {
    if (isBusy() || selectedIndices().size === 0) return;
    setSelectedIndices(new Set<number>());
    setStatusMessage("Selection cleared.");
  }

  function handleSelectAll(): void {
    if (isBusy()) return;
    setSelectedIndices((previousSelection) => toggleSelectAll(pages.length, previousSelection));
  }

  // --- Rotation ---

  function handlePageRotate(index: number, e: MouseEvent): void {
    e.stopPropagation();
    if (isBusy()) return;
    setPages(index, "rotation", (r) => (r + ROTATION_STEP) % 360);
    setStatusMessage(`Rotated page ${index + 1}.`);
  }

  function handleRotateSelected(): void {
    if (isBusy() || selectedIndices().size === 0) return;
    for (const index of selectedIndices()) {
      setPages(index, "rotation", (r) => (r + ROTATION_STEP) % 360);
    }
    setStatusMessage(
      `Rotated ${selectedIndices().size} selected page${selectedIndices().size === 1 ? "" : "s"}.`
    );
  }

  // --- Delete ---

  function handleDeleteSelected(): void {
    if (isBusy() || selectedIndices().size === 0) return;
    for (const index of selectedIndices()) {
      setPages(index, "markedForDeletion", (v) => !v);
    }
    setStatusMessage(
      `Updated deletion state for ${selectedIndices().size} selected page${selectedIndices().size === 1 ? "" : "s"}.`
    );
  }

  // --- Extract / Download ---

  async function handleExtract(): Promise<void> {
    if (isBusy()) return;
    const indices = Array.from(selectedIndices()).sort((a, b) => a - b);
    if (indices.length === 0) return;

    setOperation("extracting");
    setStatusMessage(`Extracting pages… 0/${indices.length}`);

    try {
      const result = await pdfOperationsService.buildPDFFromSubset(
        pages,
        indices,
        ({ completed, total }) => {
          setStatusMessage(`Extracting pages… ${completed}/${total}`);
        }
      );
      downloadPDF(result);
      setStatusMessage("Extracted PDF download started.");
    } catch (_err) {
      dispatchToast("Failed to extract selected pages.", "error");
    } finally {
      setReadyStatus();
    }
  }

  async function handleDownload(): Promise<void> {
    if (isBusy()) return;
    const totalPages = activePageCount();

    setOperation("building");
    setStatusMessage(`Building PDF… 0/${totalPages}`);

    try {
      const result = await pdfOperationsService.buildPDF(pages, ({ completed, total }) => {
        setStatusMessage(`Building PDF… ${completed}/${total}`);
      });
      downloadPDF(result);
      setStatusMessage("Download started.");
    } catch (_err) {
      dispatchToast("Failed to build the PDF.", "error");
    } finally {
      setReadyStatus();
    }
  }

  // --- Drag and drop ---

  function handleDragStart(index: number, e: DragEvent): void {
    if (isBusy()) return;
    setDragSourceIndex(index);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  }

  function movePage(from: number, to: number): void {
    if (from === to || from < 0 || to < 0 || from >= pages.length || to >= pages.length) return;

    setPages(
      produce((currentPages) => {
        const [moved] = currentPages.splice(from, 1);
        currentPages.splice(to, 0, moved);
      })
    );
    setSelectedIndices((previousSelection) => remapSelectionAfterMove(previousSelection, from, to));
    setStatusMessage(`Moved page ${from + 1} to position ${to + 1}.`);
  }

  function handlePageKeyDown(index: number, e: KeyboardEvent): void {
    if (isBusy() || !e.altKey) return;

    if (e.key === "ArrowLeft" && index > 0) {
      e.preventDefault();
      movePage(index, index - 1);
    } else if (e.key === "ArrowRight" && index < pages.length - 1) {
      e.preventDefault();
      movePage(index, index + 1);
    }
  }

  function moveSelectedPage(direction: "earlier" | "later"): void {
    if (isBusy()) return;

    const index = selectedPageIndex();
    if (index === null) return;

    const target = direction === "earlier" ? index - 1 : index + 1;
    movePage(index, target);
  }

  function canMoveSelectedPage(direction: "earlier" | "later"): boolean {
    const index = selectedPageIndex();
    if (index === null) return false;

    return direction === "earlier" ? index > 0 : index < pages.length - 1;
  }

  function handleDragOver(e: DragEvent): void {
    if (isBusy()) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  }

  function handleDragEnter(targetIndex: number, e: DragEvent): void {
    if (isBusy()) return;
    e.preventDefault();
    const from = dragSourceIndex();
    if (from === null) return;
    if (from < targetIndex) {
      setDragOverTarget({ index: targetIndex, direction: "after" });
    } else if (from > targetIndex) {
      setDragOverTarget({ index: targetIndex, direction: "before" });
    }
  }

  function handleDragLeave(): void {
    if (isBusy()) return;
    setDragOverTarget(null);
  }

  function handleDrop(targetIndex: number, e: DragEvent): void {
    if (isBusy()) return;
    e.preventDefault();
    setDragOverTarget(null);

    const from = dragSourceIndex();
    if (from === null || from === targetIndex) {
      setDragSourceIndex(null);
      return;
    }
    const to = targetIndex;

    movePage(from, to);

    setDragSourceIndex(null);
  }

  function handleDragEnd(): void {
    setDragSourceIndex(null);
    setDragOverTarget(null);
  }

  return (
    <div class="editor-app">
      <section
        data-testid="editor-toast-region"
        aria-label="Notifications"
        aria-live="polite"
        aria-atomic="true"
        class="editor-toast-region"
      >
        <For each={toasts()}>
          {(toast) => (
            <div data-testid="editor-toast" class={`editor-toast editor-toast-${toast.tone}`}>
              {toast.message}
            </div>
          )}
        </For>
      </section>

      <div
        data-testid="editor-root"
        data-operation={operation()}
        data-phase={phase()}
        aria-busy={isBusy()}
        class="contents"
      >
        <header class="editor-header">
          <div class="editor-header-left">
            <a href={base} class="editor-brand" translate="no">
              interleaf
            </a>
            <Show when={phase() === "edit"}>
              <span class="editor-header-divider" aria-hidden="true" />
              <div class="editor-document-meta">
                <span class="editor-document-context">PDF workspace</span>
                <span class="editor-header-count">{formatPageCount(pages.length)}</span>
              </div>
            </Show>
          </div>
          <h1 class="sr-only">Interleaf PDF editor</h1>
          <div class="editor-header-right">
            <a href={base} class="editor-back" aria-label="Return to Interleaf home">
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M8 4 3 10l5 6M4 10h13" />
              </svg>
              <span class="editor-back-wide">Back</span>
              <span class="editor-back-compact">Exit</span>
            </a>
          </div>
        </header>

        <Show
          when={phase() === "edit"}
          fallback={
            <EditorWorkflowStart
              busy={isBusy()}
              statusMessage={statusMessage()}
              onFileSelected={handleInitialUpload}
            />
          }
        >
          <div class="editor-workspace">
            <EditorSidebar
              busy={isBusy()}
              selectedCount={selectedIndices().size}
              activePageCount={activePageCount()}
              allPagesSelected={allPagesSelected()}
              deletionLabel={deletionCopy().label}
              deletionAriaLabel={deletionCopy().ariaLabel}
              onSelectAll={handleSelectAll}
              onRotate={handleRotateSelected}
              onDelete={handleDeleteSelected}
              onExtract={handleExtract}
              onDownload={handleDownload}
              onAddPdf={handleAddPdf}
            />

            <section class="editor-workspace-main" aria-label="PDF workspace">
              <EditorPageGrid
                busy={isBusy()}
                pages={pages}
                selectedIndices={selectedIndices()}
                dragSourceIndex={dragSourceIndex()}
                dragOverTarget={dragOverTarget()}
                onPageClick={handlePageClick}
                onClearSelection={clearSelection}
                onPageKeyDown={handlePageKeyDown}
                onPageRotate={handlePageRotate}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onDragEnd={handleDragEnd}
              />

              <div class="editor-mobile-toolbar" role="toolbar" aria-label="Page actions">
                <div class="editor-mobile-primary-actions">
                  <button
                    type="button"
                    data-testid="editor-select-all-button-mobile"
                    disabled={isBusy()}
                    onClick={handleSelectAll}
                    aria-label={`${selectAllLabel()} pages`}
                    class="editor-toolbar-action"
                  >
                    {selectAllLabel()}
                  </button>
                  <button
                    type="button"
                    data-testid="editor-add-pdf-button-mobile"
                    disabled={isBusy()}
                    onClick={() => {
                      if (isBusy()) return;
                      const input = document.createElement("input");
                      input.type = "file";
                      input.accept = "application/pdf";
                      input.name = "additional-pdf-mobile";
                      input.setAttribute("aria-label", "Choose an additional PDF");
                      input.onchange = () => {
                        const file = input.files?.[0];
                        if (file) handleAddPdf(file);
                      };
                      input.click();
                    }}
                    class="editor-toolbar-action"
                  >
                    Add PDF
                  </button>
                </div>
                <details class="editor-mobile-more" open={selectedIndices().size > 0}>
                  <summary class="editor-mobile-more-trigger">
                    <span>Page actions</span>
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <path d="m5 7.5 5 5 5-5" />
                    </svg>
                  </summary>
                  <div class="editor-mobile-actions">
                    <Show when={selectedIndices().size === 1}>
                      <button
                        type="button"
                        data-testid="editor-move-earlier-button-mobile"
                        disabled={isBusy() || !canMoveSelectedPage("earlier")}
                        onClick={() => moveSelectedPage("earlier")}
                        aria-label="Move selected page earlier"
                        class="editor-toolbar-action"
                      >
                        Move earlier
                      </button>
                      <button
                        type="button"
                        data-testid="editor-move-later-button-mobile"
                        disabled={isBusy() || !canMoveSelectedPage("later")}
                        onClick={() => moveSelectedPage("later")}
                        aria-label="Move selected page later"
                        class="editor-toolbar-action"
                      >
                        Move later
                      </button>
                    </Show>
                    <button
                      type="button"
                      data-testid="editor-rotate-button-mobile"
                      disabled={isBusy() || selectedIndices().size === 0}
                      onClick={handleRotateSelected}
                      class="editor-toolbar-action"
                    >
                      Rotate
                    </button>
                    <button
                      type="button"
                      data-testid="editor-delete-button-mobile"
                      disabled={isBusy() || selectedIndices().size === 0}
                      onClick={handleDeleteSelected}
                      aria-label={deletionCopy().ariaLabel}
                      class="editor-toolbar-action editor-toolbar-action-danger"
                    >
                      {deletionCopy().label}
                    </button>
                    <button
                      type="button"
                      data-testid="editor-extract-button-mobile"
                      disabled={isBusy() || selectedIndices().size === 0}
                      onClick={handleExtract}
                      class="editor-toolbar-action"
                    >
                      Extract
                    </button>
                  </div>
                </details>
                <button
                  type="button"
                  data-testid="editor-download-button-mobile"
                  disabled={isBusy() || activePageCount() === 0}
                  onClick={handleDownload}
                  class="editor-download-action editor-mobile-download"
                >
                  {isBusy() ? "Working…" : "Download"}
                </button>
              </div>

              <div
                role="status"
                aria-live="polite"
                aria-atomic="true"
                data-testid="editor-status-bar"
                class="sr-only"
              >
                {pages.length} pages ({activePageCount()} active).{" "}
                <span data-testid="editor-status-message">{statusMessage()}</span>
              </div>
            </section>
          </div>
        </Show>
      </div>
    </div>
  );
}
