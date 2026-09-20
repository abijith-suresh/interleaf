import { Effect, Fiber } from "effect";
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
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
import { makePDFRuntime, PDFProcessing } from "../../services/pdf-runtime";
import { QpdfProcessingError } from "../../services/qpdf-processing";
import type { PageState } from "../../types/interfaces";
import { PDFPasswordRequiredError, PDFProcessingError } from "../../types/interfaces";
import { downloadFile, downloadPDF } from "../../utils/download";
import { getSupportedFileKind } from "../../utils/file-types";
import { promptForPassword } from "../../utils/password-prompt";
import {
  showToast as dispatchToast,
  getToastDismissTimeout,
  TOAST_EVENT_NAME,
  type ToastDetail,
} from "../../utils/toast";
import type { EditorWorkspaceFile } from "./EditorFilesDialog";
import EditorFilesDialog from "./EditorFilesDialog";
import EditorPageGrid from "./EditorPageGrid";
import EditorPageViewer from "./EditorPageViewer";
import EditorSelectionBar from "./EditorSelectionBar";
import EditorUploader from "./EditorUploader";

interface DragOverTarget {
  index: number;
  direction: "before" | "after";
}

type EditorOperation =
  | "idle"
  | "uploading"
  | "adding"
  | "building"
  | "exporting-images"
  | "compressing";
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
  let editorRoot!: HTMLDivElement;
  let filesButton!: HTMLButtonElement;
  let reviewButton!: HTMLButtonElement;
  let nextToastId = 0;
  let activeOperationFiber: Fiber.Fiber<unknown, unknown> | null = null;
  const toastTimers = new Map<number, number>();
  const pdfRuntime = makePDFRuntime();
  let disposed = false;

  const [phase, setPhase] = createSignal<"upload" | "edit">("upload");
  const [pages, setPages] = createStore<PageState[]>([]);
  const [selectedIndices, setSelectedIndices] = createSignal<Set<number>>(new Set<number>());
  const [dragSourceIndex, setDragSourceIndex] = createSignal<number | null>(null);
  const [dragOverTarget, setDragOverTarget] = createSignal<DragOverTarget | null>(null);
  const [filesOpen, setFilesOpen] = createSignal(false);
  const [reviewOpen, setReviewOpen] = createSignal(false);
  const [activePageId, setActivePageId] = createSignal<string | null>(null);
  const [operation, setOperation] = createSignal<EditorOperation>("idle");
  const [statusMessage, setStatusMessage] = createSignal(
    "PDF, PNG, and JPEG files stay on your device."
  );
  const [toasts, setToasts] = createSignal<Toast[]>([]);

  const activePageCount = () => pages.filter((p) => !p.markedForDeletion).length;
  const selectedActivePageCount = () =>
    Array.from(selectedIndices()).filter((index) => !pages[index]?.markedForDeletion).length;
  const isBusy = () => operation() !== "idle";
  const reviewPageIds = createMemo(() => {
    const selection = selectedIndices();
    return pages
      .filter((_, index) => selection.size === 0 || selection.has(index))
      .map((page) => page.id);
  });
  const allPagesSelected = () => areAllPagesSelected(pages.length, selectedIndices());
  const selectedDeletionAction = () => getDeletionAction(pages, selectedIndices());
  const deletionCopy = () => deletionActionCopy[selectedDeletionAction()];

  function getUnmodifiedSourceFile(): File | null {
    if (pages.length === 0 || selectedIndices().size > 0) return null;

    const sourceFile = pages[0]?.sourceFile;
    if (!sourceFile) return null;

    const isUnmodified = pages.every(
      (page, index) =>
        page.sourceFile === sourceFile &&
        page.sourcePageNumber === index + 1 &&
        page.rotation === 0 &&
        !page.markedForDeletion
    );

    return isUnmodified ? sourceFile : null;
  }

  function compressionDisabledReason(): string {
    if (selectedIndices().size > 0) {
      return "Clear page selection to compress the original PDF";
    }
    if (pages.length === 0 || activePageCount() === 0) {
      return "No active pages to compress";
    }
    return "Compression is available before page edits";
  }

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
    if (disposed) return;
    setOperation("idle");
    setStatusMessage(
      phase() === "edit" ? "Ready" : "PDF, PNG, and JPEG files stay on your device."
    );
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
    if (disposed) return;
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
    disposed = true;
    if (typeof document !== "undefined") {
      document.removeEventListener(TOAST_EVENT_NAME, handleToast);
    }
    for (const timer of toastTimers.values()) {
      window.clearTimeout(timer);
    }
    toastTimers.clear();
    const fiber = activeOperationFiber;
    activeOperationFiber = null;
    const interrupt = fiber
      ? Effect.runPromise(Fiber.interrupt(fiber)).catch(() => undefined)
      : Promise.resolve();
    void interrupt.then(() => pdfRuntime.dispose()).catch(() => undefined);
  });

  async function runPDF<A, E>(program: Effect.Effect<A, E, PDFProcessing>): Promise<A> {
    const fiber = pdfRuntime.runFork(program);
    activeOperationFiber = fiber;

    try {
      return await pdfRuntime.runPromise(Fiber.join(fiber));
    } finally {
      if (activeOperationFiber === fiber) {
        activeOperationFiber = null;
      }
    }
  }

  function formatPageCount(pageCount: number) {
    return `${pageCount} page${pageCount === 1 ? "" : "s"}`;
  }

  function formatFileSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function getLoadErrorMessage(file: File, error: unknown) {
    if (error instanceof Error && error.message) {
      return `Failed to load ${file.name}: ${error.message}`;
    }
    return `Failed to load ${file.name}.`;
  }

  async function unlockPdf(file: File, isRetry: boolean): Promise<number | null> {
    if (disposed) return null;
    const password = await promptForPassword(file.name, isRetry);
    if (disposed || password === null) {
      setReadyStatus();
      return null;
    }

    setStatusMessage("Unlocking PDF…");

    try {
      await runPDF(PDFProcessing.use((service) => service.loadPDFWithPassword(file, password)));
      if (disposed) return null;
      return await runPDF(PDFProcessing.use((service) => service.getPageCount));
    } catch (err) {
      if (disposed) return null;
      if (err instanceof PDFPasswordRequiredError) {
        return unlockPdf(file, true);
      }
      dispatchToast(getLoadErrorMessage(file, err), "error");
      setReadyStatus();
      return null;
    }
  }

  async function loadPdfFile(file: File, mode: "upload" | "add"): Promise<number | null> {
    if (disposed || getSupportedFileKind(file) !== "pdf") {
      if (disposed) return null;
      dispatchToast("Please upload a valid PDF file.", "error");
      return null;
    }

    setOperation(mode === "upload" ? "uploading" : "adding");
    setStatusMessage(mode === "upload" ? "Loading PDF…" : "Adding PDF…");

    try {
      await runPDF(PDFProcessing.use((service) => service.loadPDF(file)));
      if (disposed) return null;
      return await runPDF(PDFProcessing.use((service) => service.getPageCount));
    } catch (err) {
      if (disposed) return null;
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
    const nextPages = createPageStates(file, pageCount);
    setPages(nextPages);
    setSelectedIndices(new Set<number>());
    setActivePageId(nextPages[0]?.id ?? null);
    setReviewOpen(false);
    setPhase("edit");
    setReadyStatus();
    setStatusMessage(`${file.name} loaded with ${formatPageCount(pageCount)}.`);
  }

  async function handleAddPdf(file: File): Promise<boolean> {
    if (disposed || isBusy()) return false;

    const pageCount = await loadPdfFile(file, "add");
    if (pageCount === null) return false;

    const addedPages = createPageStates(file, pageCount);
    setPages(
      produce((draftPages) => {
        draftPages.push(...addedPages);
      })
    );
    if (!activePageId()) setActivePageId(addedPages[0]?.id ?? null);

    setReadyStatus();
    setStatusMessage(`Added ${formatPageCount(pageCount)} from ${file.name}.`);
    return true;
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

  function openPageReview(): void {
    if (isBusy()) return;
    const ids = reviewPageIds();
    if (ids.length === 0) return;

    const activeId = activePageId();
    if (!activeId || !ids.includes(activeId)) setActivePageId(ids[0]);
    setReviewOpen(true);
  }

  function closePageReview(): void {
    setReviewOpen(false);
    queueMicrotask(() => {
      if (reviewButton && !reviewButton.disabled) {
        reviewButton.focus();
      } else {
        editorRoot?.focus();
      }
    });
  }

  async function handleImagesToPdf(files: File[]): Promise<void> {
    if (disposed || isBusy()) return;

    setOperation("building");
    setStatusMessage(`Creating PDF from images… 0/${files.length}`);

    try {
      const result = await runPDF(
        PDFProcessing.use((service) =>
          service.imagesToPDF(files, {
            onProgress: ({ completed, total }) => {
              if (disposed) return;
              setStatusMessage(`Creating PDF from images… ${completed}/${total}`);
            },
          })
        )
      );
      if (disposed) return;

      const generatedBytes = new Uint8Array(new ArrayBuffer(result.data.byteLength));
      generatedBytes.set(result.data);
      const generatedFile = new File([generatedBytes], result.suggestedFileName, {
        type: "application/pdf",
      });
      const pageCount = await loadPdfFile(generatedFile, "upload");
      if (pageCount === null || disposed) return;

      handleFileLoaded(generatedFile, pageCount);
      setStatusMessage(`Created a PDF from ${files.length} image${files.length === 1 ? "" : "s"}.`);
    } catch (error) {
      if (disposed) return;
      const message =
        error instanceof PDFProcessingError
          ? error.message
          : "Failed to create a PDF from the selected images.";
      dispatchToast(message, "error");
      setReadyStatus();
      setStatusMessage("Image conversion failed. Try again.");
    } finally {
      if (!disposed) setOperation("idle");
    }
  }

  async function handleInitialFiles(files: File[]): Promise<void> {
    if (disposed || isBusy() || files.length === 0) return;

    const pdfFiles = files.filter((file) => getSupportedFileKind(file) === "pdf");
    const imageFiles = files.filter((file) => {
      const kind = getSupportedFileKind(file);
      return kind === "png" || kind === "jpeg";
    });
    const unsupportedFiles = files.filter((file) => getSupportedFileKind(file) === null);

    if (unsupportedFiles.length > 0 || (pdfFiles.length > 0 && imageFiles.length > 0)) {
      dispatchToast(
        "Choose PDF files or PNG/JPEG images at a time. You can add other files after opening the workspace.",
        "error"
      );
      return;
    }

    if (imageFiles.length > 0) {
      await handleImagesToPdf(imageFiles);
      return;
    }

    const [firstFile, ...additionalFiles] = pdfFiles;
    const pageCount = await loadPdfFile(firstFile, "upload");
    if (pageCount === null) return;

    handleFileLoaded(firstFile, pageCount);
    let loadedFileCount = 1;
    for (const file of additionalFiles) {
      if (await handleAddPdf(file)) loadedFileCount += 1;
    }
    if (loadedFileCount > 1) {
      setReadyStatus();
      setStatusMessage(`Loaded ${loadedFileCount} PDFs into the workspace.`);
    }
  }

  // --- Selection ---

  function handlePageClick(index: number): void {
    if (isBusy()) return;
    const page = pages[index];
    if (!page) return;
    setActivePageId(page.id);
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
    const firstSelectedIndex = nextSelection.values().next().value as number | undefined;
    if (firstSelectedIndex !== undefined) setActivePageId(pages[firstSelectedIndex]?.id ?? null);
    closeFilesDialog();
    setStatusMessage(`Selected ${formatPageCount(nextSelection.size)} from ${file.name}.`);
  }

  function handleSelectAll(): void {
    if (isBusy()) return;
    const nextSelection = toggleSelectAll(pages.length, selectedIndices());
    setSelectedIndices(nextSelection);
    if (!activePageId()) setActivePageId(pages[0]?.id ?? null);
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
    if (disposed || isBusy()) return;
    const selection = selectedIndices();
    const selectedPageIndices =
      selection.size > 0 ? Array.from(selection).sort((a, b) => a - b) : undefined;
    const totalPages = selectedPageIndices ? selectedActivePageCount() : activePageCount();

    setOperation("building");
    setStatusMessage(
      `${selectedPageIndices ? "Building selected PDF" : "Building PDF"}… 0/${totalPages}`
    );

    try {
      const result = await runPDF(
        PDFProcessing.use((service) =>
          service.buildPDF(pages, {
            selectedIndices: selectedPageIndices,
            onProgress: ({ completed, total }) => {
              if (disposed) return;
              setStatusMessage(
                `${selectedPageIndices ? "Building selected PDF" : "Building PDF"}… ${completed}/${total}`
              );
            },
          })
        )
      );
      if (disposed) return;
      downloadPDF(result);
      setStatusMessage("Export started.");
    } catch (_err) {
      if (disposed) return;
      dispatchToast("Failed to build the PDF.", "error");
      setStatusMessage("Export failed. Try again.");
    } finally {
      if (!disposed) setOperation("idle");
    }
  }

  async function handleExportImages(): Promise<void> {
    if (disposed || isBusy()) return;
    const selection = selectedIndices();
    const selectedPageIndices =
      selection.size > 0 ? Array.from(selection).sort((a, b) => a - b) : undefined;
    const totalPages = selectedPageIndices ? selectedActivePageCount() : activePageCount();

    setOperation("exporting-images");
    setStatusMessage(
      `${selectedPageIndices ? "Building selected images" : "Building images"}… 0/${totalPages}`
    );

    try {
      const result = await runPDF(
        PDFProcessing.use((service) =>
          service.exportImages(pages, {
            selectedIndices: selectedPageIndices,
            onProgress: ({ completed, total }) => {
              if (disposed) return;
              setStatusMessage(
                `${selectedPageIndices ? "Building selected images" : "Building images"}… ${completed}/${total}`
              );
            },
          })
        )
      );
      if (disposed) return;
      downloadFile(result, "application/zip");
      setStatusMessage("Image download started.");
    } catch (error) {
      if (disposed) return;
      const message =
        error instanceof PDFProcessingError && error.operation === "image-export-limit"
          ? error.message
          : "Failed to export images.";
      dispatchToast(message, "error");
      setStatusMessage(message);
    } finally {
      if (!disposed) setOperation("idle");
    }
  }

  async function handleCompress(): Promise<void> {
    const file = getUnmodifiedSourceFile();
    if (disposed || isBusy() || !file) return;

    setOperation("compressing");
    setStatusMessage("Compressing PDF…");

    try {
      const result = await runPDF(
        PDFProcessing.use((service) =>
          service.compressPDF(file, {
            onCompressionStage: () => {
              if (!disposed) setStatusMessage("Compressing PDF…");
            },
          })
        )
      );
      if (disposed) return;
      downloadPDF(result);
      if (result.reduced) {
        dispatchToast(
          `Compressed ${formatFileSize(result.inputBytes)} to ${formatFileSize(result.outputBytes)}.`,
          "success"
        );
        setStatusMessage("Compressed PDF download started.");
      } else {
        dispatchToast("No smaller file was available. Downloaded the current PDF.", "info");
        setStatusMessage("Current PDF download started.");
      }
    } catch (error) {
      if (disposed) return;
      dispatchToast(
        error instanceof QpdfProcessingError
          ? `Failed to compress the PDF: ${error.message}`
          : "Failed to compress the PDF.",
        "error"
      );
      setStatusMessage("Compression failed. Try again.");
    } finally {
      if (!disposed) setOperation("idle");
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
        ref={editorRoot}
        data-testid="editor-root"
        data-operation={operation()}
        data-phase={phase()}
        aria-busy={isBusy()}
        tabIndex={-1}
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
              onFilesSelected={handleInitialFiles}
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
                      ref={reviewButton}
                      type="button"
                      data-testid="editor-review-button"
                      class="editor-toolbar-action editor-review-button"
                      aria-label="Review pages"
                      aria-controls="editor-page-review"
                      aria-expanded={reviewOpen()}
                      title="Review pages"
                      onClick={openPageReview}
                      disabled={isBusy()}
                    >
                      <svg viewBox="0 0 20 20" aria-hidden="true">
                        <path d="M4 7V4h3M13 4h3v3M16 13v3h-3M7 16H4v-3" />
                      </svg>
                      <span class="editor-review-button-label">Review</span>
                    </button>
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
                runtime={pdfRuntime}
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
                onExportImages={handleExportImages}
                onCompress={handleCompress}
                compressionAvailable={getUnmodifiedSourceFile() !== null}
                compressionDisabledReason={compressionDisabledReason()}
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
            <Show when={reviewOpen()}>
              <EditorPageViewer
                pages={pages}
                navigationPageIds={reviewPageIds()}
                activePageId={activePageId()}
                runtime={pdfRuntime}
                onActivePageChange={(pageId) => setActivePageId(pageId)}
                onClose={closePageReview}
              />
            </Show>
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
