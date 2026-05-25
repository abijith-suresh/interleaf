import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { ROTATION_STEP } from "../../constants";
import type { PageState } from "../../types/interfaces";
import { PDFPasswordRequiredError } from "../../types/interfaces";
import { pdfService } from "../../services/pdf-service";
import { pdfOperationsService } from "../../services/pdf-operations-service";
import {
  createPageStates,
  remapSelectionAfterMove,
  toggleSelectAll,
  toggleSelection,
} from "../../controllers/editor-page-state";
import { downloadPDF } from "../../utils/download";
import { promptForPassword } from "../../utils/password-prompt";
import {
  getToastDismissTimeout,
  showToast as dispatchToast,
  TOAST_EVENT_NAME,
  type ToastDetail,
} from "../../utils/toast";
import EditorUploader from "./EditorUploader";
import EditorSidebar from "./EditorSidebar";
import EditorPageGrid from "./EditorPageGrid";

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

    setStatusMessage("Unlocking PDF...");

    try {
      await pdfService.loadPDFWithPassword(file, password);
      return pdfService.getPageCount();
    } catch (err) {
      if (err instanceof PDFPasswordRequiredError) {
        return unlockPdf(file, true);
      }

      console.error("Failed to unlock PDF:", err);
      dispatchToast(getLoadErrorMessage(file, err), "error");
      setReadyStatus();
      return null;
    }
  }

  async function loadPdfFile(file: File, mode: "upload" | "add"): Promise<number | null> {
    if (file.type !== "application/pdf") {
      dispatchToast("Please upload a valid PDF file.", "error");
      return null;
    }

    setOperation(mode === "upload" ? "uploading" : "adding");
    setStatusMessage(mode === "upload" ? "Loading PDF..." : "Adding PDF...");

    try {
      await pdfService.loadPDF(file);
      return pdfService.getPageCount();
    } catch (err) {
      if (err instanceof PDFPasswordRequiredError) {
        return unlockPdf(file, err.reason === "wrong-password");
      }

      console.error("Failed to load PDF:", err);
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
    dispatchToast(`${file.name} loaded with ${formatPageCount(pageCount)}.`, "success");
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
    dispatchToast(`Added ${formatPageCount(pageCount)} from ${file.name}.`, "success");
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
    setStatusMessage(`Extracting pages... 0/${indices.length}`);

    try {
      const result = await pdfOperationsService.buildPDFFromSubset(
        pages,
        indices,
        ({ completed, total }) => {
          setStatusMessage(`Extracting pages... ${completed}/${total}`);
        }
      );
      downloadPDF(result);
      dispatchToast("Extracted PDF download started.", "success");
    } catch (err) {
      console.error("Failed to extract pages:", err);
      dispatchToast("Failed to extract selected pages.", "error");
    } finally {
      setReadyStatus();
    }
  }

  async function handleDownload(): Promise<void> {
    if (isBusy()) return;
    const totalPages = activePageCount();

    setOperation("building");
    setStatusMessage(`Building PDF... 0/${totalPages}`);

    try {
      const result = await pdfOperationsService.buildPDF(pages, ({ completed, total }) => {
        setStatusMessage(`Building PDF... ${completed}/${total}`);
      });
      downloadPDF(result);
      dispatchToast("Download started.", "success");
    } catch (err) {
      console.error("Failed to build PDF:", err);
      dispatchToast("Failed to build the PDF.", "error");
    } finally {
      setReadyStatus();
    }
  }

  // --- Drag and drop ---

  function handleDragStart(index: number, e: DragEvent): void {
    if (isBusy()) return;
    setDragSourceIndex(index);
    e.dataTransfer!.effectAllowed = "move";
  }

  function handleDragOver(e: DragEvent): void {
    if (isBusy()) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = "move";
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

    setPages(
      produce((p) => {
        const [moved] = p.splice(from, 1);
        p.splice(to, 0, moved);
      })
    );

    // Remap selection indices after reorder
    setSelectedIndices((previousSelection) => remapSelectionAfterMove(previousSelection, from, to));

    setDragSourceIndex(null);
  }

  function handleDragEnd(): void {
    setDragSourceIndex(null);
    setDragOverTarget(null);
  }

  return (
    <div class="font-body bg-white text-primary h-dvh flex flex-col overflow-hidden">
      <div
        data-testid="editor-toast-region"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        class="pointer-events-none fixed right-4 top-4 z-50 flex max-w-sm flex-col gap-2"
      >
        <For each={toasts()}>
          {(toast) => (
            <div
              data-testid="editor-toast"
              class={`rounded-sm border px-4 py-3 text-sm shadow-sm ${
                toast.tone === "error"
                  ? "border-toast-error-border bg-toast-error-bg text-toast-error-text"
                  : toast.tone === "success"
                    ? "border-toast-success-border bg-toast-success-bg text-toast-success-text"
                    : "border-border bg-white text-body"
              }`}
            >
              {toast.message}
            </div>
          )}
        </For>
      </div>

      <div
        data-testid="editor-root"
        data-operation={operation()}
        aria-busy={isBusy()}
        class="contents"
      >
        {/* Dark header */}
        <header class="bg-primary text-white h-14 flex items-center px-6 flex-shrink-0">
          <a href={base} class="font-display text-2xl tracking-wide text-white no-underline">
            Interleaf
          </a>
          <span class="w-px h-6 bg-body mx-5" />
          <Show when={phase() === "edit"}>
            <span class="text-sm text-muted">
              {pages.length} pages ({activePageCount()} active)
            </span>
          </Show>
          <span class="flex-1" />
          <Show when={phase() === "edit" && selectedIndices().size > 0}>
            <span class="text-sm text-muted">{selectedIndices().size} selected</span>
            <span class="w-px h-6 bg-body mx-5" />
          </Show>
          <a href={base} class="text-sm text-muted hover:text-white no-underline transition-colors">
            &#8592; Back
          </a>
        </header>

        {/* Content — upload or edit */}
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
          <div class="flex h-[calc(100dvh-3.5rem)] min-h-0">
            <EditorSidebar
              busy={isBusy()}
              selectedCount={selectedIndices().size}
              onSelectAll={handleSelectAll}
              onRotate={handleRotateSelected}
              onDelete={handleDeleteSelected}
              onExtract={handleExtract}
              onDownload={handleDownload}
              onAddPdf={handleAddPdf}
            />

            <main class="flex-1 flex flex-col min-h-0">
              {/* Dense page grid — only this scrolls */}
              <EditorPageGrid
                busy={isBusy()}
                pages={pages}
                selectedIndices={selectedIndices()}
                dragSourceIndex={dragSourceIndex()}
                dragOverTarget={dragOverTarget()}
                onPageClick={handlePageClick}
                onPageRotate={handlePageRotate}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onDragEnd={handleDragEnd}
              />

              {/* Mobile toolbar */}
              <div class="md:hidden border-t border-border p-2.5 flex items-center gap-2 flex-wrap justify-center">
                <button
                  data-testid="editor-select-all-button-mobile"
                  disabled={isBusy()}
                  onClick={handleSelectAll}
                  class="text-micro uppercase tracking-wider text-body bg-transparent border border-border px-3 py-1.5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
                >
                  Select All
                </button>
                <button
                  data-testid="editor-rotate-button-mobile"
                  disabled={isBusy()}
                  onClick={handleRotateSelected}
                  class="text-micro uppercase tracking-wider text-body bg-transparent border border-border px-3 py-1.5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
                >
                  Rotate
                </button>
                <button
                  data-testid="editor-delete-button-mobile"
                  disabled={isBusy()}
                  onClick={handleDeleteSelected}
                  class="text-micro uppercase tracking-wider text-accent bg-transparent border border-border px-3 py-1.5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
                >
                  Delete
                </button>
                <button
                  data-testid="editor-add-pdf-button-mobile"
                  disabled={isBusy()}
                  onClick={() => {
                    if (isBusy()) return;
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = "application/pdf";
                    input.onchange = () => {
                      const file = input.files?.[0];
                      if (file) handleAddPdf(file);
                    };
                    input.click();
                  }}
                  class="text-micro uppercase tracking-wider text-body bg-transparent border border-border px-3 py-1.5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
                >
                  Add PDF
                </button>
                <button
                  data-testid="editor-extract-button-mobile"
                  disabled={isBusy()}
                  onClick={handleExtract}
                  class="text-micro uppercase tracking-wider text-body bg-transparent border border-border px-3 py-1.5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
                >
                  Extract
                </button>
                <button
                  data-testid="editor-download-button-mobile"
                  disabled={isBusy()}
                  onClick={handleDownload}
                  class="text-micro uppercase tracking-wider bg-accent text-white border-none px-4 py-1.5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
                >
                  {isBusy() ? "Working..." : "Download"}
                </button>
              </div>

              {/* Status bar */}
              <div
                role="status"
                aria-live="polite"
                aria-atomic="true"
                data-testid="editor-status-bar"
                class="h-8 bg-hover border-t border-border flex items-center px-5 text-micro text-muted flex-shrink-0"
              >
                <span>
                  {pages.length} pages ({activePageCount()} active)
                </span>
                <span class="flex-1 text-center">
                  {selectedIndices().size > 0 ? `${selectedIndices().size} selected` : ""}
                </span>
                <span class="flex items-center gap-1.5" data-testid="editor-status-message">
                  <span class="w-1.5 h-1.5 bg-accent inline-block" />
                  {statusMessage()}
                </span>
              </div>
            </main>
          </div>
        </Show>
      </div>
    </div>
  );
}
