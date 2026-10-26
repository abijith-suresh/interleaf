import { Effect, Exit, Fiber } from "effect";
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { ROTATION_STEP, TOAST_DISMISS_TIMEOUT_MS } from "../../../../constants";
import { planUploadGroups } from "../../../../controllers/editor-import";
import {
  areAllPagesSelected,
  createPageStates,
  type DeletionAction,
  getDeletionAction,
  remapSelectionAfterMove,
  toggleSelectAll,
  toggleSelection,
} from "../../../../controllers/editor-page-state";
import { QpdfProcessingError } from "../../../../services/qpdf-processing";
import { downloadFile, downloadPDF } from "../../../../utils/download";
import { getSupportedFileKind } from "../../../../utils/file-types";
import { promptForPassword } from "../../../../utils/password-prompt";
import {
  showToast as dispatchToast,
  TOAST_EVENT_NAME,
  type ToastDetail,
} from "../../../../utils/toast";
import { EditorHistory, type EditorHistoryEntry } from "../../controllers/editor-history";
import { groupWorkspaceFiles, type WorkspaceFile } from "../../controllers/editor-workspace";
import type { PDFDocumentCheckpoint } from "../../services/pdf-checkpoint";
import { makePDFRuntime, PDFProcessing, type PDFProcessingShape } from "../../services/pdf-runtime";
import type { PageState } from "../../types/interfaces";
import { PDFProcessingError } from "../../types/interfaces";
import EditorFilesDialog from "./EditorFilesDialog";
import EditorHistoryControls from "./EditorHistoryControls";
import EditorPageGrid from "./EditorPageGrid";
import EditorPageViewer from "./EditorPageViewer";
import EditorSelectionBar from "./EditorSelectionBar";
import EditorToolRail, { type EditorWorkspaceTool } from "./EditorToolRail";
import EditorUploader from "./EditorUploader";
import EditorButton from "./ui/EditorButton";
import EditorIcon from "./ui/EditorIcon";

interface DragOverTarget {
  index: number;
  direction: "before" | "after";
}

type EditorOperation =
  | "undoing"
  | "redoing"
  | "removing"
  | "duplicating"
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

interface LoadedWorkspaceFile {
  file: File;
  pageCount: number;
}

interface WorkspaceHistoryState {
  pages: PageState[];
  selectedIndices: Set<number>;
  activePageId: string | null;
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
  let preloadIdleCallback: number | null = null;
  let preloadTimer: number | null = null;

  onMount(() => {
    window.addEventListener("keydown", handleHistoryKey);
    onCleanup(() => window.removeEventListener("keydown", handleHistoryKey));
    const preload = () => {
      preloadIdleCallback = null;
      preloadTimer = null;
      if (disposed) return;
      void pdfRuntime
        .runPromise(PDFProcessing.use((service) => service.preload))
        .catch(() => undefined);
    };
    if (typeof window.requestIdleCallback === "function") {
      preloadIdleCallback = window.requestIdleCallback(preload, { timeout: 1_000 });
    } else {
      preloadTimer = window.setTimeout(preload, 300);
    }
  });

  const [phase, setPhase] = createSignal<"upload" | "edit">("upload");
  const [pages, setPages] = createStore<PageState[]>([]);
  const [selectedIndices, setSelectedIndices] = createSignal<Set<number>>(new Set<number>());
  const [dragSourceIndex, setDragSourceIndex] = createSignal<number | null>(null);
  const [dragOverTarget, setDragOverTarget] = createSignal<DragOverTarget | null>(null);
  const [filesOpen, setFilesOpen] = createSignal(false);
  const [workspaceTool, setWorkspaceTool] =
    createSignal<Exclude<EditorWorkspaceTool, "pages">>("read");
  const [canvasOpen, setCanvasOpen] = createSignal(false);
  const [activePageId, setActivePageId] = createSignal<string | null>(null);
  const [operation, setOperation] = createSignal<EditorOperation>("idle");
  const [statusMessage, setStatusMessage] = createSignal("Your files never leave your device.");
  const [toasts, setToasts] = createSignal<Toast[]>([]);
  const history = new EditorHistory<WorkspaceHistoryState>();
  const [historyVersion, setHistoryVersion] = createSignal(0);
  const [contentBusy, setContentBusy] = createSignal(false);
  const [contentDraft, setContentDraft] = createSignal(false);

  const activePageCount = () => pages.filter((p) => !p.markedForDeletion).length;
  const markedPageCount = () => pages.length - activePageCount();
  const pageStatusSummary = () => {
    if (pages.length === 0) return "No pages.";
    if (markedPageCount() === 0) return `${pages.length} pages.`;
    return `${activePageCount()} of ${pages.length} pages exportable.`;
  };
  const selectedActivePageCount = () =>
    Array.from(selectedIndices()).filter((index) => !pages[index]?.markedForDeletion).length;
  const isBusy = () => operation() !== "idle" || contentBusy();
  function captureWorkspace(): WorkspaceHistoryState {
    return {
      pages: pages.map((page) => ({ ...page })),
      selectedIndices: new Set(selectedIndices()),
      activePageId: activePageId(),
    };
  }
  function recordHistory(
    label: string,
    state = captureWorkspace(),
    documents: EditorHistoryEntry<WorkspaceHistoryState>["documents"] = []
  ) {
    history.record({ label, state, documents });
    setHistoryVersion((value) => value + 1);
  }
  const historyActions = () => {
    historyVersion();
    return {
      undoLabel: history.getUndo()?.label,
      redoLabel: history.getRedo()?.label,
      busy: isBusy() || contentDraft() || dragSourceIndex() !== null,
      onUndo: () => {
        void travelHistory(false);
      },
      onRedo: () => {
        void travelHistory(true);
      },
    };
  };
  async function travelHistory(redo: boolean) {
    if (disposed || isBusy() || contentDraft() || dragSourceIndex() !== null) return;
    const entry = redo ? history.getRedo() : history.getUndo();
    if (!entry) return;
    const restoreHistoryFocus =
      document.activeElement instanceof HTMLElement &&
      !!document.activeElement.closest(".editor-history-controls");
    const current = captureWorkspace();
    const currentFiles = new Set(current.pages.map((page) => page.sourceFile));
    const targetFiles = new Set(entry.state.pages.map((page) => page.sourceFile));
    const inverse = new Map<File, PDFDocumentCheckpoint>();
    const restored: { file: File; previous?: PDFDocumentCheckpoint }[] = [];
    setOperation(redo ? "redoing" : "undoing");
    setStatusMessage(redo ? "Redoing change…" : "Undoing change…");
    try {
      await runPDF(
        PDFProcessing.use((service) =>
          Effect.gen(function* () {
            for (const file of currentFiles) {
              if (!targetFiles.has(file)) inverse.set(file, yield* service.snapshotDocument(file));
            }
            for (const document of entry.documents) {
              const previous = yield* service.restoreDocument(document.file, document.checkpoint);
              restored.push({ file: document.file, previous });
              if (previous) inverse.set(document.file, previous);
            }
          })
        )
      );
      if (disposed) return;
      setPages(entry.state.pages.map((page) => ({ ...page })));
      setSelectedIndices(new Set(entry.state.selectedIndices));
      setActivePageId(entry.state.activePageId);
      setDragSourceIndex(null);
      setDragOverTarget(null);
      setPhase(entry.state.pages.length ? "edit" : "upload");
      if (!entry.state.pages.length) {
        setCanvasOpen(false);
        setFilesOpen(false);
      }
      const inverseEntry = {
        label: entry.label,
        state: current,
        documents: [...inverse].map(([file, checkpoint]) => ({ file, checkpoint })),
      };
      if (redo) history.commitRedo(inverseEntry);
      else history.commitUndo(inverseEntry);
      setHistoryVersion((value) => value + 1);
      setStatusMessage(`${redo ? "Redid" : "Undid"} ${entry.label}.`);
      // Archived history retains bytes, not native document handles.
      await runPDF(
        PDFProcessing.use((service) =>
          Effect.forEach(
            [...currentFiles].filter((file) => !targetFiles.has(file)),
            (file) => service.releaseFile(file).pipe(Effect.ignoreCause),
            { discard: true }
          )
        )
      );
    } catch (error) {
      // Restore only the native documents already changed by this attempted action.
      await pdfRuntime
        .runPromise(
          PDFProcessing.use((service) =>
            Effect.forEach(
              [...restored].reverse(),
              ({ file, previous }) =>
                previous
                  ? service.restoreDocument(file, previous).pipe(Effect.ignoreCause)
                  : service.releaseFile(file).pipe(Effect.ignoreCause),
              { discard: true }
            )
          )
        )
        .catch(() => undefined);
      if (!disposed)
        dispatchToast(
          error instanceof Error ? error.message : "Could not restore this change.",
          "error"
        );
    } finally {
      if (!disposed) setOperation("idle");
      if (!disposed && restoreHistoryFocus)
        queueMicrotask(() => {
          const groups = [...editorRoot.querySelectorAll<HTMLElement>(".editor-history-controls")];
          const group = groups.find((item) => !item.closest('[inert], [aria-hidden="true"]'));
          const same = group?.querySelector<HTMLButtonElement>(
            `button[aria-label^="${redo ? "Redo" : "Undo"}"]:not(:disabled)`
          );
          (same ?? group?.querySelector<HTMLButtonElement>("button:not(:disabled)"))?.focus({
            preventScroll: true,
          });
        });
    }
  }
  function handleHistoryKey(event: KeyboardEvent) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.defaultPrevented) return;
    if (editorRoot?.querySelector("dialog[open], [role=menu]")) return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.closest("input, textarea, select, [contenteditable=true]") ||
        target.closest("[role=menu], .editor-tools-sheet"))
    )
      return;
    const key = event.key.toLowerCase();
    const redo = (key === "z" && event.shiftKey) || (key === "y" && event.ctrlKey);
    if (key !== "z" && !redo) return;
    const actions = historyActions();
    if (actions.busy || !(redo ? actions.redoLabel : actions.undoLabel)) return;
    event.preventDefault();
    if (redo) actions.onRedo();
    else actions.onUndo();
  }
  const workspacePageIds = createMemo(() => pages.map((page) => page.id));
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
        !page.markedForDeletion &&
        !page.contentRevision
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

  onCleanup(() => {
    disposed = true;
    history.clear();
    if (preloadIdleCallback !== null) window.cancelIdleCallback(preloadIdleCallback);
    if (preloadTimer !== null) window.clearTimeout(preloadTimer);
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

  function commitWorkspaceFiles(files: LoadedWorkspaceFile[], replace: boolean): void {
    const before = captureWorkspace();
    const nextPages = files.flatMap(({ file, pageCount }) => createPageStates(file, pageCount));
    if (replace) {
      setPages(nextPages);
      setSelectedIndices(new Set<number>());
      setActivePageId(nextPages[0]?.id ?? null);
      setCanvasOpen(false);
      setPhase("edit");
      if (history.undoCount || history.redoCount) recordHistory("add files", before);
      return;
    }

    setPages(
      produce((draftPages) => {
        draftPages.push(...nextPages);
      })
    );
    if (!activePageId()) setActivePageId(nextPages[0]?.id ?? null);
    recordHistory("add files", before);
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
    if (disposed || files.length === 0) return false;

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

            commitWorkspaceFiles(loadedFiles, mode === "upload");
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
    addPdfInput.click();
  }

  function handleAddFilesInput(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (files.length === 0) return;
    void loadFilesIntoWorkspace(files, "add");
  }

  function closeFilesDialog(): void {
    setFilesOpen(false);
    queueMicrotask(() => filesButton?.focus());
  }

  function openCanvas(): void {
    if (isBusy()) return;
    const ids = workspacePageIds();
    if (ids.length === 0) return;

    const activeId = activePageId();
    if (!activeId || !ids.includes(activeId)) setActivePageId(ids[0]);
    setCanvasOpen(true);
  }

  function chooseWorkspaceTool(tool: EditorWorkspaceTool) {
    if (isBusy()) return;
    if (tool === "pages") closeCanvas();
    else {
      setWorkspaceTool(tool);
      openCanvas();
    }
  }
  async function duplicatePage(index: number) {
    if (isBusy()) return;
    const page = pages[index];
    if (!page) return;
    const before = captureWorkspace();
    setOperation("duplicating");
    setStatusMessage("Duplicating page…");
    try {
      const content = await runPDF(
        PDFProcessing.use((service) =>
          service.getPageContent(page.sourceFile, page.sourcePageNumber)
        )
      );
      if (
        content.fields.some(
          (field) =>
            ![2, 3, 4, 5, 6].includes(field.type) ||
            !!(field.flags & ((1 << 21) | (1 << 24))) ||
            ([4, 5].includes(field.type) &&
              field.selectedOption >= 0 &&
              field.value !== field.options[field.selectedOption])
        )
      )
        throw new Error(
          "This page has form fields that cannot be copied safely. Export this PDF separately to preserve its form data."
        );
      const result = await runPDF(
        PDFProcessing.use((service) => service.buildPDF([{ ...page, markedForDeletion: false }]))
      );
      if (disposed) return;
      const origin = page.sourceOrigin ?? page.sourceFile;
      const file = new File(
        [new Uint8Array(result.data)],
        `${origin.name.replace(/\.pdf$/i, "")} (copy).pdf`,
        { type: "application/pdf" }
      );
      const copy = { ...createPageStates(file, 1)[0], sourceOrigin: origin, contentRevision: 1 };
      setPages(
        produce((draft) => {
          draft.splice(index + 1, 0, copy);
        })
      );
      setSelectedIndices(canvasOpen() ? new Set<number>() : new Set([index + 1]));
      setActivePageId(copy.id);
      recordHistory("duplicate page", before);
      setStatusMessage(`Duplicated page ${index + 1}.`);
    } catch (error) {
      dispatchToast(
        error instanceof Error ? error.message : "Could not duplicate this page.",
        "error"
      );
    } finally {
      if (!disposed) setOperation("idle");
    }
  }

  function closeCanvas(): void {
    setCanvasOpen(false);
    queueMicrotask(() => {
      const pagesTool = editorRoot?.querySelector<HTMLButtonElement>(
        '.editor-tool-rail-item[aria-current="page"]'
      );
      (pagesTool ?? editorRoot)?.focus();
    });
  }

  async function handleInitialFiles(files: File[]): Promise<void> {
    if (disposed || isBusy() || files.length === 0) return;
    await loadFilesIntoWorkspace(files, "upload");
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
    const before = captureWorkspace();
    const removedPageCount = workspaceFile.pageCount;
    const removedFileName = file.name;
    const removedSources = new Set(
      workspaceFile.pageIndices.map((index) => pages[index].sourceFile)
    );
    setOperation("removing");
    let documents: { file: File; checkpoint: PDFDocumentCheckpoint }[];
    try {
      documents = await runPDF(
        PDFProcessing.use((service) =>
          Effect.forEach([...removedSources], (source) =>
            service
              .snapshotDocument(source)
              .pipe(Effect.map((checkpoint) => ({ file: source, checkpoint })))
          )
        )
      );
    } catch (error) {
      setOperation("idle");
      dispatchToast(
        error instanceof Error ? error.message : "Could not remove this file.",
        "error"
      );
      return;
    }
    if (disposed) return;

    const selection = selectedIndices();
    const nextSelection = new Set<number>();
    const remainingPages: PageState[] = [];
    pages.forEach((page, oldIndex) => {
      if ((page.sourceOrigin ?? page.sourceFile) === file) return;
      if (selection.has(oldIndex)) nextSelection.add(remainingPages.length);
      remainingPages.push(page);
    });
    setPages(remainingPages);
    setSelectedIndices(nextSelection);
    setDragSourceIndex(null);
    setDragOverTarget(null);
    if (!remainingPages.some((page) => page.id === activePageId())) {
      setActivePageId(remainingPages[0]?.id ?? null);
    }
    recordHistory("remove file", before, documents);

    if (remainingPages.length === 0) {
      setPhase("upload");
      setCanvasOpen(false);
      setFilesOpen(false);
      setStatusMessage(`Removed ${removedFileName}. The workspace is empty.`);
    } else {
      setStatusMessage(`Removed ${removedFileName} and ${formatPageCount(removedPageCount)}.`);
    }

    try {
      await runPDF(
        PDFProcessing.use((service) =>
          Effect.all([...removedSources].map((source) => service.releaseFile(source)))
        )
      );
    } catch {
      // Cleanup is best effort; the runtime also releases all remaining files
      // when the editor is disposed.
    }
    if (!disposed) setOperation("idle");
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
    if (!pages[index]) return;
    recordHistory("rotate page");
    setPages(index, "rotation", (r) => (r + ROTATION_STEP) % 360);
    setStatusMessage(`Rotated page ${index + 1}.`);
  }

  function handlePageDelete(index: number, e: MouseEvent): void {
    e.stopPropagation();
    if (isBusy()) return;
    if (!pages[index]) return;

    const markedForDeletion = pages[index]?.markedForDeletion ?? false;
    recordHistory(markedForDeletion ? "restore page" : "delete page");
    setPages(index, "markedForDeletion", !markedForDeletion);
    setStatusMessage(
      markedForDeletion ? `Restored page ${index + 1}.` : `Marked page ${index + 1} for deletion.`
    );
  }

  function handleRotateSelected(): void {
    if (isBusy() || selectedIndices().size === 0) return;
    recordHistory("rotate pages");
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
    recordHistory(markForDeletion ? "delete pages" : "restore pages");

    for (const index of selectedIndices()) {
      setPages(index, "markedForDeletion", markForDeletion);
    }
    setStatusMessage(
      `${markForDeletion ? "Marked" : "Restored"} ${selectedIndices().size} selected page${
        selectedIndices().size === 1 ? "" : "s"
      }${markForDeletion ? " for deletion" : ""}.`
    );
  }

  async function handleDownload(scope: "selection" | "workspace" = "selection"): Promise<void> {
    if (disposed || isBusy()) return;
    const selection = selectedIndices();
    const selectedPageIndices =
      scope === "selection" && selection.size > 0
        ? Array.from(selection).sort((a, b) => a - b)
        : undefined;
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
      dispatchToast(
        error instanceof PDFProcessingError ? error.message : "Failed to export the PDF.",
        "error"
      );
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
    recordHistory("reorder pages");

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
    let target: number | undefined;
    if (e.key === "ArrowLeft" && index > 0) {
      e.preventDefault();
      target = index - 1;
    } else if (e.key === "ArrowRight" && index < pages.length - 1) {
      e.preventDefault();
      target = index + 1;
    }
    if (target === undefined) return;
    movePage(index, target);
    queueMicrotask(() =>
      editorRoot
        ?.querySelector<HTMLButtonElement>(
          `[data-testid="editor-page-tile"][data-page-index="${target}"]`
        )
        ?.focus()
    );
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
    <div class="editor-app" classList={{ "has-workspace-tools": phase() === "edit" }}>
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
            <span class="editor-experiment-label">Experimental</span>
          </div>
          <h1 class="sr-only">Experimental PDFium workspace</h1>
          <div class="editor-header-right">
            <Show
              when={
                phase() === "upload" && (historyActions().undoLabel || historyActions().redoLabel)
              }
            >
              <EditorHistoryControls {...historyActions()} />
            </Show>
            <a href={base} class="editor-back" aria-label="Return to Interleaf home">
              <EditorIcon name="back" />
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
            <Show when={!canvasOpen()}>
              <EditorToolRail
                activeTool="pages"
                busy={isBusy()}
                onChooseTool={chooseWorkspaceTool}
              />
            </Show>
            <section class="editor-workspace-main" aria-labelledby="editor-pages-title">
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
              />
              <div class="editor-canvas-header">
                <h2 id="editor-pages-title">Pages</h2>
                <div class="editor-canvas-tools">
                  <span class="editor-canvas-count">{formatPageCount(pages.length)}</span>
                  <div class="editor-canvas-actions">
                    <EditorHistoryControls {...historyActions()} />
                    <EditorButton
                      variant="plain"
                      type="button"
                      data-testid="editor-add-pdf-button"
                      aria-label="Add PDFs or images"
                      onClick={requestAddFiles}
                      disabled={isBusy()}
                      class="editor-add-pdf"
                    >
                      <EditorIcon name="plus" />
                      <span class="editor-add-pdf-label">Add files</span>
                    </EditorButton>
                    <EditorButton
                      variant="plain"
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
                      <EditorIcon name="files" />
                      <span class="editor-files-button-label">Files</span>
                      <span class="editor-files-button-count">{workspaceFiles().length}</span>
                    </EditorButton>
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
                onPageDuplicate={(index, event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void duplicatePage(index);
                }}
                onPageOpen={(index) => {
                  setActivePageId(pages[index].id);
                  chooseWorkspaceTool("read");
                }}
                onPageDelete={handlePageDelete}
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
                onDownload={() => handleDownload()}
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
                {pageStatusSummary()}{" "}
                <span data-testid="editor-status-message">{statusMessage()}</span>
              </div>
            </section>
            <Show when={canvasOpen()}>
              <EditorPageViewer
                pages={pages}
                navigationPageIds={workspacePageIds()}
                activePageId={activePageId()}
                runtime={pdfRuntime}
                onActivePageChange={(pageId) => setActivePageId(pageId)}
                onContentChange={(file, pageNumber?: number) => {
                  for (const [index, page] of pages.entries()) {
                    if (
                      page.sourceFile === file &&
                      (pageNumber === undefined || page.sourcePageNumber === pageNumber)
                    )
                      setPages(index, "contentRevision", (page.contentRevision ?? 0) + 1);
                  }
                }}
                onCheckpoint={(file, checkpoint, label) =>
                  recordHistory(label, captureWorkspace(), [{ file, checkpoint }])
                }
                onEditBusy={setContentBusy}
                onDraftChange={setContentDraft}
                history={historyActions()}
                tool={workspaceTool()}
                onChooseTool={(tool) => {
                  if (tool !== "pages") setWorkspaceTool(tool);
                }}
                onAddFiles={requestAddFiles}
                onDownload={() => handleDownload("workspace")}
                downloadBusy={isBusy()}
                downloadAvailable={activePageCount() > 0}
                exportPageCount={activePageCount()}
                onClose={closeCanvas}
              />
            </Show>
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
