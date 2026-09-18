import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
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
import EditorFilesDialog from "./EditorFilesDialog";
import type { EditorWorkspaceFile } from "./EditorFilesDialog";
import EditorPageGrid from "./EditorPageGrid";
import EditorSelectionBar from "./EditorSelectionBar";
import EditorUploader from "./EditorUploader";

interface DragOverTarget {
  index: number;
  direction: "before" | "after";
}

type EditorOperation = "idle" | "uploading" | "adding" | "building";
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
    label: "Restore",
    ariaLabel: "Restore selected pages",
  },
};

export default function Editor() {
  const base = import.meta.env.BASE_URL;
  let addPdfInput!: HTMLInputElement;
  let filesButton!: HTMLButtonElement;
  let nextToastId = 0;
  const toastTimers = new Map<number, number>();

  const [phase, setPhase] = createSignal<"upload" | "edit">("upload");
  const [pages, setPages] = createStore<PageState[]>([]);
  const [selectedIndices, setSelectedIndices] = createSignal<Set<number>>(new Set<number>());
  const [dragSourceIndex, setDragSourceIndex] = createSignal<number | null>(null);
  const [dragOverTarget, setDragOverTarget] = createSignal<DragOverTarget | null>(null);
  const [filesOpen, setFilesOpen] = createSignal(false);
  const [operation, setOperation] = createSignal<EditorOperation>("idle");
  const [statusMessage, setStatusMessage] = createSignal("Drop a PDF to begin");
  const [toasts, setToasts] = createSignal<Toast[]>([]);

  onMount(() => {
    pdfService.reset();
    pdfOperationsService.clearCache();
  });

  const activePageCount = () => pages.filter((p) => !p.markedForDeletion).length;
  const selectedActivePageCount = () =>
    Array.from(selectedIndices()).filter((index) => !pages[index]?.markedForDeletion).length;
  const isBusy = () => operation() !== "idle";
  const allPagesSelected = () => areAllPagesSelected(pages.length, selectedIndices());
  const selectedDeletionAction = () => getDeletionAction(pages, selectedIndices());
  const deletionCopy = () => deletionActionCopy[selectedDeletionAction()];

  const workspaceFiles = createMemo<EditorWorkspaceFile[]>(() => {
    const groups = new Map<File, EditorWorkspaceFile>();

    pages.forEach((page) => {
      let workspaceFile = groups.get(page.sourceFile);
      if (!workspaceFile) {
        workspaceFile = {
          file: page.sourceFile,
          pageCount: 0,
        };
        groups.set(page.sourceFile, workspaceFile);
      }

      workspaceFile.pageCount += 1;
    });

    return Array.from(groups.values());
  });
  const filesButtonLabel = () =>
    `Open ${workspaceFiles().length} file${workspaceFiles().length === 1 ? "" : "s"}`;

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

  function requestAddPdf(): void {
    if (isBusy()) return;
    setFilesOpen(false);
    addPdfInput.click();
  }

  function handleAddPdfInput(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    void handleAddPdf(file);
  }

  function closeFilesDialog(): void {
    setFilesOpen(false);
    queueMicrotask(() => filesButton?.focus());
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
    const nextSelection = toggleSelection(selectedIndices(), index);
    setSelectedIndices(nextSelection);
    setStatusMessage(`${nextSelection.has(index) ? "Selected" : "Deselected"} page ${index + 1}.`);
  }

  function clearSelection(): void {
    if (isBusy() || selectedIndices().size === 0) return;
    setSelectedIndices(new Set<number>());
    setStatusMessage("Selection cleared.");
  }

  function handleWorkspaceFileClick(file: File): void {
    if (isBusy()) return;

    const nextSelection = new Set<number>();
    pages.forEach((page, index) => {
      if (page.sourceFile === file) nextSelection.add(index);
    });

    if (nextSelection.size === 0) return;
    setSelectedIndices(nextSelection);
    closeFilesDialog();
    setStatusMessage(`Selected ${formatPageCount(nextSelection.size)} from ${file.name}.`);
  }

  function handleSelectAll(): void {
    if (isBusy()) return;
    const nextSelection = toggleSelectAll(pages.length, selectedIndices());
    setSelectedIndices(nextSelection);
    setStatusMessage(
      nextSelection.size === pages.length ? "All pages selected." : "Selection cleared."
    );
  }

  // --- Rotation ---

  function handlePageRotate(index: number, e: MouseEvent): void {
    e.stopPropagation();
    if (isBusy()) return;
    setPages(index, "rotation", (r) => (r + ROTATION_STEP) % 360);
    setStatusMessage(`Rotated page ${index + 1}.`);
  }

  function handlePageDelete(index: number, e: MouseEvent): void {
    e.stopPropagation();
    if (isBusy()) return;

    const markedForDeletion = pages[index]?.markedForDeletion ?? false;
    setPages(index, "markedForDeletion", !markedForDeletion);
    setStatusMessage(
      markedForDeletion
        ? `Restored page ${index + 1} from deletion.`
        : `Marked page ${index + 1} for deletion.`
    );
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
    const action = selectedDeletionAction();
    const markForDeletion = action === "mark";

    for (const index of selectedIndices()) {
      setPages(index, "markedForDeletion", markForDeletion);
    }
    setStatusMessage(
      `${markForDeletion ? "Marked" : "Restored"} ${selectedIndices().size} selected page${selectedIndices().size === 1 ? "" : "s"} ${markForDeletion ? "for deletion" : "from deletion"}.`
    );
  }

  async function handleDownload(): Promise<void> {
    if (isBusy()) return;
    const selection = selectedIndices();
    const selectedPageIndices =
      selection.size > 0 ? Array.from(selection).sort((a, b) => a - b) : undefined;
    const totalPages = selectedPageIndices ? selectedActivePageCount() : activePageCount();

    setOperation("building");
    setStatusMessage(
      `${selectedPageIndices ? "Building selected PDF" : "Building PDF"}… 0/${totalPages}`
    );

    try {
      const result = await pdfOperationsService.buildPDF(pages, {
        selectedIndices: selectedPageIndices,
        onProgress: ({ completed, total }) => {
          setStatusMessage(
            `${selectedPageIndices ? "Building selected PDF" : "Building PDF"}… ${completed}/${total}`
          );
        },
      });
      downloadPDF(result);
      setStatusMessage("Export started.");
    } catch (_err) {
      dispatchToast("Failed to build the PDF.", "error");
      setStatusMessage("Export failed. Try again.");
    } finally {
      setOperation("idle");
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
            <EditorUploader
              busy={isBusy()}
              statusMessage={statusMessage()}
              onFileSelected={handleInitialUpload}
            />
          }
        >
          <div class="editor-workspace">
            <section class="editor-workspace-main" aria-labelledby="editor-pages-title">
              <input
                ref={addPdfInput}
                data-testid="editor-add-pdf-input"
                type="file"
                accept="application/pdf"
                name="additional-pdf"
                aria-label="Choose an additional PDF"
                class="hidden"
                disabled={isBusy()}
                onChange={handleAddPdfInput}
              />
              <div class="editor-canvas-header">
                <h2 id="editor-pages-title">Pages</h2>
                <div class="editor-canvas-tools">
                  <span class="editor-canvas-count">{formatPageCount(pages.length)}</span>
                  <div class="editor-canvas-actions">
                    <button
                      type="button"
                      data-testid="editor-add-pdf-button"
                      aria-label="Add another PDF"
                      onClick={requestAddPdf}
                      disabled={isBusy()}
                      class="editor-add-pdf"
                    >
                      <svg viewBox="0 0 20 20" aria-hidden="true">
                        <path d="M10 4v12M4 10h12" />
                      </svg>
                      <span class="editor-add-pdf-label">Add PDF</span>
                    </button>
                    <button
                      ref={filesButton}
                      type="button"
                      data-testid="editor-files-button"
                      class="editor-toolbar-action editor-files-button"
                      aria-label={filesButtonLabel()}
                      aria-controls="editor-files-dialog"
                      aria-expanded={filesOpen()}
                      title={filesButtonLabel()}
                      onClick={() => setFilesOpen(true)}
                      disabled={isBusy()}
                    >
                      <svg viewBox="0 0 20 20" aria-hidden="true">
                        <path d="M5 2.5h6l4 4v11H5zM11 2.5v4h4" />
                      </svg>
                      <span class="editor-files-button-label">Files</span>
                      <span class="editor-files-button-count">{workspaceFiles().length}</span>
                    </button>
                  </div>
                </div>
              </div>

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
                onPageDelete={handlePageDelete}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onDragEnd={handleDragEnd}
              />

              <EditorSelectionBar
                busy={isBusy()}
                busyLabel={statusMessage()}
                selectedCount={selectedIndices().size}
                selectedActiveCount={
                  selectedIndices().size > 0 ? selectedActivePageCount() : activePageCount()
                }
                allPagesSelected={allPagesSelected()}
                deletionLabel={deletionCopy().label}
                deletionAriaLabel={deletionCopy().ariaLabel}
                onSelectAll={handleSelectAll}
                onClearSelection={clearSelection}
                onRotate={handleRotateSelected}
                onDelete={handleDeleteSelected}
                onDownload={handleDownload}
              />

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
            <EditorFilesDialog
              open={filesOpen()}
              busy={isBusy()}
              files={workspaceFiles()}
              onClose={closeFilesDialog}
              onSelectFile={handleWorkspaceFileClick}
            />
          </div>
        </Show>
      </div>
    </div>
  );
}
