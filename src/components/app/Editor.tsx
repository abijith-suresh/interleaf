import { Effect, Fiber } from "effect";
import { batch, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import {
  ROTATION_STEP,
  TOAST_DISMISS_TIMEOUT_MS,
  TOAST_ERROR_DISMISS_TIMEOUT_MS,
} from "../../constants";
import { hasPageAdditions } from "../../controllers/editor-additions-state";
import { answerField } from "../../controllers/editor-field-state";
import {
  copyOrganizationPages,
  emptyOrganizationHistory,
  recordOrganization,
  snapshotOrganization,
  trimOrganizationHistory,
} from "../../controllers/editor-history";
import {
  describeImportOutcome,
  describeSkippedFile,
  planUploadGroups,
  type SkippedFile,
} from "../../controllers/editor-import";
import {
  areAllPagesSelected,
  createPageStates,
  type DeletionAction,
  duplicatePageState,
  getDeletionAction,
  remapSelectionAfterInsert,
  remapSelectionAfterMove,
  toggleSelectAll,
  toggleSelection,
} from "../../controllers/editor-page-state";
import { groupWorkspaceFiles, type WorkspaceFile } from "../../controllers/editor-workspace";
import { isInvalidPDFError } from "../../services/pdf-errors";
import { makePDFRuntime, PDFProcessing, type PDFProcessingShape } from "../../services/pdf-runtime";
import { QpdfProcessingError } from "../../services/qpdf-processing";
import type { PageState } from "../../types/interfaces";
import { PDFProcessingError } from "../../types/interfaces";
import { downloadFile, downloadPDF } from "../../utils/download";
import { formatSavedPercent, formatSizeChange } from "../../utils/file-size";
import { getSupportedFileKind } from "../../utils/file-types";
import { guardLeave } from "../../utils/leave-guard";
import { promptForPassword } from "../../utils/password-prompt";
import { showToast as dispatchToast, TOAST_EVENT_NAME, type ToastDetail } from "../../utils/toast";
import Wordmark from "../shared/Wordmark";
import type { DraftCommit } from "./EditorAdditionsEditor";
import EditorFilesDialog from "./EditorFilesDialog";
import EditorPageGrid from "./EditorPageGrid";
import EditorPageViewer from "./EditorPageViewer";
import EditorSelectionBar from "./EditorSelectionBar";
import EditorToolbar from "./EditorToolbar";
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
  let moreButton!: HTMLButtonElement;
  let downloadButton!: HTMLButtonElement;
  let nextToastId = 0;
  let activeOperationFiber: Fiber.Fiber<unknown, unknown> | null = null;
  const toastTimers = new Map<number, number>();
  const pdfRuntime = makePDFRuntime();
  let disposed = false;
  let filesFocusGeneration = 0;
  let restoreFilesAfterCleanup: (() => void) | undefined;
  let draftCommit: DraftCommit | null = null;

  function invalidateFilesFocus(): void {
    filesFocusGeneration++;
    restoreFilesAfterCleanup = undefined;
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
  const [draftOpen, setDraftOpen] = createSignal(false);
  const [operation, setOperation] = createSignal<EditorOperation>("idle");
  const [filesNotice, setFilesNotice] = createSignal("");
  const [statusMessage, setStatusMessage] = createSignal("Your files never leave your device.");
  const [toasts, setToasts] = createSignal<Toast[]>([]);

  const activePageCount = () => pages.filter((p) => !p.markedForDeletion).length;
  const markedPageCount = () => pages.length - activePageCount();
  // The one visible page count. It sits next to the Download menu.
  const pageCountLabel = () => {
    if (pages.length === 0) return "No pages";
    if (markedPageCount() === 0) return formatPageCount(pages.length);
    return `${activePageCount()} of ${pages.length} pages exportable`;
  };
  const pageStatusSummary = () => `${pageCountLabel()}.`;
  const selectedActivePageCount = () =>
    Array.from(selectedIndices()).filter((index) => !pages[index]?.markedForDeletion).length;
  const selectionAnnouncement = () => {
    const count = selectedIndices().size;
    return count === 0 ? "" : `${formatPageCount(count)} selected.`;
  };
  const isBusy = () => operation() !== "idle";
  const allPagesSelected = () => areAllPagesSelected(pages.length, selectedIndices());
  const selectedDeletionAction = () => getDeletionAction(pages, selectedIndices());
  const deletionCopy = () => deletionActionCopy[selectedDeletionAction()];

  // An unsaved text, checkmark, or field answer would be discarded by any
  // history change to its page, so history waits until it is saved or canceled.
  // The Files dialog lists the restored files, so history stays available there.
  const historyUnavailable = () =>
    isBusy() || dragSourceIndex() !== null || filePickerOpen() || draftOpen();

  // Leaving an open Document draft saves it, so nothing exported or shown
  // elsewhere differs from the page on screen. A draft that cannot be saved
  // stays open with its reason, and the action waits.
  function afterDraft(action: () => unknown): void {
    const settled = draftCommit?.() ?? true;
    if (settled === true) void action();
    else if (settled) void settled.then((saved) => saved && !disposed && action());
  }

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
    const focusedInFiles =
      focused instanceof HTMLElement && !!focused.closest("#editor-files-dialog");
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
        setActivePageId(
          pages.some((page) => page.id === snapshot.activePageId)
            ? snapshot.activePageId
            : (pages[0]?.id ?? null)
        );
        if (pages.length === 0) {
          setWorkspaceView("pages");
          if (filesOpen()) {
            invalidateFilesFocus();
            setFilesOpen(false);
          }
        }
        setHistory(
          trimOrganizationHistory(
            direction === "undo"
              ? { undo: current.undo.slice(0, -1), redo: [...current.redo, entry] }
              : { undo: [...current.undo, entry], redo: current.redo.slice(0, -1) },
            pages,
            entry
          )
        );
        const message = `${direction === "undo" ? "Undid" : "Redid"} ${entry.label}.`;
        setStatusMessage(message);
        if (filesOpen()) setFilesNotice(message);
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
            if (
              focused.isConnected &&
              !focused.matches(":disabled") &&
              !focusedInViewer &&
              !focusedInFiles
            )
              return;
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
              : focusedInFiles && filesOpen()
                ? '#editor-files-dialog [data-testid="editor-file-item"], [data-testid="editor-files-close-button"]'
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
                  const restoreFiles = restoreFilesAfterCleanup;
                  restoreFilesAfterCleanup = undefined;
                  restoreFiles?.();
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
    // History reaches into the Files dialog, whose list follows the restored files.
    const filesDialog = filesOpen()
      ? editorRoot.querySelector<HTMLElement>("#editor-files-dialog")
      : null;
    const dialogTarget = target.closest('[role="dialog"], dialog');
    if (
      target.isContentEditable ||
      target.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="menu"]'
      ) ||
      (dialogTarget && dialogTarget !== filesDialog)
    )
      return;
    const openOverlays = document.querySelectorAll(
      'dialog[open], [role="dialog"][aria-modal="true"], [role="menu"]'
    );
    if (Array.from(openOverlays).some((overlay) => overlay !== filesDialog)) return;
    const key = event.key.toLowerCase();
    const direction =
      key === "z"
        ? event.shiftKey
          ? "redo"
          : "undo"
        : key === "y" && event.ctrlKey && !event.metaKey && !event.shiftKey
          ? "redo"
          : null;
    if (!direction) return;
    // Outside its input, the browser's own undo would still rewrite an open
    // draft's text. Leave the draft exactly as it is until it is saved or canceled.
    if (draftOpen()) event.preventDefault();
    else if (restoreOrganization(direction)) event.preventDefault();
  }

  function getUnmodifiedSourceFile(): File | null {
    if (pages.length === 0) return null;

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
    if (pages.length === 0 || activePageCount() === 0) {
      return "Restore marked pages to compress the original PDF";
    }
    if (new Set(pages.map((page) => page.sourceFile)).size > 1) {
      return "Compress works on one untouched PDF";
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

  // Where focus goes when the toast that holds it is dismissed with its × button.
  let toastReturnFocus: HTMLElement | null = null;

  function dismissToastWithFocus(id: number, toastElement: HTMLElement) {
    const hadFocus = toastElement.contains(document.activeElement);
    const nextToastDismiss = toastElement.nextElementSibling?.querySelector<HTMLElement>(
      '[data-testid="editor-toast-dismiss"]'
    );
    dismissToast(id);
    if (!hadFocus) return;
    queueMicrotask(() => {
      if (disposed) return;
      const target =
        nextToastDismiss?.isConnected === true
          ? nextToastDismiss
          : toastReturnFocus?.isConnected && !toastReturnFocus.hasAttribute("disabled")
            ? toastReturnFocus
            : editorRoot?.querySelector<HTMLElement>(
                'button:not(:disabled), input:not(:disabled), [tabindex="0"]'
              );
      toastReturnFocus = null;
      target?.focus();
    });
  }

  function dismissToast(id: number) {
    const timer = toastTimers.get(id);
    if (timer) {
      window.clearTimeout(timer);
      toastTimers.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }

  function startToastTimer(id: number, tone: ToastTone) {
    if (disposed) return;
    const existing = toastTimers.get(id);
    if (existing) window.clearTimeout(existing);
    const timeout = tone === "error" ? TOAST_ERROR_DISMISS_TIMEOUT_MS : TOAST_DISMISS_TIMEOUT_MS;
    toastTimers.set(
      id,
      window.setTimeout(() => dismissToast(id), timeout)
    );
  }

  function pauseToastTimer(id: number) {
    const timer = toastTimers.get(id);
    if (timer) {
      window.clearTimeout(timer);
      toastTimers.delete(id);
    }
  }

  function addToast(message: string, tone: ToastTone) {
    if (disposed) return;
    const id = ++nextToastId;
    startToastTimer(id, tone);
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
    document.addEventListener("keydown", handleSelectionEscape);
    document.addEventListener("focusin", rememberFocus);
    window.addEventListener("resize", retainVisibleFocus);
    // The workspace lives only in this page, so leaving it loses every page,
    // including pages that undo could still bring back.
    onCleanup(guardLeave(() => !disposed && (pages.length > 0 || history().undo.length > 0)));
    onCleanup(() => {
      document.removeEventListener("keydown", handleHistoryKeyDown);
      document.removeEventListener("keydown", handleSelectionEscape);
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

  function getSkippedFile(file: File, error: unknown): SkippedFile {
    if (isInvalidPDFError(error)) return { kind: "invalid-pdf", name: file.name };
    return {
      kind: "load-error",
      name: file.name,
      message: error instanceof Error ? error.message : "",
    };
  }

  /** Open one PDF, asking for its password when needed. Failures become skips. */
  function openPdfFile(
    service: PDFProcessingShape,
    file: File
  ): Effect.Effect<number | SkippedFile, never, never> {
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
      Effect.flatMap(
        (loaded): Effect.Effect<number | SkippedFile, unknown> =>
          loaded ? service.getPageCount : Effect.succeed({ kind: "locked", name: file.name })
      ),
      Effect.catch((error) => Effect.succeed(getSkippedFile(file, error)))
    );
  }

  function loadPdfFile(service: PDFProcessingShape, file: File) {
    return openPdfFile(service, file).pipe(
      Effect.map((result) => {
        if (typeof result === "number") return result;
        if (result.kind !== "locked") dispatchToast(describeSkippedFile(result), "error");
        return null;
      })
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

    const skipped: SkippedFile[] = files
      .filter((file) => getSupportedFileKind(file) === null)
      .map((file) => ({ kind: "unsupported", name: file.name }));
    if (skipped.length === files.length) {
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
          let committed = false;
          let pdfCount = 0;
          let imageCount = 0;

          return Effect.gen(function* () {
            for (const group of groups) {
              let pdfFile: File;
              if (group.kind === "images") {
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
                        skipped.push({
                          kind: "image-error",
                          count: group.files.length,
                          message:
                            error instanceof PDFProcessingError
                              ? error.message
                              : "Failed to create a PDF from the selected images.",
                        });
                        return null;
                      })
                    )
                  );
                if (disposed) return false;
                if (!generatedFile) continue;
                pdfFile = generatedFile;
              } else {
                pdfFile = group.files[0];
              }

              setOperation(mode === "upload" && loadedFiles.length === 0 ? "uploading" : "adding");
              setStatusMessage(`Loading ${pdfFile.name}…`);
              const result = yield* openPdfFile(service, pdfFile);
              if (disposed) return false;
              if (typeof result !== "number") {
                if (group.kind === "images") {
                  // The generated PDF is internal; report the images it came from.
                  skipped.push({
                    kind: "image-error",
                    count: group.files.length,
                    message: "Failed to create a PDF from the selected images.",
                  });
                } else {
                  skipped.push(result);
                }
                continue;
              }
              if (group.kind === "images") imageCount += group.files.length;
              else pdfCount += group.files.length;
              loadedFiles.push({ file: pdfFile, pageCount: result });
            }

            const opened = pdfCount + imageCount;
            const outcome = describeImportOutcome(mode, files.length, opened, skipped);
            if (opened === 0) {
              if (outcome) dispatchToast(outcome, "error");
              return false;
            }
            commitWorkspaceFiles(loadedFiles, phase() === "upload");
            committed = true;
            if (outcome) {
              dispatchToast(outcome, "error");
              setStatusMessage(outcome);
            } else {
              setStatusMessage(describeLoadedFiles(mode, pdfCount, imageCount));
            }
            return true;
          }).pipe(
            Effect.onExit(() =>
              committed
                ? Effect.void
                : Effect.forEach(
                    loadedFiles.filter(({ file }) => !existingFiles.has(file)),
                    ({ file }) =>
                      Effect.suspend(() => service.releaseFile(file)).pipe(Effect.ignoreCause),
                    { discard: true }
                  )
            ),
            Effect.onExit(() =>
              Effect.sync(() => {
                if (committed) {
                  if (!disposed) setOperation("idle");
                } else setReadyStatus();
              })
            )
          );
        })
      )
    ).catch(() => false);
  }

  // Older browsers do not fire `cancel` on file inputs; the window regains focus either way.
  function changeFilePickerOpen(open: boolean): void {
    setFilePickerOpen(open);
    if (open) window.addEventListener("focus", () => setFilePickerOpen(false), { once: true });
  }

  function requestAddFiles(): void {
    if (isBusy()) return;
    setFilesOpen(false);
    changeFilePickerOpen(true);
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

  // On narrow screens Files sits in the closed overflow list, so focus
  // returns to the overflow trigger instead.
  function filesReturnTarget(): HTMLButtonElement | undefined {
    if (filesButton?.getClientRects().length) return filesButton;
    return moreButton?.getClientRects().length ? moreButton : filesButton;
  }

  function closeFilesDialog(): void {
    invalidateFilesFocus();
    const version = filesFocusGeneration;
    const view = workspaceView();
    const focused = document.activeElement;
    setFilesOpen(false);
    setFilesNotice("");
    queueMicrotask(() => {
      if (disposed || version !== filesFocusGeneration || workspaceView() !== view) return;
      const returnTarget = filesReturnTarget();
      if (
        document.activeElement !== document.body &&
        document.activeElement !== focused &&
        document.activeElement !== returnTarget
      )
        return;
      const target =
        filesButton?.disabled && returnTarget === filesButton
          ? editorRoot.querySelector<HTMLButtonElement>('[data-testid="editor-undo-button"]')
          : returnTarget;
      target?.focus();
      if (
        (operation() === "removing" || operation() === "restoring") &&
        pages.length > 0 &&
        filesButton?.disabled
      ) {
        const fallback = document.activeElement;
        // Cleanup can outlive closing the dialog. Return to Files once enabled,
        // only while focus still belongs to the fallback chosen above.
        restoreFilesAfterCleanup = () => {
          if (
            !disposed &&
            version === filesFocusGeneration &&
            workspaceView() === view &&
            !filesOpen() &&
            filesButton?.isConnected &&
            !filesButton.disabled &&
            document.activeElement === fallback
          )
            filesReturnTarget()?.focus({ preventScroll: true });
        };
      }
    });
  }

  function changeWorkspaceView(view: "pages" | "document"): void {
    invalidateFilesFocus();
    if (view === "document") {
      if (pages.length === 0) return;
      if (!pages.some((page) => page.id === activePageId())) setActivePageId(pages[0]?.id ?? null);
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
    // The selection bar closes with the selection. Focus that was inside it
    // moves to the active page.
    queueMicrotask(() => {
      if (disposed || !editorRoot.isConnected) return;
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused !== document.body && focused.isConnected)
        return;
      const index = Math.max(
        0,
        pages.findIndex((page) => page.id === activePageId())
      );
      const target =
        workspaceView() === "pages"
          ? editorRoot.querySelector<HTMLElement>(
              `[data-testid="editor-page-tile"][data-page-index="${index}"]`
            )
          : editorRoot.querySelector<HTMLElement>(
              '.editor-review-filmstrip-item[aria-current="page"]'
            );
      (target ?? downloadButton)?.focus({ preventScroll: true });
    });
  }

  function handleSelectionEscape(event: KeyboardEvent): void {
    if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
    if (phase() !== "edit" || selectedIndices().size === 0 || isBusy() || draftOpen()) return;
    const target = event.target;
    if (
      !(target instanceof HTMLElement) ||
      (target !== document.body && !editorRoot.contains(target))
    )
      return;
    if (
      target.isContentEditable ||
      target.closest(
        'input, textarea, select, [role="textbox"], [role="menu"], [role="dialog"], dialog'
      ) ||
      document.querySelector('dialog[open], [role="dialog"][aria-modal="true"], [role="menu"]')
    )
      return;
    event.preventDefault();
    clearSelection();
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
      setPages(reconcile(copyOrganizationPages(remainingPages), { key: "id" }));
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
        ? `Removed ${removedFileName}. The workspace is empty. Press Ctrl/Cmd+Z to undo.`
        : `Removed ${removedFileName} and ${formatPageCount(removedPageCount)}.`
    );
    // The modal Files dialog makes the status bar inert, so announce inside it.
    setFilesNotice(
      remainingPages.length === 0
        ? ""
        : `Removed ${removedFileName} and ${formatPageCount(removedPageCount)}. Press Ctrl/Cmd+Z to undo.`
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
      const restoreFiles = restoreFilesAfterCleanup;
      restoreFilesAfterCleanup = undefined;
      if (!disposed) {
        setOperation("idle");
        if (restoreFiles) queueMicrotask(restoreFiles);
        if (
          remainingPages.length === 0 &&
          (document.activeElement === document.body ||
            document.activeElement === filesButton ||
            // Closing the modal returns focus to More when Files sat in its list.
            document.activeElement === moreButton ||
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
    // Keep Extract targeting the same originals when a copy is inserted.
    organize("page duplication", () => {
      setPages(produce((draft) => draft.splice(index + 1, 0, copy)));
      setSelectedIndices((selection) => remapSelectionAfterInsert(selection, index + 1));
      if (selectedIndices().size === 0) setActivePageId(copy.id);
    });
    setStatusMessage(`Duplicated page ${index + 1} as page ${index + 2}.`);
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
    rotatePage(index);
  }

  function rotatePage(index: number): void {
    if (isBusy() || !pages[index]) return;
    organize("page rotation", () => setPages(index, "rotation", (r) => (r + ROTATION_STEP) % 360));
    setStatusMessage(`Rotated page ${index + 1}.`);
  }

  function handlePageDelete(index: number, e: MouseEvent): void {
    e.stopPropagation();
    togglePageDeletion(index);
  }

  function togglePageDeletion(index: number): void {
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

  function handleRotateSelected(direction: "left" | "right"): void {
    if (isBusy() || selectedIndices().size === 0) return;
    const step = direction === "right" ? ROTATION_STEP : 360 - ROTATION_STEP;
    organize("selected page rotation", () => {
      for (const index of selectedIndices()) {
        setPages(index, "rotation", (r) => (r + step) % 360);
      }
    });
    setStatusMessage(
      `Rotated ${formatPageCount(selectedIndices().size).replace("page", "selected page")} ${direction}.`
    );
  }

  function handleDuplicateSelected(): void {
    if (isBusy() || selectedIndices().size === 0) return;
    const indices = Array.from(selectedIndices()).sort((a, b) => a - b);
    const copies = indices.map((index) => duplicatePageState(pages[index]));
    organize("selected page duplication", () => {
      setPages(
        produce((draft) => {
          for (let k = indices.length - 1; k >= 0; k--) draft.splice(indices[k] + 1, 0, copies[k]);
        })
      );
      // Each copy follows its original, so earlier copies shift later ones by one.
      setSelectedIndices(new Set(indices.map((index, k) => index + k + 1)));
      setActivePageId(copies[0]?.id ?? null);
    });
    setStatusMessage(
      `Duplicated ${formatPageCount(indices.length).replace("page", "selected page")}. The copies are selected.`
    );
  }

  // --- Document page actions ---

  function documentPageIndex(pageId: string): number {
    return isBusy() ? -1 : pages.findIndex((page) => page.id === pageId);
  }

  function handleDocumentRotate(pageId: string): void {
    const index = documentPageIndex(pageId);
    if (index < 0) return;
    organize("page rotation", () => setPages(index, "rotation", (r) => (r + ROTATION_STEP) % 360));
    setStatusMessage(`Rotated page ${index + 1}.`);
  }

  function handleDocumentDuplicate(pageId: string): void {
    const index = documentPageIndex(pageId);
    if (index < 0) return;
    const copy = duplicatePageState(pages[index]);
    organize("page duplication", () => {
      setPages(produce((draft) => draft.splice(index + 1, 0, copy)));
      setSelectedIndices(
        (selection) => new Set(Array.from(selection, (i) => (i > index ? i + 1 : i)))
      );
      setActivePageId(copy.id);
    });
    setStatusMessage(`Duplicated page ${index + 1}. Showing page ${index + 2}.`);
  }

  function handleDocumentDeletion(pageId: string): void {
    const index = documentPageIndex(pageId);
    if (index < 0) return;
    const marked = pages[index].markedForDeletion;
    organize(marked ? "page restoration" : "deletion marking", () =>
      setPages(index, "markedForDeletion", !marked)
    );
    setStatusMessage(
      marked ? `Restored page ${index + 1}.` : `Marked page ${index + 1} for deletion.`
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

  // Download always builds every exportable page. Extract builds the selection.
  async function exportPDF(pageIndices?: number[]): Promise<void> {
    if (disposed || isBusy()) return;
    const totalPages = pageIndices
      ? pageIndices.filter((index) => !pages[index]?.markedForDeletion).length
      : activePageCount();
    const label = pageIndices ? "Extracting selected pages" : "Exporting PDF";

    setOperation("building");
    setStatusMessage(`${label}… 0/${totalPages}`);

    try {
      const result = await runPDF(
        PDFProcessing.use((service) =>
          service.buildPDF(pages, {
            selectedIndices: pageIndices,
            onProgress: ({ completed, total }) => {
              if (disposed) return;
              setStatusMessage(`${label}… ${completed}/${total}`);
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
        ? `${error.file ? `${error.file.name}: ` : ""}${error.message} Extract pages from other files, or remove this file, then try again.`
        : undefined;
      dispatchToast(constraintMessage ?? "Failed to export the PDF.", "error");
      setStatusMessage(constraintMessage ?? "Export failed. Try again.");
    } finally {
      if (!disposed) setOperation("idle");
    }
  }

  function sortedSelection(): number[] {
    return Array.from(selectedIndices()).sort((a, b) => a - b);
  }

  function handleDownload(): Promise<void> {
    return exportPDF();
  }

  function handleExtract(): Promise<void> {
    if (selectedIndices().size === 0) return Promise.resolve();
    return exportPDF(sortedSelection());
  }

  async function exportImages(pageIndices: number[] | undefined, label: string): Promise<void> {
    if (disposed || isBusy()) return;
    const totalPages = pageIndices
      ? pageIndices.filter((index) => !pages[index]?.markedForDeletion).length
      : activePageCount();

    setOperation("exporting-images");
    setStatusMessage(`${label}… 0/${totalPages}`);

    try {
      const result = await runPDF(
        PDFProcessing.use((service) =>
          service.exportImages(pages, {
            selectedIndices: pageIndices,
            onProgress: ({ completed, total }) => {
              if (disposed) return;
              setStatusMessage(`${label}… ${completed}/${total}`);
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

  function handleExportImages(): Promise<void> {
    return exportImages(undefined, "Exporting images");
  }

  function handleExportSelectedImages(): Promise<void> {
    if (selectedIndices().size === 0) return Promise.resolve();
    return exportImages(sortedSelection(), "Exporting selected images");
  }

  function handleExportPageImage(pageId: string): Promise<void> {
    const index = documentPageIndex(pageId);
    if (index < 0 || pages[index].markedForDeletion) return Promise.resolve();
    return exportImages([index], `Exporting page ${index + 1} image`);
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
      const outcome = result.reduced
        ? `Saved ${formatSavedPercent(result.inputBytes, result.outputBytes)} (${formatSizeChange(result.inputBytes, result.outputBytes)}).`
        : "Already optimal. Exported the original.";
      dispatchToast(outcome, result.reduced ? "success" : "info");
      setStatusMessage(`Export started. ${outcome}`);
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
    if (isBusy() || e.isComposing) return;
    if (!e.altKey && !e.ctrlKey && !e.metaKey) {
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        rotatePage(index);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        togglePageDeletion(index);
      }
      return;
    }
    if (!e.altKey) return;

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
        class="editor-toast-region"
      >
        <For each={toasts()}>
          {(toast) => (
            <Show
              when={toast.tone === "error"}
              fallback={
                <div
                  data-testid="editor-toast"
                  role="status"
                  class={`editor-toast editor-toast-${toast.tone}`}
                >
                  {toast.message}
                </div>
              }
            >
              <div
                data-testid="editor-toast"
                role="alert"
                class="editor-toast editor-toast-error editor-toast-dismissible"
                onPointerEnter={() => pauseToastTimer(toast.id)}
                onPointerLeave={() => {
                  if (!document.activeElement?.closest(`[data-toast-id="${toast.id}"]`))
                    startToastTimer(toast.id, toast.tone);
                }}
                onFocusIn={(event) => {
                  pauseToastTimer(toast.id);
                  const from = event.relatedTarget;
                  if (from instanceof HTMLElement && !event.currentTarget.contains(from))
                    toastReturnFocus = from;
                }}
                onFocusOut={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                    startToastTimer(toast.id, toast.tone);
                }}
                data-toast-id={toast.id}
              >
                <span class="editor-toast-message">{toast.message}</span>
                <EditorButton
                  data-testid="editor-toast-dismiss"
                  class="editor-toast-dismiss"
                  aria-label="Dismiss notification"
                  title="Dismiss"
                  variant="plain"
                  icon="close"
                  onClick={(event) =>
                    dismissToastWithFocus(
                      toast.id,
                      event.currentTarget.closest<HTMLElement>("[data-toast-id]") ??
                        event.currentTarget
                    )
                  }
                />
              </div>
            </Show>
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
              <a href={base} class="editor-brand" aria-label="Interleaf home">
                <Wordmark />
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
            <h1 class="sr-only">Interleaf PDF editor</h1>
            <EditorToolbar
              base={base}
              view={workspaceView()}
              pageCount={pages.length}
              pageCountLabel={pageCountLabel()}
              exportableCount={activePageCount()}
              filesLabel={filesButtonLabel()}
              filesOpen={filesOpen()}
              busy={isBusy()}
              busyLabel={statusMessage()}
              undoLabel={history().undo.at(-1)?.label}
              redoLabel={history().redo.at(-1)?.label}
              historyUnavailable={historyUnavailable()}
              historyBlockedReason={
                draftOpen() ? "Save or cancel the open edit to use undo and redo." : undefined
              }
              compressionAvailable={getUnmodifiedSourceFile() !== null}
              compressionDisabledReason={compressionDisabledReason()}
              filesButtonRef={(element) => {
                filesButton = element;
              }}
              moreButtonRef={(element) => {
                moreButton = element;
              }}
              downloadButtonRef={(element) => {
                downloadButton = element;
              }}
              onViewChange={(view) =>
                view === "pages"
                  ? afterDraft(() => changeWorkspaceView("pages"))
                  : changeWorkspaceView(view)
              }
              onAddFiles={() => afterDraft(requestAddFiles)}
              onOpenFiles={() => afterDraft(() => setFilesOpen(true))}
              onUndo={() => restoreOrganization("undo")}
              onRedo={() => restoreOrganization("redo")}
              onDownload={() => afterDraft(handleDownload)}
              onExportImages={() => afterDraft(handleExportImages)}
              onCompress={() => afterDraft(handleCompress)}
            />
            <Show when={selectedIndices().size > 0}>
              <EditorSelectionBar
                busy={isBusy()}
                busyLabel={statusMessage()}
                selectedCount={selectedIndices().size}
                selectedActiveCount={selectedActivePageCount()}
                allPagesSelected={allPagesSelected()}
                deletionLabel={deletionCopy().label}
                deletionAriaLabel={deletionCopy().ariaLabel}
                onClearSelection={clearSelection}
                onSelectAll={handleSelectAll}
                onRotateLeft={() => afterDraft(() => handleRotateSelected("left"))}
                onRotateRight={() => afterDraft(() => handleRotateSelected("right"))}
                onDuplicate={() => afterDraft(handleDuplicateSelected)}
                onDelete={() => afterDraft(handleDeleteSelected)}
                onExtract={() => afterDraft(handleExtract)}
                onExportImages={() => afterDraft(handleExportSelectedImages)}
              />
            </Show>
            <p
              class="sr-only"
              aria-live="polite"
              aria-atomic="true"
              data-testid="editor-selection-status"
            >
              {selectionAnnouncement()}
            </p>
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
                    activePageId={activePageId()}
                    runtime={pdfRuntime}
                    onRotatePage={(pageId) => afterDraft(() => handleDocumentRotate(pageId))}
                    onDuplicatePage={(pageId) => afterDraft(() => handleDocumentDuplicate(pageId))}
                    onTogglePageDeletion={(pageId) =>
                      afterDraft(() => handleDocumentDeletion(pageId))
                    }
                    onExportPageImages={(pageId) => afterDraft(() => handleExportPageImage(pageId))}
                    onActivePageChange={(pageId) => setActivePageId(pageId)}
                    onDraftChange={setDraftOpen}
                    registerDraftCommit={(commit) => {
                      draftCommit = commit;
                    }}
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
                    onFieldChange={(pageId, fieldRef, value, originalValue) =>
                      organize("Fill text field", () =>
                        setPages(
                          reconcile(answerField(pages, pageId, fieldRef, value, originalValue), {
                            key: "id",
                          })
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
                <h2 id="editor-pages-title" class="sr-only">
                  Pages
                </h2>
                <Show
                  when={pages.length > 0}
                  fallback={
                    <EditorUploader
                      busy={isBusy()}
                      statusMessage={statusMessage()}
                      onFilesSelected={handleInitialFiles}
                      onPickerChange={changeFilePickerOpen}
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
              notice={filesNotice()}
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
