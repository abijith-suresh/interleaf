import { Effect, Exit, Fiber } from "effect";
import { batch, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { ROTATION_STEP, TOAST_DISMISS_TIMEOUT_MS } from "../../constants";
import { hasPageAdditions } from "../../controllers/editor-additions-state";
import { answerField } from "../../controllers/editor-field-state";
import {
  copyOrganizationPages,
  emptyOrganizationHistory,
  recordOrganization,
  snapshotOrganization,
  trimOrganizationHistory,
} from "../../controllers/editor-history";
import { planUploadGroups } from "../../controllers/editor-import";
import {
  areAllPagesSelected,
  createPageStates,
  type DeletionAction,
  duplicatePageState,
  getDeletionAction,
  remapSelectionAfterMove,
  toggleSelectAll,
  toggleSelection,
} from "../../controllers/editor-page-state";
import { groupWorkspaceFiles, type WorkspaceFile } from "../../controllers/editor-workspace";
import { makePDFRuntime, PDFProcessing, type PDFProcessingShape } from "../../services/pdf-runtime";
import { QpdfProcessingError } from "../../services/qpdf-processing";
import type { PageState } from "../../types/interfaces";
import { PDFProcessingError } from "../../types/interfaces";
import { downloadFile, downloadPDF } from "../../utils/download";
import { getSupportedFileKind } from "../../utils/file-types";
import { promptForPassword } from "../../utils/password-prompt";
import { showToast as dispatchToast, TOAST_EVENT_NAME, type ToastDetail } from "../../utils/toast";
import EditorFilesDialog from "./EditorFilesDialog";
import EditorHistoryControls from "./EditorHistoryControls";
import EditorPageGrid from "./EditorPageGrid";
import EditorPageViewer from "./EditorPageViewer";
import EditorSelectionBar from "./EditorSelectionBar";
import EditorUploader from "./EditorUploader";
import EditorButton from "./ui/EditorButton";
import EditorIcon from "./ui/EditorIcon";

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
  | "compressing"
  | "restoring"
  | "removing";
type ToastTone = "success" | "error" | "info";

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

interface LoadedWorkspaceFile {
  file: File;
  pageCount: number;
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

const TOUCH_AUTO_SCROLL_INTERVAL_MS = 16;
const TOUCH_AUTO_SCROLL_SPEED_PX = 9;
const TOUCH_AUTO_SCROLL_EDGE_PX = 56;

export default function Editor() {
  const base = import.meta.env.BASE_URL;
  let addPdfInput!: HTMLInputElement;
  let editorRoot!: HTMLDivElement;
  let filesButton!: HTMLButtonElement;
  let nextToastId = 0;
  let activeOperationFiber: Fiber.Fiber<unknown, unknown> | null = null;
  const toastTimers = new Map<number, number>();
  const pdfRuntime = makePDFRuntime();
  let disposed = false;
  let filesFocusGeneration = 0;
  let restoreFilesAfterRemoval: (() => void) | undefined;

  function invalidateFilesFocus(): void {
    filesFocusGeneration++;
    restoreFilesAfterRemoval = undefined;
  }

  const [phase, setPhase] = createSignal<"upload" | "edit">("upload");
  const [pages, setPages] = createStore<PageState[]>([]);
  const [selectedIndices, setSelectedIndices] = createSignal<Set<number>>(new Set<number>());
  const [dragSourceIndex, setDragSourceIndex] = createSignal<number | null>(null);
  const [dragOverTarget, setDragOverTarget] = createSignal<DragOverTarget | null>(null);
  const [history, setHistory] = createSignal(emptyOrganizationHistory());
  const [filePickerOpen, setFilePickerOpen] = createSignal(false);
  const [filesOpen, setFilesOpen] = createSignal(false);
  const [workspaceView, setWorkspaceView] = createSignal<"pages" | "document">("pages");
  const [activePageId, setActivePageId] = createSignal<string | null>(null);
  const [operation, setOperation] = createSignal<EditorOperation>("idle");
  const [statusMessage, setStatusMessage] = createSignal("Your files never leave your device.");
  const [toasts, setToasts] = createSignal<Toast[]>([]);

  const activePageCount = () => pages.filter((p) => !p.markedForDeletion).length;
  const markedPageCount = () => pages.length - activePageCount();
  const pageStatusSummary = () => {
    if (pages.length === 0) return "No pages.";
    if (markedPageCount() === 0) return `${pages.length} pages.`;
    return `${activePageCount()} of ${pages.length} pages exportable.`;
  };
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

  const historyUnavailable = () =>
    isBusy() || dragSourceIndex() !== null || filesOpen() || filePickerOpen();

  function organizationSnapshot() {
    return snapshotOrganization(pages, selectedIndices(), activePageId());
  }

  function organize(label: string, mutation: () => void) {
    const before = organizationSnapshot();
    batch(() => {
      mutation();
      setHistory((current) => recordOrganization(current, label, before, organizationSnapshot()));
    });
  }

  function restoreOrganization(direction: "undo" | "redo"): boolean {
    if (disposed || phase() !== "edit" || historyUnavailable()) return false;
    const current = history();
    const entry = current[direction].at(-1);
    if (!entry) return false;
    const snapshot = direction === "undo" ? entry.before : entry.after;
    const focused = document.activeElement;
    const focusedInWorkspace = focused instanceof HTMLElement && editorRoot.contains(focused);
    const focusedView = workspaceView();
    const focusedInViewer = focused instanceof HTMLElement && !!focused.closest("#editor-document");
    const focusedRow =
      focused instanceof HTMLElement
        ? focused.closest<HTMLElement>(".editor-page-grid > li[data-page-index]")
        : null;
    const focusedIndex = focusedRow ? Number(focusedRow.dataset.pageIndex) : -1;
    const focusedId = pages[focusedIndex]?.id;
    const currentFiles = new Set(pages.map((page) => page.sourceFile));
    const targetFiles = new Set(snapshot.pages.map((page) => page.sourceFile));
    const missing = [...targetFiles].filter((file) => !currentFiles.has(file));
    const obsolete = [...currentFiles].filter((file) => !targetFiles.has(file));
    const commit = () =>
      batch(() => {
        setPages(reconcile(copyOrganizationPages(snapshot.pages), { key: "id" }));
        const selectedIds = new Set(snapshot.selectedIds);
        setSelectedIndices(
          new Set(pages.flatMap((page, index) => (selectedIds.has(page.id) ? [index] : [])))
        );
        const reviewIds = pages
          .filter((page) => selectedIds.size === 0 || selectedIds.has(page.id))
          .map((page) => page.id);
        setActivePageId(
          reviewIds.includes(snapshot.activePageId ?? "")
            ? snapshot.activePageId
            : (reviewIds[0] ?? null)
        );
        if (pages.length === 0) setWorkspaceView("pages");
        setHistory(
          trimOrganizationHistory(
            direction === "undo"
              ? { undo: current.undo.slice(0, -1), redo: [...current.redo, entry] }
              : { undo: [...current.undo, entry], redo: current.redo.slice(0, -1) },
            pages
          )
        );
        setStatusMessage(`${direction === "undo" ? "Undid" : "Redid"} ${entry.label}.`);
      });
    // Reordering can blur a moved tile; undoing a copy can remove it entirely.
    // Restore only focus that belonged to that page, never an unrelated control.
    const restoreFocus = () => {
      if (focusedInWorkspace && focused instanceof HTMLElement)
        queueMicrotask(() => {
          if (disposed || !editorRoot.isConnected) return;
          if (workspaceView() !== focusedView && pages.length > 0) return;
          if (document.activeElement !== document.body && document.activeElement !== focused)
            return;
          if (pages.length === 0) {
            if (focused.isConnected && !focused.matches(":disabled") && !focusedInViewer) return;
            editorRoot
              .querySelector<HTMLButtonElement>(`[data-testid="editor-${direction}-button"]`)
              ?.focus();
            return;
          }
          if (!focusedRow) {
            if (focused.isConnected && !focused.matches(":disabled")) {
              focused.focus();
              return;
            }
            const fallback = focusedInViewer
              ? '.editor-review-filmstrip-item[aria-current="page"]'
              : `[data-testid="editor-${direction}-button"]`;
            editorRoot.querySelector<HTMLButtonElement>(fallback)?.focus();
            return;
          }
          if (focused.isConnected) {
            focused.focus();
            return;
          }
          const logicalIndex = pages.findIndex((page) => page.id === focusedId);
          const activeIndex = pages.findIndex((page) => page.id === activePageId());
          const index =
            logicalIndex >= 0
              ? logicalIndex
              : activeIndex >= 0
                ? activeIndex
                : Math.min(focusedIndex, pages.length - 1);
          editorRoot
            .querySelector<HTMLButtonElement>(
              `[data-testid="editor-page-tile"][data-page-index="${index}"]`
            )
            ?.focus();
        });
    };
    if (missing.length === 0 && obsolete.length === 0) {
      commit();
      restoreFocus();
    } else {
      // Claim the operation synchronously so accepted keyboard requests can
      // prevent the browser's default before asynchronous loading starts.
      setOperation("restoring");
      setStatusMessage("Restoring files…");
      void runPDF(
        PDFProcessing.use((service) =>
          Effect.suspend(() => {
            const attempted: File[] = [];
            let committed = false;
            return Effect.gen(function* () {
              for (const file of missing) {
                attempted.push(file);
                const count = yield* loadPdfFile(service, file);
                if (count === null || disposed) return;
              }
              if (disposed) return;
              commit();
              committed = true;
            }).pipe(
              Effect.onExit(() =>
                releaseWorkspaceFiles(
                  service,
                  committed ? obsolete : attempted,
                  committed ? "Workspace restored" : "Restoration canceled"
                )
              ),
              Effect.onExit(() =>
                Effect.sync(() => {
                  if (disposed) return;
                  setOperation("idle");
                  if (!committed) setStatusMessage("Files were not restored.");
                  restoreFocus();
                })
              )
            );
          })
        )
      ).catch((error) => {
        if (!disposed)
          dispatchToast(
            error instanceof Error ? error.message : "Could not restore files.",
            "error"
          );
      });
    }
    return true;
  }

  function handleHistoryKeyDown(event: KeyboardEvent) {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.altKey ||
      !(event.ctrlKey || event.metaKey)
    )
      return;
    const target = event.target;
    if (
      !(target instanceof HTMLElement) ||
      (target !== document.body && !editorRoot.contains(target))
    )
      return;
    if (
      target.isContentEditable ||
      target.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="menu"], [role="dialog"], dialog'
      )
    )
      return;
    if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"], [role="menu"]'))
      return;
    const key = event.key.toLowerCase();
    const direction =
      key === "z"
        ? event.shiftKey
          ? "redo"
          : "undo"
        : key === "y" && event.ctrlKey && !event.metaKey && !event.shiftKey
          ? "redo"
          : null;
    if (direction && restoreOrganization(direction)) event.preventDefault();
  }

  function getUnmodifiedSourceFile(): File | null {
    if (pages.length === 0 || selectedIndices().size > 0) return null;

    const sourceFile = pages[0]?.sourceFile;
    if (!sourceFile) return null;

    const isUnmodified = pages.every(
      (page, index) =>
        page.sourceFile === sourceFile &&
        page.sourcePageNumber === index + 1 &&
        page.rotation === 0 &&
        !page.markedForDeletion &&
        !hasPageAdditions(page)
    );

    return isUnmodified ? sourceFile : null;
  }

  function compressionDisabledReason(): string {
    if (selectedIndices().size > 0) {
      return "Clear page selection to compress the original PDF";
    }
    if (pages.length === 0 || activePageCount() === 0) {
      return "Restore marked pages to compress the original PDF";
    }
    return "Compress only before page edits";
  }

  const workspaceFiles = createMemo<WorkspaceFile[]>(() => groupWorkspaceFiles(pages));
  const filesButtonLabel = () =>
    `View ${workspaceFiles().length} file${workspaceFiles().length === 1 ? "" : "s"}`;

  function setReadyStatus() {
    if (disposed) return;
    setOperation("idle");
    setStatusMessage(phase() === "edit" ? "Ready" : "Your files never leave your device.");
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
    const timer = window.setTimeout(() => dismissToast(id), TOAST_DISMISS_TIMEOUT_MS);
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

  onMount(() => {
    let lastWorkspaceFocus: HTMLElement | null = null;
    const rememberFocus = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && editorRoot.contains(event.target)) {
        lastWorkspaceFocus = event.target;
      }
    };
    const retainVisibleFocus = () => {
      // Browsers may blur a newly hidden element before delivering resize.
      const focused =
        document.activeElement === document.body ? lastWorkspaceFocus : document.activeElement;
      if (
        focused instanceof HTMLElement &&
        editorRoot.contains(focused) &&
        !focused.getClientRects().length
      ) {
        editorRoot.querySelector<HTMLButtonElement>(`[data-view="${workspaceView()}"]`)?.focus();
      }
    };
    document.addEventListener("keydown", handleHistoryKeyDown);
    document.addEventListener("focusin", rememberFocus);
    window.addEventListener("resize", retainVisibleFocus);
    onCleanup(() => {
      document.removeEventListener("keydown", handleHistoryKeyDown);
      document.removeEventListener("focusin", rememberFocus);
      window.removeEventListener("resize", retainVisibleFocus);
    });
  });

  onCleanup(() => {
    disposed = true;
    invalidateFilesFocus();
    setHistory(emptyOrganizationHistory());
    if (typeof document !== "undefined") {
      document.removeEventListener(TOAST_EVENT_NAME, handleToast);
    }
    for (const timer of toastTimers.values()) {
      window.clearTimeout(timer);
    }
    toastTimers.clear();
    stopTouchAutoScroll();
    const fiber = activeOperationFiber;
    activeOperationFiber = null;
    Effect.runFork(
      (fiber ? Fiber.interrupt(fiber) : Effect.void).pipe(
        Effect.ignoreCause,
        Effect.andThen(Effect.promise(() => pdfRuntime.dispose())),
        Effect.ignoreCause
      )
    );
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

  function loadPdfFile(service: PDFProcessingShape, file: File) {
    const unlock = (isRetry: boolean): Effect.Effect<boolean, unknown> =>
      Effect.gen(function* () {
        const password = yield* Effect.tryPromise({
          try: (signal) => promptForPassword(file.name, isRetry, signal),
          catch: (cause) => cause,
        });
        if (password === null || disposed) return false;
        setStatusMessage("Unlocking PDF…");
        return yield* service.loadPDFWithPassword(file, password).pipe(
          Effect.as(true),
          Effect.catchTag("PDFPasswordRequiredError", () => unlock(true))
        );
      });

    return service.loadPDF(file).pipe(
      Effect.as(true),
      Effect.catchTag("PDFPasswordRequiredError", (error) =>
        unlock(error.reason === "wrong-password")
      ),
      Effect.catch((error) =>
        Effect.sync(() => {
          dispatchToast(getLoadErrorMessage(file, error), "error");
          return false;
        })
      ),
      Effect.flatMap((loaded) => (loaded ? service.getPageCount : Effect.succeed(null)))
    );
  }

  function releaseWorkspaceFiles(
    service: PDFProcessingShape,
    files: readonly File[],
    result: string
  ) {
    return Effect.forEach(
      files,
      (file) =>
        Effect.suspend(() => service.releaseFile(file)).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              if (!disposed)
                dispatchToast(
                  `${result}, but could not release ${file.name}: ${error.message}`,
                  "error"
                );
            })
          )
        ),
      { discard: true }
    );
  }

  function commitWorkspaceFiles(files: LoadedWorkspaceFile[], replace: boolean): void {
    const nextPages = files.flatMap(({ file, pageCount }) => createPageStates(file, pageCount));
    if (replace) {
      batch(() => {
        setPages(nextPages);
        setSelectedIndices(new Set<number>());
        setActivePageId(nextPages[0]?.id ?? null);
        setWorkspaceView("pages");
        setPhase("edit");
      });
      return;
    }
    organize("source addition", () => {
      setPages(
        produce((draftPages) => {
          draftPages.push(...nextPages);
        })
      );
      if (!activePageId()) setActivePageId(nextPages[0]?.id ?? null);
    });
  }

  function describeLoadedFiles(mode: "upload" | "add", pdfCount: number, imageCount: number) {
    const pdfLabel = `${pdfCount} PDF${pdfCount === 1 ? "" : "s"}`;
    const imageLabel = `${imageCount} image${imageCount === 1 ? "" : "s"}`;

    if (mode === "upload") {
      if (pdfCount === 0) return `Created a PDF from ${imageLabel}.`;
      if (imageCount === 0) return `Loaded ${pdfLabel} into the workspace.`;
      return `Loaded ${pdfLabel} and created a PDF from ${imageLabel}.`;
    }

    if (pdfCount === 0) return `Added a PDF from ${imageLabel}.`;
    if (imageCount === 0) return `Added ${pdfLabel} to the workspace.`;
    return `Added ${pdfLabel} and created a PDF from ${imageLabel}.`;
  }

  async function loadFilesIntoWorkspace(files: File[], mode: "upload" | "add"): Promise<boolean> {
    if (disposed || isBusy() || files.length === 0) return false;
    invalidateFilesFocus();

    const unsupportedFiles = files.filter((file) => getSupportedFileKind(file) === null);
    if (unsupportedFiles.length > 0) {
      dispatchToast("Choose PDF, PNG, or JPEG files.", "error");
      return false;
    }

    const groups = planUploadGroups(files);
    if (groups.length === 0) return false;

    setOperation(mode === "upload" ? "uploading" : "adding");
    setStatusMessage(mode === "upload" ? "Loading files…" : "Adding files…");

    const existingFiles = new Set(pages.map((page) => page.sourceFile));
    return runPDF(
      PDFProcessing.use((service) =>
        Effect.suspend(() => {
          const loadedFiles: LoadedWorkspaceFile[] = [];
          let pdfCount = 0;
          let imageCount = 0;

          return Effect.gen(function* () {
            for (const group of groups) {
              let pdfFile: File;
              if (group.kind === "images") {
                imageCount += group.files.length;
                setOperation("building");
                setStatusMessage(`Creating PDF from images… 0/${group.files.length}`);
                const generatedFile = yield* service
                  .imagesToPDF(group.files, {
                    onProgress: ({ completed, total }) => {
                      if (!disposed)
                        setStatusMessage(`Creating PDF from images… ${completed}/${total}`);
                    },
                  })
                  .pipe(
                    Effect.flatMap((result) =>
                      Effect.try({
                        try: () => {
                          const bytes = new Uint8Array(new ArrayBuffer(result.data.byteLength));
                          bytes.set(result.data);
                          return new File([bytes], group.outputFileName, {
                            type: "application/pdf",
                          });
                        },
                        catch: (cause) => cause,
                      })
                    ),
                    Effect.catch((error) =>
                      Effect.sync(() => {
                        dispatchToast(
                          error instanceof PDFProcessingError
                            ? error.message
                            : "Failed to create a PDF from the selected images.",
                          "error"
                        );
                        return null;
                      })
                    )
                  );
                if (!generatedFile || disposed) return false;
                pdfFile = generatedFile;
              } else {
                pdfCount += group.files.length;
                pdfFile = group.files[0];
              }

              setOperation(mode === "upload" && loadedFiles.length === 0 ? "uploading" : "adding");
              setStatusMessage(`Loading ${pdfFile.name}…`);
              const pageCount = yield* loadPdfFile(service, pdfFile);
              if (pageCount === null || disposed) return false;
              loadedFiles.push({ file: pdfFile, pageCount });
            }

            commitWorkspaceFiles(loadedFiles, phase() === "upload");
            setStatusMessage(describeLoadedFiles(mode, pdfCount, imageCount));
            return true;
          }).pipe(
            Effect.onExit((exit) =>
              Exit.isSuccess(exit) && exit.value
                ? Effect.void
                : Effect.forEach(
                    loadedFiles.filter(({ file }) => !existingFiles.has(file)),
                    ({ file }) =>
                      Effect.suspend(() => service.releaseFile(file)).pipe(Effect.ignoreCause),
                    { discard: true }
                  )
            ),
            Effect.onExit((exit) =>
              Effect.sync(() => {
                if (Exit.isSuccess(exit) && exit.value) {
                  if (!disposed) setOperation("idle");
                } else setReadyStatus();
              })
            )
          );
        })
      )
    ).catch(() => false);
  }

  function requestAddFiles(): void {
    if (isBusy()) return;
    setFilesOpen(false);
    setFilePickerOpen(true);
    addPdfInput.click();
  }

  function handleAddFilesInput(event: Event): void {
    setFilePickerOpen(false);
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (files.length === 0) return;
    void loadFilesIntoWorkspace(files, "add");
  }

  function closeFilesDialog(): void {
    invalidateFilesFocus();
    const version = filesFocusGeneration;
    const view = workspaceView();
    const focused = document.activeElement;
    setFilesOpen(false);
    queueMicrotask(() => {
      if (disposed || version !== filesFocusGeneration || workspaceView() !== view) return;
      if (
        document.activeElement !== document.body &&
        document.activeElement !== focused &&
        document.activeElement !== filesButton
      )
        return;
      const target = filesButton?.disabled
        ? editorRoot.querySelector<HTMLButtonElement>('[data-testid="editor-undo-button"]')
        : filesButton;
      target?.focus();
      if (operation() === "removing" && pages.length > 0 && filesButton?.disabled) {
        const fallback = document.activeElement;
        // Cleanup can outlive closing the dialog. Return to Files once enabled,
        // only while focus still belongs to the fallback chosen above.
        restoreFilesAfterRemoval = () => {
          if (
            !disposed &&
            version === filesFocusGeneration &&
            workspaceView() === view &&
            !filesOpen() &&
            filesButton?.isConnected &&
            !filesButton.disabled &&
            document.activeElement === fallback
          )
            filesButton.focus({ preventScroll: true });
        };
      }
    });
  }

  function changeWorkspaceView(view: "pages" | "document"): void {
    invalidateFilesFocus();
    if (view === "document") {
      if (pages.length === 0) return;
      const ids = reviewPageIds();
      if (!ids.includes(activePageId() ?? "")) setActivePageId(ids[0] ?? null);
    }
    setWorkspaceView(view);
    // The switch stays mounted at every breakpoint, so keyboard focus never
    // lands in a region that is being removed.
    queueMicrotask(() =>
      editorRoot.querySelector<HTMLButtonElement>(`[data-view="${view}"]`)?.focus()
    );
  }

  async function handleInitialFiles(files: File[]): Promise<void> {
    if (disposed || isBusy() || files.length === 0) return;
    await loadFilesIntoWorkspace(files, phase() === "upload" ? "upload" : "add");
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

    const workspaceFile = workspaceFiles().find((candidate) => candidate.file === file);
    const nextSelection = new Set(workspaceFile?.pageIndices ?? []);

    if (nextSelection.size === 0) return;
    setSelectedIndices(nextSelection);
    const firstSelectedIndex = nextSelection.values().next().value as number | undefined;
    if (firstSelectedIndex !== undefined) setActivePageId(pages[firstSelectedIndex]?.id ?? null);
    closeFilesDialog();
    setStatusMessage(`Selected ${formatPageCount(nextSelection.size)} from ${file.name}.`);
  }

  async function handleRemoveWorkspaceFile(file: File): Promise<void> {
    if (isBusy()) return;

    const workspaceFile = workspaceFiles().find((candidate) => candidate.file === file);
    if (!workspaceFile) return;
    setOperation("removing");
    const removedPageCount = workspaceFile.pageCount;
    const removedFileName = file.name;

    const selection = selectedIndices();
    const nextSelection = new Set<number>();
    const remainingPages: PageState[] = [];
    pages.forEach((page, oldIndex) => {
      if (page.sourceFile === file) return;
      if (selection.has(oldIndex)) nextSelection.add(remainingPages.length);
      remainingPages.push(page);
    });
    organize("source removal", () => {
      setPages(copyOrganizationPages(remainingPages));
      setSelectedIndices(nextSelection);
      setDragSourceIndex(null);
      setDragOverTarget(null);
      if (!remainingPages.some((page) => page.id === activePageId())) {
        setActivePageId(remainingPages[0]?.id ?? null);
      }
      if (remainingPages.length === 0) {
        setWorkspaceView("pages");
        setFilesOpen(false);
      }
    });
    setStatusMessage(
      remainingPages.length === 0
        ? `Removed ${removedFileName}. The workspace is empty.`
        : `Removed ${removedFileName} and ${formatPageCount(removedPageCount)}.`
    );
    try {
      await runPDF(
        PDFProcessing.use((service) => releaseWorkspaceFiles(service, [file], "Source removed"))
      );
    } catch (error) {
      if (!disposed)
        dispatchToast(
          `Source removed, but cleanup failed: ${error instanceof Error ? error.message : "Unknown error"}`,
          "error"
        );
    } finally {
      const restoreFiles = restoreFilesAfterRemoval;
      restoreFilesAfterRemoval = undefined;
      if (!disposed) {
        setOperation("idle");
        if (restoreFiles) queueMicrotask(restoreFiles);
        if (
          remainingPages.length === 0 &&
          (document.activeElement === document.body ||
            document.activeElement === filesButton ||
            (document.activeElement instanceof HTMLElement &&
              !!document.activeElement.closest("#editor-files-dialog")))
        ) {
          queueMicrotask(() =>
            editorRoot
              .querySelector<HTMLButtonElement>('[data-testid="editor-undo-button"]')
              ?.focus()
          );
        }
      }
    }
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

  // --- Page organization ---

  function handlePageDuplicate(index: number, e: MouseEvent): void {
    e.stopPropagation();
    if (isBusy()) return;
    const page = pages[index];
    if (!page) return;
    const copy = duplicatePageState(page);
    organize("page duplication", () => {
      setPages(produce((draft) => draft.splice(index + 1, 0, copy)));
      setSelectedIndices(new Set([index + 1]));
      setActivePageId(copy.id);
    });
    setStatusMessage(`Duplicated page ${index + 1}. Page ${index + 2} selected.`);
    queueMicrotask(() =>
      editorRoot
        .querySelector<HTMLButtonElement>(
          `[data-testid="editor-page-tile"][data-page-index="${index + 1}"]`
        )
        ?.focus()
    );
  }

  function handlePageRotate(index: number, e: MouseEvent): void {
    e.stopPropagation();
    if (isBusy() || !pages[index]) return;
    organize("page rotation", () => setPages(index, "rotation", (r) => (r + ROTATION_STEP) % 360));
    setStatusMessage(`Rotated page ${index + 1}.`);
  }

  function handlePageDelete(index: number, e: MouseEvent): void {
    e.stopPropagation();
    if (isBusy()) return;

    if (!pages[index]) return;
    const markedForDeletion = pages[index].markedForDeletion;
    organize(markedForDeletion ? "page restoration" : "deletion marking", () =>
      setPages(index, "markedForDeletion", !markedForDeletion)
    );
    setStatusMessage(
      markedForDeletion ? `Restored page ${index + 1}.` : `Marked page ${index + 1} for deletion.`
    );
  }

  function handleRotateSelected(): void {
    if (isBusy() || selectedIndices().size === 0) return;
    organize("selected page rotation", () => {
      for (const index of selectedIndices()) {
        setPages(index, "rotation", (r) => (r + ROTATION_STEP) % 360);
      }
    });
    setStatusMessage(
      `Rotated ${selectedIndices().size} selected page${selectedIndices().size === 1 ? "" : "s"}.`
    );
  }

  // --- Delete ---

  function handleDeleteSelected(): void {
    if (isBusy() || selectedIndices().size === 0) return;
    const action = selectedDeletionAction();
    const markForDeletion = action === "mark";

    organize(markForDeletion ? "selected deletion marking" : "selected page restoration", () => {
      for (const index of selectedIndices()) {
        setPages(index, "markedForDeletion", markForDeletion);
      }
    });
    setStatusMessage(
      `${markForDeletion ? "Marked" : "Restored"} ${selectedIndices().size} selected page${
        selectedIndices().size === 1 ? "" : "s"
      }${markForDeletion ? " for deletion" : ""}.`
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
      `${selectedPageIndices ? "Exporting selected pages" : "Exporting PDF"}… 0/${totalPages}`
    );

    try {
      const result = await runPDF(
        PDFProcessing.use((service) =>
          service.buildPDF(pages, {
            selectedIndices: selectedPageIndices,
            onProgress: ({ completed, total }) => {
              if (disposed) return;
              setStatusMessage(
                `${selectedPageIndices ? "Exporting selected pages" : "Exporting PDF"}… ${completed}/${total}`
              );
            },
          })
        )
      );
      if (disposed) return;
      downloadPDF(result);
      setStatusMessage("Export started.");
    } catch (error) {
      if (disposed) return;
      const exportConstraint =
        error instanceof PDFProcessingError && error.operation === "reconcile-export";
      const constraintMessage = exportConstraint
        ? `${error.file ? `${error.file.name}: ` : ""}${error.message} Select pages from other files or remove this file, then try again.`
        : undefined;
      dispatchToast(constraintMessage ?? "Failed to export the PDF.", "error");
      setStatusMessage(constraintMessage ?? "Export failed. Try again.");
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
      `${selectedPageIndices ? "Exporting selected images" : "Exporting images"}… 0/${totalPages}`
    );

    try {
      const result = await runPDF(
        PDFProcessing.use((service) =>
          service.exportImages(pages, {
            selectedIndices: selectedPageIndices,
            onProgress: ({ completed, total }) => {
              if (disposed) return;
              setStatusMessage(
                `${selectedPageIndices ? "Exporting selected images" : "Exporting images"}… ${completed}/${total}`
              );
            },
          })
        )
      );
      if (disposed) return;
      downloadFile(result, "application/zip");
      setStatusMessage("Export started.");
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
      const result = await runPDF(PDFProcessing.use((service) => service.compressPDF(file)));
      if (disposed) return;
      downloadPDF(result);
      if (result.reduced) {
        dispatchToast(
          `Compressed ${formatFileSize(result.inputBytes)} to ${formatFileSize(result.outputBytes)}.`,
          "success"
        );
        setStatusMessage("Export started.");
      } else {
        dispatchToast("No smaller file was available. The original PDF was exported.", "info");
        setStatusMessage("Export started.");
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

    organize("page reorder", () => {
      setPages(
        produce((currentPages) => {
          const [moved] = currentPages.splice(from, 1);
          currentPages.splice(to, 0, moved);
        })
      );
      setSelectedIndices((previousSelection) =>
        remapSelectionAfterMove(previousSelection, from, to)
      );
    });
    setStatusMessage(`Moved page ${from + 1} to position ${to + 1}.`);
  }

  function handlePageKeyDown(index: number, e: KeyboardEvent): void {
    if (isBusy() || !e.altKey) return;

    const to = e.key === "ArrowLeft" ? index - 1 : e.key === "ArrowRight" ? index + 1 : index;
    if (to === index || to < 0 || to >= pages.length) return;
    const pageId = pages[index]?.id;
    if (!pageId) return;
    const focusedTile = e.currentTarget;
    const restoreFocus = document.activeElement === focusedTile;
    e.preventDefault();
    movePage(index, to);

    // Solid moves the existing row, which can blur its focused button.
    if (restoreFocus) {
      queueMicrotask(() => {
        if (disposed || isBusy() || workspaceView() !== "pages" || !editorRoot.isConnected) return;
        if (document.activeElement !== document.body && document.activeElement !== focusedTile)
          return;
        const currentIndex = pages.findIndex((page) => page.id === pageId);
        editorRoot
          .querySelector<HTMLButtonElement>(
            `[data-testid="editor-page-tile"][data-page-index="${currentIndex}"]`
          )
          ?.focus();
      });
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

  // --- Touch reordering ---

  let touchAutoScrollTimer: number | null = null;
  let touchPointerY = 0;

  function gridScrollElement(): HTMLDivElement | null {
    return editorRoot?.querySelector<HTMLDivElement>(".editor-page-scroll") ?? null;
  }

  function touchTileIndexAt(x: number, y: number): number | null {
    const tile = document.elementFromPoint(x, y)?.closest<HTMLElement>("li[data-page-index]");
    if (!tile) return null;
    const index = Number(tile.dataset.pageIndex);
    return Number.isInteger(index) && index >= 0 ? index : null;
  }

  function stopTouchAutoScroll(): void {
    if (touchAutoScrollTimer !== null) {
      window.clearInterval(touchAutoScrollTimer);
      touchAutoScrollTimer = null;
    }
  }

  function handleTouchDragStart(index: number, y: number): void {
    if (isBusy()) return;
    touchPointerY = y;
    setDragSourceIndex(index);
    setDragOverTarget(null);
    stopTouchAutoScroll();
    touchAutoScrollTimer = window.setInterval(() => {
      const scrollElement = gridScrollElement();
      if (!scrollElement) return;
      const bounds = scrollElement.getBoundingClientRect();
      if (touchPointerY < bounds.top + TOUCH_AUTO_SCROLL_EDGE_PX) {
        scrollElement.scrollTop -= TOUCH_AUTO_SCROLL_SPEED_PX;
      } else if (touchPointerY > bounds.bottom - TOUCH_AUTO_SCROLL_EDGE_PX) {
        scrollElement.scrollTop += TOUCH_AUTO_SCROLL_SPEED_PX;
      }
    }, TOUCH_AUTO_SCROLL_INTERVAL_MS);
  }

  function handleTouchDragMove(x: number, y: number): void {
    touchPointerY = y;
    const from = dragSourceIndex();
    if (from === null || isBusy()) return;
    const target = touchTileIndexAt(x, y);
    if (target === null || target === from) {
      setDragOverTarget(null);
      return;
    }
    setDragOverTarget({ index: target, direction: from < target ? "after" : "before" });
  }

  function settleTouchDrag(): { from: number | null; target: DragOverTarget | null } {
    stopTouchAutoScroll();
    const from = dragSourceIndex();
    const target = dragOverTarget();
    setDragSourceIndex(null);
    setDragOverTarget(null);
    return { from, target };
  }

  function handleTouchDragEnd(): void {
    const { from, target } = settleTouchDrag();
    if (from === null || isBusy()) return;
    if (!target || target.index === from) return;
    movePage(from, target.index);
  }

  function handleTouchDragCancel(): void {
    stopTouchAutoScroll();
    setDragSourceIndex(null);
    setDragOverTarget(null);
  }

  return (
    <div class="editor-app" data-workspace-view={phase() === "edit" ? workspaceView() : undefined}>
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
        <Show when={phase() === "upload"}>
          <header class="editor-header">
            <div class="editor-header-left">
              <a href={base} class="editor-brand" translate="no">
                interleaf
              </a>
            </div>
            <h1 class="sr-only">Interleaf PDF editor</h1>
            <div class="editor-header-right">
              <a href={base} class="editor-back" aria-label="Return to Interleaf home">
                <EditorIcon name="back" />
                <span class="editor-back-wide">Back</span>
                <span class="editor-back-compact">Exit</span>
              </a>
            </div>
          </header>
        </Show>

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
            <aside class="editor-sidebar" aria-label="Workspace">
              <a href={base} class="editor-brand" translate="no">
                interleaf
              </a>
              <h1 class="sr-only">Interleaf PDF editor</h1>
              <nav class="editor-view-nav" aria-label="Workspace views">
                <EditorButton
                  data-testid="editor-pages-view-button"
                  data-view="pages"
                  aria-pressed={workspaceView() === "pages"}
                  aria-controls="editor-workspace-content"
                  onClick={() => changeWorkspaceView("pages")}
                  icon="pages"
                >
                  Pages
                </EditorButton>
                <EditorButton
                  data-testid="editor-document-view-button"
                  aria-disabled={pages.length === 0}
                  data-view="document"
                  aria-pressed={workspaceView() === "document"}
                  aria-controls="editor-workspace-content"
                  onClick={() => changeWorkspaceView("document")}
                  icon="document"
                >
                  Document
                </EditorButton>
              </nav>
              <div class="editor-workspace-context">
                <span>{formatPageCount(pages.length)}</span>
                <span>
                  {workspaceFiles().length} {workspaceFiles().length === 1 ? "file" : "files"}
                </span>
              </div>
              <div class="editor-source-actions">
                <EditorButton
                  data-testid="editor-add-pdf-button"
                  aria-label="Add PDFs or images"
                  onClick={requestAddFiles}
                  disabled={isBusy()}
                  icon="plus"
                >
                  <span class="editor-add-pdf-label">Add files</span>
                </EditorButton>
                <EditorButton
                  ref={filesButton}
                  data-testid="editor-files-button"
                  aria-label={filesButtonLabel()}
                  aria-controls="editor-files-dialog"
                  aria-expanded={filesOpen()}
                  title={filesButtonLabel()}
                  onClick={() => setFilesOpen(true)}
                  disabled={isBusy() || pages.length === 0}
                  icon="files"
                >
                  <span class="editor-files-button-label">Files</span>
                </EditorButton>
              </div>
              <EditorHistoryControls
                undoLabel={history().undo.at(-1)?.label}
                redoLabel={history().redo.at(-1)?.label}
                unavailable={historyUnavailable()}
                onUndo={() => restoreOrganization("undo")}
                onRedo={() => restoreOrganization("redo")}
              />
              <p class="editor-workspace-privacy">Your files never leave your device.</p>
              <a href={base} class="editor-back" aria-label="Return to Interleaf home">
                <EditorIcon name="back" />
                <span>Exit editor</span>
              </a>
            </aside>
            <section
              id="editor-workspace-content"
              class="editor-workspace-main"
              aria-label={workspaceView() === "pages" ? "Pages workspace" : "Document workspace"}
            >
              <input
                ref={addPdfInput}
                data-testid="editor-add-pdf-input"
                type="file"
                accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
                multiple
                name="additional-files"
                aria-label="Choose additional PDF or image files"
                class="hidden"
                disabled={isBusy()}
                onChange={handleAddFilesInput}
                onCancel={() => setFilePickerOpen(false)}
              />
              <Show
                when={workspaceView() === "pages"}
                fallback={
                  <EditorPageViewer
                    pages={pages}
                    disabled={isBusy()}
                    navigationPageIds={reviewPageIds()}
                    activePageId={activePageId()}
                    runtime={pdfRuntime}
                    onActivePageChange={(pageId) => setActivePageId(pageId)}
                    onCheckmarksChange={(pageId, marks, label) =>
                      organize(label, () => {
                        const index = pages.findIndex((page) => page.id === pageId);
                        if (index >= 0)
                          setPages(
                            index,
                            "addedCheckmarks",
                            marks.map((mark) => ({ ...mark }))
                          );
                      })
                    }
                    onFieldChange={(pageId, fieldRef, value) =>
                      organize("Fill text field", () =>
                        setPages(
                          reconcile(answerField(pages, pageId, fieldRef, value), { key: "id" })
                        )
                      )
                    }
                    onTextChange={(pageId, texts, label) =>
                      organize(label, () => {
                        const index = pages.findIndex((page) => page.id === pageId);
                        if (index >= 0)
                          setPages(
                            index,
                            "addedText",
                            texts.map((text) => ({ ...text }))
                          );
                      })
                    }
                  />
                }
              >
                <div class="editor-canvas-header">
                  <h2 id="editor-pages-title">Pages</h2>
                  <span class="editor-canvas-count">{pageStatusSummary()}</span>
                </div>
                <Show
                  when={pages.length > 0}
                  fallback={
                    <EditorUploader
                      busy={isBusy()}
                      statusMessage={statusMessage()}
                      onFilesSelected={handleInitialFiles}
                      onPickerChange={setFilePickerOpen}
                    />
                  }
                >
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
                    onPageDuplicate={handlePageDuplicate}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDragEnter={handleDragEnter}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onDragEnd={handleDragEnd}
                    onTouchDragStart={handleTouchDragStart}
                    onTouchDragMove={handleTouchDragMove}
                    onTouchDragEnd={handleTouchDragEnd}
                    onTouchDragCancel={handleTouchDragCancel}
                  />
                </Show>
              </Show>

              <Show when={pages.length > 0}>
                <EditorSelectionBar
                  documentView={workspaceView() === "document"}
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
              </Show>

              <div
                role="status"
                aria-live="polite"
                aria-atomic="true"
                data-testid="editor-status-bar"
                class="sr-only"
              >
                {pageStatusSummary()}{" "}
                <span data-testid="editor-status-message">{statusMessage()}</span>
              </div>
            </section>
            <EditorFilesDialog
              open={filesOpen()}
              busy={isBusy()}
              files={workspaceFiles()}
              onClose={closeFilesDialog}
              onSelectFile={handleWorkspaceFileClick}
              onRemoveFile={handleRemoveWorkspaceFile}
            />
          </div>
        </Show>
      </div>
    </div>
  );
}
