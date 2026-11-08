import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { Deferred, Effect } from "effect";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { PDFPasswordRequiredError, PDFProcessingError } from "@/types/interfaces";

const pdfServiceMocks = vi.hoisted(() => ({
  loadPDF: vi.fn(),
  loadPDFWithPassword: vi.fn(),
  getPageCount: vi.fn(),
  getPassword: vi.fn(),
  getPageRotation: vi.fn(),
  getPageSize: vi.fn(),
  getPageGeometry: vi.fn(),
  renderPage: vi.fn(),
  releaseFile: vi.fn(),
  reset: vi.fn(),
  dispose: vi.fn(),
}));

const pdfOperationsMocks = vi.hoisted(() => ({
  buildPDF: vi.fn(),
  imagesToPDF: vi.fn(),
  clearCache: vi.fn(),
  releaseFile: vi.fn(),
  dispose: vi.fn(),
}));

const pdfCompressionMocks = vi.hoisted(() => ({
  compressPDF: vi.fn(),
}));

const pdfImageExportMocks = vi.hoisted(() => ({
  exportImages: vi.fn(),
}));

const promptForPassword = vi.hoisted(() => vi.fn());
const downloadPDF = vi.hoisted(() => vi.fn());
const downloadFile = vi.hoisted(() => vi.fn());

vi.mock("@/services/pdf-service", () => ({
  PDFService: class {
    loadPDF = pdfServiceMocks.loadPDF;
    loadPDFWithPassword = pdfServiceMocks.loadPDFWithPassword;
    getPageCount = pdfServiceMocks.getPageCount;
    getPassword = pdfServiceMocks.getPassword;
    getPageRotation = pdfServiceMocks.getPageRotation;
    getPageSize = pdfServiceMocks.getPageSize;
    getPageGeometry = pdfServiceMocks.getPageGeometry;
    renderPage = pdfServiceMocks.renderPage;
    releaseFile = pdfServiceMocks.releaseFile;
    reset = pdfServiceMocks.reset;
    dispose = pdfServiceMocks.dispose;
  },
}));
vi.mock("@/services/pdf-operations-service", () => ({
  PDFOperationsService: class {
    buildPDF = pdfOperationsMocks.buildPDF;
    imagesToPDF = pdfOperationsMocks.imagesToPDF;
    clearCache = pdfOperationsMocks.clearCache;
    releaseFile = pdfOperationsMocks.releaseFile;
    dispose = pdfOperationsMocks.dispose;
  },
}));
vi.mock("@/services/pdf-compression-service", () => ({
  PDFCompressionService: class {
    compressPDF = pdfCompressionMocks.compressPDF;
  },
}));
vi.mock("@/services/pdf-image-export-service", () => ({
  PDFImageExportService: class {
    exportImages = pdfImageExportMocks.exportImages;
  },
}));
vi.mock("@/utils/password-prompt", () => ({ promptForPassword }));
vi.mock("@/utils/download", () => ({ downloadFile, downloadPDF }));

import Editor from "../Editor";

const makeFile = (name = "doc.pdf") => new File(["%PDF-1.4"], name, { type: "application/pdf" });
const makeImageFile = (name = "image.png", type = "image/png") =>
  new File(["image"], name, { type });

function selectFiles(input: "upload" | "add", files: File[]) {
  const label =
    input === "upload" ? "Choose PDF or image files" : "Choose additional PDF or image files";
  fireEvent.change(screen.getByLabelText(label), { target: { files } });
}

function selectFile(input: "upload" | "add", file: File) {
  selectFiles(input, [file]);
}

const pageButtonName = /^Page \d+(, marked for deletion)?$/;
const getPages = () => screen.getAllByRole("button", { name: pageButtonName });
const findPages = () => screen.findAllByRole("button", { name: pageButtonName });

// Toasts accumulate until their 3s dismissal timer fires, so assert on the newest one.
function expectLastToast(text: string) {
  expect(screen.getAllByTestId("editor-toast").at(-1)).toHaveTextContent(text);
}

async function openDownloadMenu() {
  fireEvent.click(screen.getByTestId("editor-download-menu-button"));
  expect(await screen.findByRole("menu", { name: "Download options" })).toBeVisible();
}

// Download always builds every exportable page.
async function downloadWholePDF() {
  await openDownloadMenu();
  fireEvent.click(screen.getByTestId("editor-download-button"));
}

// Extract to PDF builds the selection. Without one, Download builds every page.
async function exportCurrent() {
  const extract = screen.queryByTestId("editor-extract-button");
  if (extract) fireEvent.click(extract);
  else await downloadWholePDF();
}

async function openPDF(file = makeFile()) {
  render(() => <Editor />);
  selectFile("upload", file);
  return findPages();
}

describe("Editor", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    promptForPassword.mockResolvedValue(null);
    pdfServiceMocks.getPageCount.mockReturnValue(3);
    pdfServiceMocks.getPageRotation.mockReturnValue(Effect.succeed(0));
    pdfServiceMocks.getPageSize.mockReturnValue(Effect.succeed({ width: 100, height: 200 }));
    pdfServiceMocks.getPageGeometry.mockReturnValue(
      Effect.succeed({
        bounds: [0, 0, 100, 200],
        userUnit: 1,
        width: 100,
        height: 200,
        transform: [1, 0, 0, -1, 0, 200],
      })
    );
    pdfServiceMocks.loadPDF.mockReturnValue(Effect.succeed(undefined));
    pdfServiceMocks.loadPDFWithPassword.mockReturnValue(Effect.succeed(undefined));
    pdfServiceMocks.renderPage.mockReturnValue(Effect.succeed(undefined));
    pdfServiceMocks.releaseFile.mockReturnValue(Effect.succeed(undefined));
    pdfServiceMocks.reset.mockReturnValue(Effect.succeed(undefined));
    pdfServiceMocks.dispose.mockReturnValue(Effect.void);
    pdfOperationsMocks.releaseFile.mockReturnValue(Effect.void);
    pdfOperationsMocks.dispose.mockReturnValue(Effect.void);
    pdfOperationsMocks.buildPDF.mockReturnValue(
      Effect.succeed({
        data: new Uint8Array([1, 2, 3]),
        suggestedFileName: "interleaf-output.pdf",
      })
    );
    pdfOperationsMocks.imagesToPDF.mockReturnValue(
      Effect.succeed({
        data: new Uint8Array([8, 9]),
        suggestedFileName: "interleaf-images.pdf",
      })
    );
    pdfOperationsMocks.clearCache.mockReturnValue(Effect.succeed(undefined));
    pdfCompressionMocks.compressPDF.mockReturnValue(
      Effect.succeed({
        data: new Uint8Array([4, 5]),
        inputBytes: 10,
        candidateBytes: 2,
        outputBytes: 2,
        suggestedFileName: "interleaf-output.pdf",
        reduced: true,
      })
    );
    pdfImageExportMocks.exportImages.mockReturnValue(
      Effect.succeed({
        data: new Blob([new Uint8Array([6, 7])], { type: "application/zip" }),
        suggestedFileName: "interleaf-images.zip",
      })
    );
  });

  const idle = () =>
    waitFor(() => expect(screen.getByTestId("editor-root")).toHaveAttribute("aria-busy", "false"));
  const step = async (direction: "undo" | "redo") => {
    fireEvent.click(screen.getByTestId(`editor-${direction}-button`));
    await idle();
  };
  const exportedState = async () => {
    const calls = pdfOperationsMocks.buildPDF.mock.calls.length;
    await exportCurrent();
    await waitFor(() => expect(pdfOperationsMocks.buildPDF).toHaveBeenCalledTimes(calls + 1));
    await idle();
    const call = pdfOperationsMocks.buildPDF.mock.calls.at(-1);
    if (!call) throw new Error("Missing export call");
    const [pages, options] = call;
    return {
      pages: pages.map((page: Record<string, unknown>) => ({ ...page })),
      selected: options.selectedIndices,
    };
  };

  it("interleaves source and page history with stable same-named Files, generated PDF identity and duplicates", async () => {
    const first = makeFile("same.pdf");
    const second = makeFile("same.pdf");
    await openPDF(first);
    expect(screen.getByTestId("editor-undo-button")).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("button", { name: "Duplicate page 1" }));
    const copied = await exportedState();
    selectFiles("add", [
      second,
      makeImageFile("portrait.jpg", "image/jpeg"),
      makeImageFile("scan.png"),
    ]);
    await waitFor(() => expect(getPages()).toHaveLength(10));
    const added = await exportedState();
    const generated = added.pages[7].sourceFile;
    expect(generated).toBeInstanceOf(File);
    expect(added.pages[4].sourceFile).toBe(second);
    fireEvent.click(screen.getByRole("button", { name: "Rotate page 5 90 degrees" }));
    const rotated = await exportedState();
    fireEvent.click(screen.getByTestId("editor-files-button"));
    fireEvent.click(screen.getAllByTestId("editor-file-remove")[0]);
    await idle();
    fireEvent.click(screen.getByTestId("editor-files-close-button"));
    expect(getPages()).toHaveLength(6);
    await step("undo");
    const restored = await exportedState();
    expect(restored).toEqual(rotated);
    restored.pages.forEach((page: Record<string, unknown>, index: number) => {
      expect(page.sourceFile).toBe(rotated.pages[index].sourceFile);
    });
    await step("undo");
    expect(await exportedState()).toEqual(added);
    await step("undo");
    expect(await exportedState()).toEqual(copied);
    expect(pdfServiceMocks.releaseFile).toHaveBeenCalledWith(second);
    expect(pdfServiceMocks.releaseFile).toHaveBeenCalledWith(generated);
    await step("redo");
    expect(await exportedState()).toEqual(added);
    expect(pdfServiceMocks.loadPDF.mock.calls.at(-1)?.[0]).toBe(generated);
    expect(pdfOperationsMocks.imagesToPDF).toHaveBeenCalledTimes(1);
    await step("undo");
    fireEvent.click(screen.getByRole("button", { name: "Mark page 1 for deletion" }));
    expect(screen.getByTestId("editor-redo-button")).toHaveAttribute("aria-disabled", "true");
    await step("undo");
    await step("undo");
    expect(getPages()).toHaveLength(3);
    expect(screen.getByTestId("editor-undo-button")).toHaveAttribute("aria-disabled", "true");
  });

  it("rolls back a second missing-source failure and holds busy through cleanup without moving either stack", async () => {
    const existing = makeFile("baseline.pdf");
    const firstMissing = makeFile("one.pdf");
    const secondMissing = makeFile("two.pdf");
    await openPDF(existing);
    fireEvent.click(screen.getByRole("button", { name: "Rotate page 1 90 degrees" }));
    const prior = await exportedState();
    selectFiles("add", [firstMissing, secondMissing]);
    await waitFor(() => expect(getPages()).toHaveLength(9));
    await step("undo");
    pdfServiceMocks.releaseFile.mockClear();
    const cleanup = Deferred.makeUnsafe<void>();
    pdfServiceMocks.releaseFile.mockReturnValueOnce(Deferred.await(cleanup));
    pdfServiceMocks.loadPDF
      .mockReturnValueOnce(Effect.void)
      .mockReturnValueOnce(Effect.fail(new Error("second source details")));
    const undoLabel = screen.getByTestId("editor-undo-button").getAttribute("aria-label");
    const redoLabel = screen.getByTestId("editor-redo-button").getAttribute("aria-label");
    const accepted = new KeyboardEvent("keydown", {
      key: "y",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    screen.getByTestId("editor-redo-button").dispatchEvent(accepted);
    expect(accepted.defaultPrevented).toBe(true);
    await waitFor(() => expectLastToast("Failed to load two.pdf: second source details"));
    expect(getPages()).toHaveLength(3);
    expect(screen.getByTestId("editor-root")).toHaveAttribute("aria-busy", "true");
    const repeated = new KeyboardEvent("keydown", {
      key: "y",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(repeated);
    expect(repeated.defaultPrevented).toBe(false);
    fireEvent.click(screen.getByTestId("editor-undo-button"));
    selectFiles("add", [makeFile("ignored.pdf")]);
    expect(pdfServiceMocks.loadPDF).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: "ignored.pdf" })
    );
    expect(pdfServiceMocks.releaseFile.mock.calls.some(([file]) => file === existing)).toBe(false);
    await Effect.runPromise(Deferred.succeed(cleanup, undefined));
    await idle();
    expect(pdfServiceMocks.releaseFile.mock.calls.map(([file]) => file)).toEqual([
      firstMissing,
      secondMissing,
    ]);
    expect(screen.getByTestId("editor-undo-button")).toHaveAttribute("aria-label", undoLabel);
    expect(screen.getByTestId("editor-redo-button")).toHaveAttribute("aria-label", redoLabel);
    expect(await exportedState()).toEqual(prior);
    await step("redo");
    expect(getPages()).toHaveLength(9);
    await step("undo");
    expect(await exportedState()).toEqual(prior);
  });

  it("keeps last-source history and selection, re-prompts after release, and leaves canceled password retries unchanged", async () => {
    const protectedFile = makeFile("protected.pdf");
    await openPDF(protectedFile);
    fireEvent.click(getPages()[1]);
    fireEvent.click(screen.getByTestId("editor-document-view-button"));
    fireEvent.click(screen.getByTestId("editor-files-button"));
    await waitFor(() => expect(screen.getByTestId("editor-files-close-button")).toHaveFocus());
    fireEvent.click(screen.getByTestId("editor-file-remove"));
    await idle();
    await waitFor(() => expect(screen.getByTestId("editor-undo-button")).toHaveFocus());
    expect(screen.getByTestId("editor-root")).toHaveAttribute("data-phase", "edit");
    expect(screen.getByTestId("editor-files-dialog")).not.toHaveAttribute("open");
    const documentButton = screen.getByTestId("editor-document-view-button");
    documentButton.focus();
    fireEvent.click(documentButton);
    expect(documentButton).toHaveFocus();
    expect(documentButton).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("editor-upload-input")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("editor-upload-dropzone"));
    const pickerUndo = new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    documentButton.dispatchEvent(pickerUndo);
    expect(pickerUndo.defaultPrevented).toBe(false);
    fireEvent(screen.getByTestId("editor-upload-input"), new Event("cancel", { bubbles: true }));
    pdfServiceMocks.loadPDF.mockReturnValueOnce(
      Effect.fail(new PDFPasswordRequiredError(protectedFile))
    );
    await step("undo");
    expect(screen.getByTestId("editor-upload-input")).toBeInTheDocument();
    expect(screen.getByTestId("editor-undo-button")).toHaveAttribute(
      "aria-label",
      "Undo source removal"
    );
    expect(screen.getByTestId("editor-redo-button")).toHaveAttribute("aria-disabled", "true");
    pdfServiceMocks.loadPDF.mockReturnValueOnce(
      Effect.fail(new PDFPasswordRequiredError(protectedFile))
    );
    promptForPassword.mockResolvedValueOnce("wrong").mockResolvedValueOnce(null);
    pdfServiceMocks.loadPDFWithPassword.mockReturnValueOnce(
      Effect.fail(new PDFPasswordRequiredError(protectedFile, "wrong-password"))
    );
    await step("undo");
    expect(promptForPassword).toHaveBeenLastCalledWith(
      "protected.pdf",
      true,
      expect.any(AbortSignal)
    );
    pdfServiceMocks.loadPDF.mockReturnValueOnce(
      Effect.fail(new PDFPasswordRequiredError(protectedFile))
    );
    promptForPassword.mockResolvedValueOnce("correct");
    await step("undo");
    expect(getPages().map((tile) => tile.getAttribute("aria-pressed"))).toEqual([
      "false",
      "true",
      "false",
    ]);
    fireEvent.click(documentButton);
    expect(screen.getByTestId("editor-viewer-title")).toHaveTextContent("Page 2");
    await step("redo");
    expect(screen.getByTestId("editor-pages-view-button")).toHaveAttribute("aria-pressed", "true");
    selectFiles("upload", [makeFile("new.pdf")]);
    await findPages();
    await step("undo");
    expect(screen.getByTestId("editor-upload-input")).toBeInTheDocument();
    await step("undo");
    expect(getPages()).toHaveLength(3);
    expect(pdfServiceMocks.loadPDF.mock.calls.at(-1)?.[0]).toBe(protectedFile);
  });

  it("commits before releasing obsolete caches and reports cleanup failure without claiming rollback", async () => {
    await openPDF();
    const added = makeFile("added.pdf");
    selectFiles("add", [added]);
    await waitFor(() => expect(getPages()).toHaveLength(6));
    const cleanup = Deferred.makeUnsafe<void>();
    pdfServiceMocks.releaseFile.mockImplementationOnce((file: File) =>
      Effect.suspend(() => {
        expect(file).toBe(added);
        expect(getPages()).toHaveLength(3);
        expect(screen.getByTestId("editor-redo-button")).toHaveAttribute(
          "aria-label",
          "Redo source addition"
        );
        return Deferred.await(cleanup);
      })
    );
    fireEvent.click(screen.getByTestId("editor-undo-button"));
    await waitFor(() => expect(pdfServiceMocks.releaseFile).toHaveBeenCalledWith(added));
    expect(screen.getByTestId("editor-root")).toHaveAttribute("aria-busy", "true");
    await Effect.runPromise(Deferred.succeed(cleanup, undefined));
    await idle();
    await step("redo");
    pdfServiceMocks.releaseFile.mockReturnValueOnce(
      Effect.fail(
        new PDFProcessingError({
          operation: "release-file",
          file: added,
          cause: new Error("cleanup detail"),
          message: "cleanup detail",
        })
      )
    );
    await step("undo");
    expectLastToast("Workspace restored, but could not release added.pdf: cleanup detail");
    expect(getPages()).toHaveLength(3);
    expect(screen.getByTestId("editor-redo-button")).toHaveAttribute("aria-disabled", "false");
    await step("redo");
    expect(getPages()).toHaveLength(6);
  });

  it("leaves focus on a surviving dialog control while removal cleanup completes", async () => {
    await openPDF();
    selectFiles("add", [makeFile("second.pdf")]);
    await waitFor(() => expect(getPages()).toHaveLength(6));
    const cleanup = Deferred.makeUnsafe<void>();
    pdfServiceMocks.releaseFile.mockReturnValueOnce(Deferred.await(cleanup));
    fireEvent.click(screen.getByTestId("editor-files-button"));
    const remove = screen.getAllByTestId("editor-file-remove")[0];
    remove.focus();
    fireEvent.click(remove);
    await waitFor(() => expect(pdfServiceMocks.releaseFile).toHaveBeenCalled());
    const close = screen.getByTestId("editor-files-close-button");
    close.focus();
    await Effect.runPromise(Deferred.succeed(cleanup, undefined));
    await idle();
    await new Promise(requestAnimationFrame);
    expect(close).toHaveFocus();
  });

  it("waits for an interrupted native load and rollback cleanup before disposing", async () => {
    const view = render(() => <Editor />);
    selectFiles("upload", [makeFile("baseline.pdf")]);
    await findPages();
    const added = makeFile("pending.pdf");
    selectFiles("add", [added]);
    await waitFor(() => expect(getPages()).toHaveLength(6));
    await step("undo");
    pdfServiceMocks.releaseFile.mockClear();
    const native = Deferred.makeUnsafe<void>();
    const cleanup = Deferred.makeUnsafe<void>();
    const started = vi.fn();
    pdfServiceMocks.loadPDF.mockReturnValueOnce(
      Effect.sync(started).pipe(Effect.andThen(Effect.uninterruptible(Deferred.await(native))))
    );
    pdfServiceMocks.releaseFile.mockReturnValueOnce(Deferred.await(cleanup));
    fireEvent.click(screen.getByTestId("editor-redo-button"));
    await waitFor(() => expect(started).toHaveBeenCalledOnce());
    view.unmount();
    expect(pdfServiceMocks.reset).not.toHaveBeenCalled();
    expect(pdfServiceMocks.releaseFile).not.toHaveBeenCalled();
    await Effect.runPromise(Deferred.succeed(native, undefined));
    await waitFor(() => expect(pdfServiceMocks.releaseFile).toHaveBeenCalledWith(added));
    expect(pdfServiceMocks.reset).not.toHaveBeenCalled();
    await Effect.runPromise(Deferred.succeed(cleanup, undefined));
    await waitFor(() => expect(pdfServiceMocks.reset).toHaveBeenCalledOnce());
  });

  it("undoes and redoes mixed organization with exact logical identity, selection, and File references", async () => {
    const file = makeFile();
    await openPDF(file);
    const state = async () => {
      const count = downloadPDF.mock.calls.length;
      await exportCurrent();
      await waitFor(() => expect(downloadPDF).toHaveBeenCalledTimes(count + 1));
      const call = pdfOperationsMocks.buildPDF.mock.calls.at(-1);
      if (!call) throw new Error("Missing export");
      const [pages, options] = call;
      return {
        pages: pages.map((page: import("@/types/interfaces").PageState) => ({ ...page })),
        selected: options.selectedIndices,
      };
    };
    const original = await state();
    fireEvent.click(getPages()[1]);
    fireEvent.click(screen.getByRole("button", { name: "Rotate page 2 90 degrees" }));
    fireEvent.click(getPages()[0]);
    fireEvent.click(screen.getByTestId("editor-rotate-button"));
    fireEvent.click(screen.getByTestId("editor-delete-button"));
    fireEvent.click(screen.getByTestId("editor-delete-button"));
    fireEvent.click(screen.getByRole("button", { name: "Duplicate page 2" }));
    await waitFor(() => expect(getPages()[2]).toHaveFocus());
    fireEvent.keyDown(getPages()[2], { key: "ArrowRight", altKey: true });
    const changed = await state();
    expect(changed.pages.map((page: { rotation: number }) => page.rotation)).toEqual([
      90, 180, 0, 180,
    ]);
    expect(changed.selected).toEqual([0, 1]);
    expect(changed.pages[3].id).not.toBe(original.pages[1].id);
    fireEvent.click(screen.getByTestId("editor-document-view-button"));
    for (let step = 0; step < 6; step++) fireEvent.click(screen.getByTestId("editor-undo-button"));
    expect(screen.getByTestId("editor-viewer-title")).toHaveTextContent("Page 2");
    expect(screen.getByTestId("editor-selection-title")).toHaveTextContent("1 selected");
    expect(screen.queryByTestId("editor-page-grid")).not.toBeInTheDocument();
    const restored = await state();
    expect(restored.pages).toEqual(original.pages);
    expect(restored.pages.every((page: { sourceFile: File }) => page.sourceFile === file)).toBe(
      true
    );
    expect(restored.selected).toEqual([1]);
    expect(screen.getByTestId("editor-undo-button")).toHaveAttribute("aria-disabled", "true");
    for (let step = 0; step < 6; step++) fireEvent.click(screen.getByTestId("editor-redo-button"));
    expect(await state()).toEqual(changed);
    expect(screen.getByTestId("editor-viewer-title")).toHaveTextContent("Page 1");
    expect(pdfServiceMocks.loadPDF).toHaveBeenCalledExactlyOnceWith(file);
  });

  it("handles history from the workspace background without taking focus from it", async () => {
    await openPDF();
    fireEvent.click(screen.getByRole("button", { name: "Rotate page 1 90 degrees" }));
    (document.activeElement as HTMLElement).blur();
    const undo = new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(undo);
    expect(undo.defaultPrevented).toBe(true);
    expect(screen.getByTestId("editor-undo-button")).toHaveAttribute("aria-disabled", "true");
    expect(document.body).toHaveFocus();
    fireEvent.keyDown(document.body, { key: "y", ctrlKey: true });
    expect(screen.getByTestId("editor-undo-button")).toHaveAttribute("aria-disabled", "false");
  });

  it("retains focus when undo removes a copy and when the history button becomes unavailable", async () => {
    await openPDF();
    getPages()[0].focus();
    fireEvent.click(screen.getByRole("button", { name: "Duplicate page 1" }));
    await waitFor(() => expect(getPages()[1]).toHaveFocus());
    const undoEvent = new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    getPages()[1].dispatchEvent(undoEvent);
    expect(undoEvent.defaultPrevented).toBe(true);
    await waitFor(() => expect(getPages()[0]).toHaveFocus());
    expect(getPages()).toHaveLength(3);
    fireEvent.keyDown(getPages()[0], { key: "Z", metaKey: true, shiftKey: true });
    expect(getPages()).toHaveLength(4);
    const undo = screen.getByTestId("editor-undo-button");
    undo.focus();
    fireEvent.click(undo);
    expect(undo).toHaveFocus();
    expect(undo).toHaveAttribute("aria-disabled", "true");
    const noUndo = new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    undo.dispatchEvent(noUndo);
    expect(noUndo.defaultPrevented).toBe(false);
    fireEvent.keyDown(undo, { key: "y", ctrlKey: true });
    expect(getPages()).toHaveLength(4);
    expect(undo).toHaveFocus();
  });

  it("does not claim shortcuts owned by text controls, composition, menus, dialogs, a file picker or drag", async () => {
    await openPDF();
    fireEvent.click(screen.getByRole("button", { name: "Rotate page 1 90 degrees" }));
    const root = screen.getByTestId("editor-root");
    const ignored = (target: HTMLElement, extra = {}) => {
      const event = new KeyboardEvent("keydown", {
        key: "z",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
        ...extra,
      });
      target.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(screen.getByTestId("editor-undo-button")).toHaveAttribute(
        "aria-label",
        "Undo page rotation"
      );
    };
    for (const tag of ["input", "textarea", "select", "div"]) {
      const input = document.createElement(tag);
      if (tag === "div") input.setAttribute("contenteditable", "true");
      root.append(input);
      ignored(input);
      input.remove();
    }
    ignored(getPages()[0], { isComposing: true });
    ignored(getPages()[0], { altKey: true });
    await openDownloadMenu();
    ignored(screen.getByTestId("editor-download-button"));
    fireEvent.keyDown(screen.getByTestId("editor-download-button"), { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    const otherDialog = document.createElement("div");
    otherDialog.setAttribute("role", "dialog");
    otherDialog.setAttribute("aria-modal", "true");
    const dialogButton = document.createElement("button");
    otherDialog.append(dialogButton);
    root.append(otherDialog);
    ignored(dialogButton);
    ignored(getPages()[0]);
    otherDialog.remove();
    const row = getPages()[0].closest("li");
    if (!row) throw new Error("Missing page row");
    fireEvent.dragStart(row);
    const dragEvent = new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    getPages()[0].dispatchEvent(dragEvent);
    expect(dragEvent.defaultPrevented).toBe(false);
    fireEvent.dragEnd(row);
    fireEvent.click(screen.getByTestId("editor-add-pdf-button"));
    const pickerEvent = new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    getPages()[0].dispatchEvent(pickerEvent);
    expect(pickerEvent.defaultPrevented).toBe(false);
    fireEvent(screen.getByTestId("editor-add-pdf-input"), new Event("cancel", { bubbles: true }));
    expect(screen.getByTestId("editor-undo-button")).toHaveAttribute("aria-disabled", "false");
    fireEvent.click(screen.getByTestId("editor-undo-button"));
    expect(screen.getByTestId("editor-undo-button")).toHaveAttribute("aria-disabled", "true");
  });

  it("preserves history through failed and canceled imports and exports, records committed source changes", async () => {
    const first = makeFile("first.pdf");
    await openPDF(first);
    fireEvent.click(screen.getByRole("button", { name: "Rotate page 1 90 degrees" }));
    fireEvent.click(screen.getByTestId("editor-undo-button"));
    const second = makeFile("second.pdf");
    pdfServiceMocks.loadPDF.mockReturnValueOnce(Effect.fail(new PDFPasswordRequiredError(second)));
    selectFiles("add", [second]);
    await waitFor(() => expect(promptForPassword).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.getByTestId("editor-root")).toHaveAttribute("aria-busy", "false")
    );
    expect(screen.getByTestId("editor-redo-button")).toHaveAttribute("aria-disabled", "false");
    pdfOperationsMocks.imagesToPDF.mockReturnValueOnce(Effect.fail(new Error("conversion failed")));
    selectFiles("add", [makeImageFile()]);
    await waitFor(() =>
      expect(screen.getByTestId("editor-root")).toHaveAttribute("aria-busy", "false")
    );
    expect(screen.getByTestId("editor-redo-button")).toHaveAttribute("aria-disabled", "false");
    pdfOperationsMocks.buildPDF.mockReturnValueOnce(Effect.fail(new Error("export failed")));
    await downloadWholePDF();
    await waitFor(() => expectLastToast("Failed to export the PDF."));
    expect(screen.getByTestId("editor-redo-button")).toHaveAttribute("aria-disabled", "false");
    pdfServiceMocks.loadPDF
      .mockReturnValueOnce(Effect.fail(new Error("invalid PDF")))
      .mockReturnValueOnce(Effect.fail(new Error("invalid PDF")));
    selectFiles("add", [makeFile("broken-one.pdf"), makeFile("broken-two.pdf")]);
    await waitFor(() => expectLastToast("Could not open 2 files."));
    await waitFor(() =>
      expect(screen.getByTestId("editor-root")).toHaveAttribute("aria-busy", "false")
    );
    expect(screen.getByTestId("editor-redo-button")).toHaveAttribute("aria-disabled", "false");
    expect(getPages()).toHaveLength(3);
    selectFiles("add", [second]);
    await waitFor(() => expect(getPages()).toHaveLength(6));
    expect(screen.getByTestId("editor-redo-button")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("editor-undo-button")).toHaveAttribute(
      "aria-label",
      "Undo source addition"
    );
    fireEvent.click(screen.getByRole("button", { name: "Duplicate page 1" }));
    fireEvent.click(screen.getByTestId("editor-files-button"));
    fireEvent.click(screen.getAllByTestId("editor-file-remove")[0]);
    await waitFor(() => expect(pdfServiceMocks.releaseFile).toHaveBeenCalledWith(first));
    await waitFor(() =>
      expect(screen.getByTestId("editor-root")).toHaveAttribute("aria-busy", "false")
    );
    expect(screen.getByTestId("editor-undo-button")).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByTestId("editor-undo-button")).toHaveAttribute(
      "aria-label",
      "Undo source removal"
    );
    expect(screen.getByTestId("editor-redo-button")).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getAllByTestId("editor-file-remove")[0]);
    await waitFor(() => expect(screen.getByTestId("editor-upload-input")).toBeInTheDocument());
    expect(pdfServiceMocks.releaseFile).toHaveBeenCalledWith(second);
    await waitFor(() =>
      expect(screen.getByTestId("editor-root")).toHaveAttribute("aria-busy", "false")
    );
    selectFiles("upload", [makeFile("fresh.pdf")]);
    await findPages();
    expect(screen.getByTestId("editor-undo-button")).toHaveAttribute(
      "aria-label",
      "Undo source addition"
    );
  });

  it("keeps redo across boundary moves and canceled drags, clears it on new changes, and restores compression", async () => {
    await openPDF();
    fireEvent.click(screen.getByRole("button", { name: "Rotate page 1 90 degrees" }));
    fireEvent.click(screen.getByTestId("editor-undo-button"));
    fireEvent.keyDown(getPages()[0], { altKey: true, key: "ArrowLeft" });
    const row = getPages()[0].closest("li");
    if (!row) throw new Error("Missing page row");
    fireEvent.dragStart(row);
    fireEvent.dragEnd(row);
    expect(screen.getByTestId("editor-redo-button")).toHaveAttribute("aria-disabled", "false");
    await openDownloadMenu();
    expect(screen.getByTestId("editor-compress-button")).toHaveAttribute("aria-disabled", "false");
    fireEvent.keyDown(screen.getByTestId("editor-compress-button"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Mark page 1 for deletion" }));
    expect(screen.getByTestId("editor-redo-button")).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByTestId("editor-undo-button"));
    expect(getPages()[0]).toHaveAttribute("data-marked-for-deletion", "false");
    await openDownloadMenu();
    expect(screen.getByTestId("editor-compress-button")).toHaveAttribute("aria-disabled", "false");
  });

  it("ignores history shortcuts during an active operation and resumes after it completes", async () => {
    await openPDF();
    fireEvent.click(screen.getByRole("button", { name: "Rotate page 1 90 degrees" }));
    const pending = Deferred.makeUnsafe<void>();
    pdfServiceMocks.loadPDF.mockReturnValueOnce(Deferred.await(pending));
    selectFiles("add", [makeFile("busy.pdf")]);
    await waitFor(() =>
      expect(screen.getByTestId("editor-root")).toHaveAttribute("aria-busy", "true")
    );
    const event = new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    screen.getByTestId("editor-undo-button").dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(screen.getByTestId("editor-undo-button")).toHaveAttribute("aria-disabled", "true");
    await Effect.runPromise(Deferred.succeed(pending, undefined));
    await waitFor(() => expect(getPages()).toHaveLength(6));
    expect(screen.getByTestId("editor-undo-button")).toHaveAttribute("aria-disabled", "false");
  });

  it("keeps Document keyboard history usable when a focused copy or navigation action disappears", async () => {
    await openPDF();
    fireEvent.click(screen.getByRole("button", { name: "Duplicate page 3" }));
    fireEvent.click(screen.getByTestId("editor-document-view-button"));
    await waitFor(() => expect(screen.getByTestId("editor-document-view-button")).toHaveFocus());
    const copy = screen.getByRole("button", { name: "View page 4" });
    copy.focus();
    fireEvent.keyDown(copy, { key: "z", ctrlKey: true });
    await waitFor(() => expect(screen.getByRole("button", { name: "View page 1" })).toHaveFocus());
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Z",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(screen.getByTestId("editor-viewer-title")).toHaveTextContent("Page 4");
    expect(screen.getByRole("button", { name: "View page 4" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    fireEvent.click(screen.getByTestId("editor-undo-button"));
    const next = screen.getByTestId("editor-page-viewer-next");
    next.focus();
    fireEvent.keyDown(next, { key: "y", ctrlKey: true });
    await waitFor(() => expect(screen.getByRole("button", { name: "View page 4" })).toHaveFocus());
    expect(next).toBeDisabled();
  });

  it("keeps history unavailable while a Document draft is open and never discards it", async () => {
    const spies = [
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
        drawImage: vi.fn(),
      } as unknown as RenderingContext),
      vi
        .spyOn(HTMLElement.prototype, "getClientRects")
        .mockReturnValue([new DOMRect(0, 0, 100, 200)] as unknown as DOMRectList),
      vi
        .spyOn(HTMLElement.prototype, "getBoundingClientRect")
        .mockReturnValue(new DOMRect(0, 0, 100, 200)),
    ];
    onTestFinished(() => {
      for (const spy of spies) spy.mockRestore();
    });
    await openPDF();
    fireEvent.click(screen.getByRole("button", { name: "Rotate page 1 90 degrees" }));
    fireEvent.click(screen.getByTestId("editor-document-view-button"));
    const undo = screen.getByTestId("editor-undo-button");
    expect(undo).toHaveAttribute("aria-disabled", "false");
    const undoName = undo.getAttribute("aria-label");
    const addText = await screen.findByRole("button", { name: "Add text" });
    await waitFor(() => expect(addText).toBeEnabled());
    fireEvent.click(addText);
    const stage = screen.getByRole("region", { name: "Page preview, use arrow keys to pan" });
    await waitFor(() =>
      expect(document.querySelector(".editor-text-layer")).toHaveAttribute(
        "data-geometry-ready",
        "true"
      )
    );
    fireEvent.keyDown(stage, { key: "Enter" });
    const input = await screen.findByLabelText("Added text", { exact: true });
    fireEvent.input(input, { target: { value: "Hello" } });
    expect(undo).toHaveAttribute("aria-disabled", "true");
    expect(undo).toHaveAccessibleDescription("Save or cancel the open edit to use undo and redo.");
    for (const target of [stage, document.body]) {
      const shortcut = new KeyboardEvent("keydown", {
        key: "z",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      target.dispatchEvent(shortcut);
      // Claimed so the browser's own undo cannot rewrite the draft input either.
      expect(shortcut.defaultPrevented).toBe(true);
    }
    fireEvent.click(undo);
    expect(screen.getByLabelText("Added text", { exact: true })).toHaveValue("Hello");
    expect(undo).toHaveAttribute("aria-label", undoName);
    expect(screen.getByTestId("editor-redo-button")).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(undo).toHaveAttribute("aria-disabled", "false"));
    expect(undo).toHaveAccessibleDescription(undoName ?? "");
    fireEvent.click(undo);
    await waitFor(() =>
      expect(screen.getByTestId("editor-redo-button")).toHaveAttribute("aria-disabled", "false")
    );
  });

  it("keeps marked pages inspectable after history restores their selection in Document", async () => {
    await openPDF();
    fireEvent.click(getPages()[1]);
    fireEvent.click(screen.getByRole("button", { name: "Mark page 2 for deletion" }));
    fireEvent.click(screen.getByRole("button", { name: "Restore page 2" }));
    fireEvent.click(screen.getByTestId("editor-document-view-button"));
    fireEvent.click(screen.getByTestId("editor-undo-button"));
    expect(screen.getByTestId("editor-viewer-title")).toHaveTextContent("Page 2");
    expect(screen.getByLabelText("Document preview")).toHaveTextContent("Marked for deletion");
    expect(screen.getByTestId("editor-selection-title")).toHaveTextContent(
      "1 selected · 0 exportable"
    );
    expect(screen.getByTestId("editor-extract-button")).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByTestId("editor-redo-button"));
    expect(screen.getByTestId("editor-extract-button")).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByTestId("editor-viewer-title")).toHaveTextContent("Page 2");
  });

  it("does not steal focus from another control or restore queued focus after disposal", async () => {
    const view = render(() => <Editor />);
    selectFiles("upload", [makeFile()]);
    await findPages();
    fireEvent.click(screen.getByRole("button", { name: "Duplicate page 1" }));
    await waitFor(() => expect(getPages()[1]).toHaveFocus());
    fireEvent.keyDown(getPages()[1], { key: "z", ctrlKey: true });
    const download = screen.getByTestId("editor-download-menu-button");
    download.focus();
    await Promise.resolve();
    expect(download).toHaveFocus();
    fireEvent.click(screen.getByTestId("editor-redo-button"));
    getPages()[1].focus();
    fireEvent.keyDown(getPages()[1], { key: "z", ctrlKey: true });
    view.unmount();
    await Promise.resolve();
    expect(document.body).toHaveFocus();
    await waitFor(() => expect(pdfServiceMocks.dispose).toHaveBeenCalledOnce());
  });

  it("undoes and redoes exactly the latest 32 duplications after 33 copies", async () => {
    pdfServiceMocks.getPageCount.mockReturnValue(1);
    await openPDF();
    const pageTiles = () => screen.getAllByTestId("editor-page-tile");
    const undo = screen.getByTestId("editor-undo-button");
    const redo = screen.getByTestId("editor-redo-button");
    expect(pageTiles()).toHaveLength(1);
    expect(undo).toHaveAttribute("aria-disabled", "true");

    for (let copies = 1; copies <= 33; copies++) {
      fireEvent.click(screen.getByRole("button", { name: "Duplicate page 1" }));
      expect(pageTiles()).toHaveLength(copies + 1);
    }

    for (let undone = 1; undone <= 32; undone++) {
      expect(undo).toHaveAttribute("aria-disabled", "false");
      await step("undo");
      expect(pageTiles()).toHaveLength(34 - undone);
    }
    expect(undo).toHaveAttribute("aria-disabled", "true");
    await step("undo");
    expect(pageTiles()).toHaveLength(2);

    for (let redone = 1; redone <= 32; redone++) {
      expect(redo).toHaveAttribute("aria-disabled", "false");
      await step("redo");
      expect(pageTiles()).toHaveLength(2 + redone);
    }
    expect(redo).toHaveAttribute("aria-disabled", "true");
    await step("redo");
    expect(pageTiles()).toHaveLength(34);
  });

  it("evicts old steps and redoes the remaining bounded history without retaining mutable page aliases", async () => {
    const file = makeFile();
    await openPDF(file);
    for (let i = 0; i < 35; i++)
      fireEvent.click(screen.getByRole("button", { name: "Rotate page 1 90 degrees" }));
    for (let i = 0; i < 32; i++) fireEvent.click(screen.getByTestId("editor-undo-button"));
    expect(screen.getByTestId("editor-undo-button")).toHaveAttribute("aria-disabled", "true");
    expect(document.querySelector('[data-testid="editor-page-canvas"]')).toHaveStyle({
      "--page-rotation": "270deg",
    });
    for (let i = 0; i < 32; i++) fireEvent.click(screen.getByTestId("editor-redo-button"));
    expect(screen.getByTestId("editor-redo-button")).toHaveAttribute("aria-disabled", "true");
    expect(document.querySelector('[data-testid="editor-page-canvas"]')).toHaveStyle({
      "--page-rotation": "270deg",
    });
    expect(pdfServiceMocks.loadPDF).toHaveBeenCalledExactlyOnceWith(file);
    expect(pdfOperationsMocks.buildPDF).not.toHaveBeenCalled();
  });

  it("renders the upload dropzone before any file is loaded", () => {
    render(() => <Editor />);

    expect(
      screen.getByRole("button", { name: "Choose PDF or image files, or drop them here" })
    ).toBeInTheDocument();
    expect(screen.queryByTestId("editor-page-grid")).not.toBeInTheDocument();
  });

  it("duplicates rapidly without loading or building sources or changing the selection", async () => {
    const file = makeFile();
    await openPDF(file);
    fireEvent.click(screen.getByRole("button", { name: "Rotate page 2 90 degrees" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark page 2 for deletion" }));
    for (let repeat = 0; repeat < 5; repeat++) {
      fireEvent.click(screen.getByRole("button", { name: "Duplicate page 2" }));
    }
    expect(getPages()).toHaveLength(8);
    expect(getPages().every((page) => page.dataset.selected === "false")).toBe(true);
    await waitFor(() => expect(getPages()[2]).toHaveFocus());
    expect(screen.getByTestId("editor-status-message")).toHaveTextContent(
      "Duplicated page 2 as page 3."
    );
    expect(getPages()[1]).toHaveAttribute("data-marked-for-deletion", "true");
    expect(getPages()[2]).toHaveAttribute("data-marked-for-deletion", "false");
    expect(pdfServiceMocks.loadPDF).toHaveBeenCalledExactlyOnceWith(file);
    expect(pdfOperationsMocks.buildPDF).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Document" }));
    expect(screen.getByTestId("editor-viewer-title")).toHaveTextContent("Page 3");
    expect(screen.queryByTestId("editor-page-grid")).not.toBeInTheDocument();
    await exportCurrent();
    await waitFor(() => expect(downloadPDF).toHaveBeenCalledOnce());
    const [pages, options] = pdfOperationsMocks.buildPDF.mock.calls[0];
    expect(new Set(pages.map((page: { id: string }) => page.id)).size).toBe(8);
    expect(pages.every((page: { sourceFile: File }) => page.sourceFile === file)).toBe(true);
    expect(pages.map((page: { rotation: number }) => page.rotation)).toEqual([
      0, 90, 90, 90, 90, 90, 90, 0,
    ]);
    expect(options.selectedIndices).toBeUndefined();
    await openDownloadMenu();
    fireEvent.click(screen.getByTestId("editor-export-images-button"));
    await waitFor(() => expect(downloadFile).toHaveBeenCalledOnce());
    expect(pdfImageExportMocks.exportImages.mock.calls[0][0][2].id).toBe(pages[2].id);
    expect(pdfImageExportMocks.exportImages.mock.calls[0][1].selectedIndices).toBeUndefined();
  });

  it("keeps copy organization independent and removes all copies with their original source", async () => {
    const first = makeFile("same.pdf");
    const second = makeFile("same.pdf");
    render(() => <Editor />);
    selectFiles("upload", [first, second]);
    await waitFor(() => expect(getPages()).toHaveLength(6));
    fireEvent.click(screen.getByRole("button", { name: "Duplicate page 1" }));
    fireEvent.click(getPages()[1]);
    fireEvent.click(screen.getByRole("button", { name: "Rotate page 2 90 degrees" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark page 2 for deletion" }));
    expect(getPages()[0]).toHaveAttribute("data-marked-for-deletion", "false");
    fireEvent.click(screen.getByRole("button", { name: "Restore page 2" }));
    fireEvent.keyDown(getPages()[1], { altKey: true, key: "ArrowRight" });
    expect(getPages()[2]).toHaveAttribute("aria-pressed", "true");
    await exportCurrent();
    await waitFor(() => expect(downloadPDF).toHaveBeenCalledOnce());
    const [pages, options] = pdfOperationsMocks.buildPDF.mock.calls[0];
    expect(pages.map((page: { sourcePageNumber: number }) => page.sourcePageNumber)).toEqual([
      1, 2, 1, 3, 1, 2, 3,
    ]);
    expect(pages.map((page: { rotation: number }) => page.rotation)).toEqual([
      0, 0, 90, 0, 0, 0, 0,
    ]);
    expect(options.selectedIndices).toEqual([2]);
    fireEvent.click(screen.getByTestId("editor-files-button"));
    const sources = screen.getAllByTestId("editor-file-item");
    expect(sources).toHaveLength(2);
    expect(sources[0]).toHaveTextContent("4 pages");
    fireEvent.click(screen.getAllByTestId("editor-file-remove")[0]);
    await waitFor(() => expect(getPages()).toHaveLength(3));
    expect(pdfServiceMocks.releaseFile).toHaveBeenCalledExactlyOnceWith(first);
    expect(pdfServiceMocks.releaseFile.mock.calls[0][0]).toBe(first);
    expect(pdfServiceMocks.releaseFile.mock.calls[0][0]).not.toBe(second);
  });

  it("disables untouched compression after duplication even when selection is cleared", async () => {
    await openPDF();
    fireEvent.click(screen.getByRole("button", { name: "Duplicate page 3" }));
    fireEvent.click(getPages()[3]);
    await openDownloadMenu();
    expect(screen.getByTestId("editor-compress-button")).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByTestId("editor-compress-button"));
    expect(pdfCompressionMocks.compressPDF).not.toHaveBeenCalled();
  });

  it("explains that compression needs a single PDF when several are open", async () => {
    await openPDF(makeFile("one.pdf"));
    selectFiles("add", [makeFile("two.pdf")]);
    await waitFor(() => expect(getPages()).toHaveLength(6));
    await openDownloadMenu();
    const compress = screen.getByTestId("editor-compress-button");
    expect(compress).toHaveAttribute("aria-disabled", "true");
    expect(compress).toHaveAccessibleName("Compress works on one untouched PDF");
  });

  it("rejects unsupported files with an error toast", async () => {
    render(() => <Editor />);

    selectFile("upload", new File(["text"], "notes.txt", { type: "text/plain" }));

    const toast = await screen.findByTestId("editor-toast");
    expect(toast).toHaveTextContent("Choose PDF, PNG, or JPEG files.");
    expect(pdfServiceMocks.loadPDF).not.toHaveBeenCalled();
    expect(pdfOperationsMocks.imagesToPDF).not.toHaveBeenCalled();
    expect(screen.queryByTestId("editor-page-grid")).not.toBeInTheDocument();
  });

  it("keeps error toasts longer, pauses them on hover and focus, and lets them be dismissed", async () => {
    vi.useFakeTimers();
    try {
      render(() => <Editor />);
      selectFile("upload", new File(["text"], "notes.txt", { type: "text/plain" }));

      const toast = screen.getByTestId("editor-toast");
      expect(toast).toHaveAttribute("role", "alert");

      vi.advanceTimersByTime(3500);
      expect(screen.getByTestId("editor-toast")).toBeInTheDocument();

      fireEvent.pointerEnter(toast);
      vi.advanceTimersByTime(20_000);
      expect(screen.getByTestId("editor-toast")).toBeInTheDocument();

      fireEvent.pointerLeave(toast);
      vi.advanceTimersByTime(7_900);
      expect(screen.getByTestId("editor-toast")).toBeInTheDocument();
      vi.advanceTimersByTime(200);
      expect(screen.queryByTestId("editor-toast")).not.toBeInTheDocument();

      selectFile("upload", new File(["text"], "notes.txt", { type: "text/plain" }));
      const dismiss = screen.getByRole("button", { name: "Dismiss notification" });
      dismiss.focus();
      fireEvent.click(dismiss);
      expect(screen.queryByTestId("editor-toast")).not.toBeInTheDocument();
      await vi.advanceTimersByTimeAsync(0);
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement).not.toBe(dismiss);
    } finally {
      vi.useRealTimers();
    }
  });

  it("announces a file removal inside the modal Files dialog", async () => {
    render(() => <Editor />);
    selectFiles("upload", [makeFile("first.pdf"), makeFile("second.pdf")]);
    await waitFor(() => expect(getPages()).toHaveLength(6));
    fireEvent.click(screen.getByTestId("editor-files-button"));

    fireEvent.click(screen.getAllByTestId("editor-file-remove")[0]);

    await waitFor(() =>
      expect(screen.getByTestId("editor-files-notice")).toHaveTextContent(
        /^Removed first\.pdf and \d+ pages?\. Press Ctrl\/Cmd\+Z to undo\.$/
      )
    );
  });

  it("switches to Document without requiring a selection and retains the active page", async () => {
    await openPDF();

    fireEvent.click(screen.getByRole("button", { name: "Document" }));

    await waitFor(() => expect(screen.getByTestId("editor-page-viewer")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next page" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() =>
      expect(screen.getByTestId("editor-viewer-title")).toHaveTextContent("Page 2")
    );

    fireEvent.click(screen.getByRole("button", { name: "Pages" }));
    await waitFor(() => expect(screen.queryByTestId("editor-page-viewer")).not.toBeInTheDocument());
  });

  it("turns selected images into a PDF and opens it in the workspace", async () => {
    render(() => <Editor />);
    const images = [makeImageFile("one.png"), makeImageFile("two.jpg", "image/jpeg")];

    selectFiles("upload", images);

    await waitFor(() => expect(screen.getByTestId("editor-page-grid")).toBeInTheDocument());
    expect(pdfOperationsMocks.imagesToPDF).toHaveBeenCalledWith(
      images,
      expect.objectContaining({ onProgress: expect.any(Function) })
    );
    expect(pdfServiceMocks.loadPDF).toHaveBeenCalledWith(
      expect.objectContaining({ name: "interleaf-images.pdf", type: "application/pdf" })
    );
    expect(await findPages()).toHaveLength(3);
    expect(screen.getByTestId("editor-status-message")).toHaveTextContent(
      "Created a PDF from 2 images."
    );
  });

  it("returns to the uploader after image conversion fails", async () => {
    pdfOperationsMocks.imagesToPDF.mockReturnValueOnce(
      Effect.fail(
        new PDFProcessingError({
          operation: "images-to-pdf",
          cause: new Error("Unsupported image"),
          message: "Unsupported image",
        })
      )
    );
    render(() => <Editor />);

    selectFile("upload", makeImageFile());

    expect(await screen.findByTestId("editor-toast")).toHaveTextContent("Unsupported image");
    await waitFor(() => expect(screen.getByLabelText("Choose PDF or image files")).toBeEnabled());
  });

  it("keeps interleaved image groups in the uploaded order", async () => {
    render(() => <Editor />);
    const files = [
      makeImageFile("first.png"),
      makeFile("middle.pdf"),
      makeImageFile("last.jpg", "image/jpeg"),
    ];

    selectFiles("upload", files);

    await waitFor(() => expect(getPages()).toHaveLength(9));
    expect(pdfOperationsMocks.imagesToPDF).toHaveBeenCalledTimes(2);
    expect(pdfServiceMocks.loadPDF).toHaveBeenCalledTimes(3);

    fireEvent.click(screen.getByTestId("editor-files-button"));
    await waitFor(() => expect(screen.getByTestId("editor-files-dialog")).toHaveAttribute("open"));
    expect(screen.getByTestId("editor-files-close-button")).toHaveFocus();
    const fileItems = await screen.findAllByTestId("editor-file-item");
    expect(fileItems.map((item) => item.textContent?.replace(/\s+/g, " ").trim())).toEqual([
      expect.stringContaining("interleaf-images-1.pdf"),
      expect.stringContaining("middle.pdf"),
      expect.stringContaining("interleaf-images-2.pdf"),
    ]);
    expect(pdfServiceMocks.loadPDF.mock.calls.map(([file]) => file.name)).toEqual([
      "interleaf-images-1.pdf",
      "middle.pdf",
      "interleaf-images-2.pdf",
    ]);
  });

  it("opens the valid files in a batch and names the invalid one", async () => {
    const failedFile = makeFile("broken.pdf");
    const invalid = new Error("Invalid PDF structure.");
    invalid.name = "InvalidPDFException";
    pdfServiceMocks.loadPDF
      .mockReturnValueOnce(Effect.succeed(undefined))
      .mockReturnValueOnce(Effect.succeed(undefined))
      .mockReturnValueOnce(
        Effect.fail(
          new PDFProcessingError({
            operation: "load-pdf-js",
            file: failedFile,
            cause: invalid,
            message: invalid.message,
          })
        )
      );
    render(() => <Editor />);

    selectFiles("upload", [makeFile("good.pdf"), makeImageFile(), failedFile]);

    expect(await findPages()).toHaveLength(6);
    expectLastToast("Opened 2 of 3 files. broken.pdf isn't a valid PDF.");
    expect(screen.getByTestId("editor-status-message")).toHaveTextContent(
      "Opened 2 of 3 files. broken.pdf isn't a valid PDF."
    );
    expect(pdfServiceMocks.releaseFile).not.toHaveBeenCalled();
  });

  it("opens the unlocked and valid files when another file in the batch is broken", async () => {
    const locked = makeFile("locked.pdf");
    pdfServiceMocks.loadPDF
      .mockReturnValueOnce(Effect.fail(new PDFPasswordRequiredError(locked, "needs-password")))
      .mockReturnValueOnce(Effect.fail(new Error("bad xref")))
      .mockReturnValueOnce(Effect.succeed(undefined));
    promptForPassword.mockResolvedValue("623");
    render(() => <Editor />);

    selectFiles("upload", [locked, makeFile("broken.pdf"), makeFile("good.pdf")]);

    expect(await findPages()).toHaveLength(6);
    expect(pdfServiceMocks.loadPDFWithPassword).toHaveBeenCalledWith(locked, "623");
    expectLastToast("Opened 2 of 3 files. Failed to load broken.pdf: bad xref.");
  });

  it("stays on the uploader with the error when every file in a batch fails", async () => {
    pdfServiceMocks.loadPDF.mockReturnValue(Effect.fail(new Error("bad xref")));
    render(() => <Editor />);

    selectFiles("upload", [makeFile("one.pdf"), makeFile("two.pdf")]);

    await waitFor(() =>
      expectLastToast(
        "Could not open 2 files. Failed to load one.pdf: bad xref. Failed to load two.pdf: bad xref."
      )
    );
    expect(screen.queryByTestId("editor-page-grid")).not.toBeInTheDocument();
    expect(screen.getByTestId("editor-upload-input")).toBeEnabled();
  });

  it("opens the supported files and names an unsupported one", async () => {
    render(() => <Editor />);

    selectFiles("upload", [makeFile("good.pdf"), new File(["text"], "notes.txt")]);

    expect(await findPages()).toHaveLength(3);
    expectLastToast("Opened 1 of 2 files. notes.txt isn't a PDF, PNG, or JPEG file.");
  });

  it("loads multiple selected PDFs into the same workspace", async () => {
    render(() => <Editor />);
    const files = [makeFile("one.pdf"), makeFile("two.pdf")];

    selectFiles("upload", files);

    await waitFor(() => expect(getPages()).toHaveLength(6));
    expect(pdfServiceMocks.loadPDF).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("editor-status-message")).toHaveTextContent(
      "Loaded 2 PDFs into the workspace."
    );
  });

  it("opens the file drawer and selects pages from one source file", async () => {
    await openPDF(makeFile("brief.pdf"));
    expect(screen.getByTestId("editor-files-button")).toBeEnabled();
    expect(screen.getByTestId("editor-files-button")).toHaveAttribute("aria-label", "View 1 file");
    fireEvent.click(screen.getByTestId("editor-files-button"));
    await waitFor(() => expect(screen.getByTestId("editor-files-dialog")).toHaveAttribute("open"));
    expect(await screen.findAllByTestId("editor-file-item")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("editor-files-close-button"));
    await waitFor(() =>
      expect(screen.getByTestId("editor-files-dialog")).not.toHaveAttribute("open")
    );

    selectFile("add", makeFile("appendix.pdf"));
    await waitFor(() => expect(getPages()).toHaveLength(6));

    expect(screen.getByTestId("editor-files-button")).toBeEnabled();
    expect(screen.getByTestId("editor-files-dialog")).not.toHaveAttribute("open");
    fireEvent.click(screen.getByTestId("editor-files-button"));

    await waitFor(() => expect(screen.getByTestId("editor-files-dialog")).toHaveAttribute("open"));
    const fileItems = await screen.findAllByTestId("editor-file-item");
    expect(fileItems).toHaveLength(2);

    fireEvent.click(fileItems[1]);

    await waitFor(() => {
      const tiles = getPages();
      expect(tiles.slice(0, 3).every((tile) => tile.getAttribute("aria-pressed") === "false")).toBe(
        true
      );
      expect(tiles.slice(3).every((tile) => tile.getAttribute("aria-pressed") === "true")).toBe(
        true
      );
    });
    expect(screen.getByTestId("editor-files-dialog")).not.toHaveAttribute("open");
    expect(screen.getByTestId("editor-status-message")).toHaveTextContent(
      "Selected 3 pages from appendix.pdf."
    );
  });

  it.each([
    {
      selectedIndex: 1,
      selection: null,
      pressed: ["false", "false", "false"],
      selectedIndices: undefined,
    },
    {
      selectedIndex: 4,
      selection: "1 selected",
      pressed: ["false", "true", "false"],
      selectedIndices: [1],
    },
  ])(
    "removes a source file and remaps selection from page index $selectedIndex",
    async ({ selectedIndex, selection, pressed, selectedIndices }) => {
      render(() => <Editor />);
      const removed = makeFile("brief.pdf");
      const remaining = makeFile("appendix.pdf");
      selectFiles("upload", [removed, remaining]);
      await waitFor(() => expect(getPages()).toHaveLength(6));
      fireEvent.click(getPages()[selectedIndex]);

      fireEvent.click(screen.getByRole("button", { name: "View 2 files" }));
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Remove brief.pdf and its 3 pages from the workspace",
        })
      );

      await waitFor(() => expect(getPages()).toHaveLength(3));
      if (selection)
        expect(screen.getByTestId("editor-selection-title")).toHaveTextContent(selection);
      else expect(screen.queryByTestId("editor-selection-bar")).not.toBeInTheDocument();
      expect(getPages().map((tile) => tile.getAttribute("aria-pressed"))).toEqual(pressed);
      expect(pdfServiceMocks.releaseFile).toHaveBeenCalledExactlyOnceWith(removed);
      await waitFor(() =>
        expect(screen.getByTestId("editor-root")).toHaveAttribute("aria-busy", "false")
      );

      await exportCurrent();
      await waitFor(() => expect(downloadPDF).toHaveBeenCalledTimes(1));
      const [pages, options] = pdfOperationsMocks.buildPDF.mock.calls[0];
      expect(pages.map((page: { sourceFile: File }) => page.sourceFile)).toEqual([
        remaining,
        remaining,
        remaining,
      ]);
      expect(options.selectedIndices).toEqual(selectedIndices);
      expect(screen.getByRole("button", { name: "View 1 file" })).toBeEnabled();
    }
  );

  it.each(["restore", "other-focus", "view-change", "new-session"])(
    "closing files during source cleanup guards focus: %s",
    async (outcome) => {
      const release = Deferred.makeUnsafe<void>();
      pdfServiceMocks.releaseFile.mockReturnValueOnce(Deferred.await(release));
      const view = render(() => <Editor />);
      selectFiles("upload", [makeFile("first.pdf"), makeFile("second.pdf")]);
      await waitFor(() => expect(getPages()).toHaveLength(6));
      const files = screen.getByTestId("editor-files-button");
      fireEvent.click(files);
      fireEvent.click(screen.getAllByTestId("editor-file-remove")[0]);
      await waitFor(() => expect(pdfServiceMocks.releaseFile).toHaveBeenCalledOnce());
      const close = screen.getByTestId("editor-files-close-button");
      close.focus();
      fireEvent.click(close);
      await Promise.resolve();
      expect(files).toBeDisabled();
      const other = screen.getByTestId("editor-document-view-button");
      const focus = vi.spyOn(files, "focus");
      if (outcome === "other-focus") other.focus();
      if (outcome === "view-change") fireEvent.click(other);
      if (outcome === "new-session") {
        view.unmount();
        render(() => <Editor />);
        selectFile("upload", makeFile("new.pdf"));
        await findPages();
      }
      await Effect.runPromise(Deferred.succeed(release, undefined));
      if (outcome === "new-session") {
        expect(focus).not.toHaveBeenCalled();
      } else {
        await waitFor(() => expect(files).toBeEnabled());
        await waitFor(() => expect(outcome === "restore" ? files : other).toHaveFocus());
      }
    }
  );

  it("returns focus to Files when closed during redo source cleanup", async () => {
    render(() => <Editor />);
    selectFiles("upload", [makeFile("first.pdf"), makeFile("second.pdf")]);
    await waitFor(() => expect(getPages()).toHaveLength(6));
    const files = screen.getByTestId("editor-files-button");
    fireEvent.click(files);
    fireEvent.click(screen.getAllByTestId("editor-file-remove")[0]);
    await waitFor(() => expect(files).toBeEnabled());
    const close = screen.getByTestId("editor-files-close-button");
    close.focus();
    fireEvent.keyDown(close, { key: "z", ctrlKey: true });
    await waitFor(() => expect(getPages()).toHaveLength(6));
    await waitFor(() => expect(files).toBeEnabled());
    const release = Deferred.makeUnsafe<void>();
    pdfServiceMocks.releaseFile.mockReturnValueOnce(Deferred.await(release));
    fireEvent.keyDown(close, { key: "z", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(getPages()).toHaveLength(3));
    expect(files).toBeDisabled();
    fireEvent.click(close);
    await Promise.resolve();
    expect(screen.getByTestId("editor-undo-button")).toHaveFocus();
    await Effect.runPromise(Deferred.succeed(release, undefined));
    await waitFor(() => expect(files).toHaveFocus());
  });

  it("returns to the uploader after the last removal and keeps the files dialog closed on reload", async () => {
    await openPDF(makeFile("only.pdf"));

    fireEvent.click(screen.getByTestId("editor-files-button"));
    await waitFor(() => expect(screen.getByTestId("editor-files-dialog")).toHaveAttribute("open"));
    fireEvent.click(screen.getByTestId("editor-file-remove"));

    await waitFor(() => expect(screen.queryByTestId("editor-page-grid")).not.toBeInTheDocument());
    expect(
      screen.getByRole("button", { name: "Choose PDF or image files, or drop them here" })
    ).toBeInTheDocument();
    expect(screen.getByTestId("editor-upload-status")).toHaveTextContent(
      "Removed only.pdf. The workspace is empty."
    );
    expect(pdfServiceMocks.releaseFile).toHaveBeenCalledWith(
      expect.objectContaining({ name: "only.pdf" })
    );

    await waitFor(() =>
      expect(screen.getByTestId("editor-root")).toHaveAttribute("aria-busy", "false")
    );
    selectFile("upload", makeFile("fresh.pdf"));
    await findPages();
    expect(screen.getByTestId("editor-files-dialog")).not.toHaveAttribute("open");
  });

  it("adds mixed PDFs and images from the workspace", async () => {
    await openPDF(makeFile("brief.pdf"));

    selectFiles("add", [makeFile("appendix.pdf"), makeImageFile("scan.jpg", "image/jpeg")]);

    await waitFor(() => expect(getPages()).toHaveLength(9));
    expect(pdfOperationsMocks.imagesToPDF).toHaveBeenCalledWith(
      [expect.objectContaining({ name: "scan.jpg" })],
      expect.objectContaining({ onProgress: expect.any(Function) })
    );
    expect(pdfServiceMocks.loadPDF).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("editor-status-message")).toHaveTextContent(
      "Added 1 PDF and created a PDF from 1 image."
    );
  });

  it("adds the valid files to a workspace and names the one that failed", async () => {
    const failedFile = makeFile("broken-add.pdf");
    pdfServiceMocks.loadPDF
      .mockReturnValueOnce(Effect.succeed(undefined))
      .mockReturnValueOnce(Effect.succeed(undefined))
      .mockReturnValueOnce(
        Effect.fail(
          new PDFProcessingError({
            operation: "load-pdf-js",
            file: failedFile,
            cause: new Error("Invalid PDF"),
            message: "Invalid PDF",
          })
        )
      );
    await openPDF(makeFile("existing.pdf"));

    selectFiles("add", [makeFile("good-add.pdf"), failedFile]);

    await waitFor(() => expect(getPages()).toHaveLength(6));
    expectLastToast("Added 1 of 2 files. Failed to load broken-add.pdf: Invalid PDF.");
    expect(pdfServiceMocks.releaseFile).not.toHaveBeenCalled();
    expect(screen.getByTestId("editor-undo-button")).toHaveAttribute(
      "aria-label",
      "Undo source addition"
    );
  });

  it("adds the other files when a password prompt in the batch is canceled", async () => {
    const lockedFile = makeFile("protected-add.pdf");
    pdfServiceMocks.loadPDF
      .mockReturnValueOnce(Effect.succeed(undefined))
      .mockReturnValueOnce(Effect.succeed(undefined))
      .mockReturnValueOnce(Effect.fail(new PDFPasswordRequiredError(lockedFile, "needs-password")));
    promptForPassword.mockResolvedValue(null);

    await openPDF(makeFile("existing.pdf"));

    selectFiles("add", [makeFile("good-add.pdf"), lockedFile]);

    await waitFor(() =>
      expect(promptForPassword).toHaveBeenCalledWith(
        "protected-add.pdf",
        false,
        expect.any(AbortSignal)
      )
    );
    await waitFor(() => expect(getPages()).toHaveLength(6));
    expectLastToast("Added 1 of 2 files. protected-add.pdf is still locked.");
  });

  it("interrupts an import and rolls back staged files before disposing the editor", async () => {
    const release = Deferred.makeUnsafe<void>();
    const interrupted = vi.fn();
    pdfServiceMocks.releaseFile.mockReturnValueOnce(Deferred.await(release));
    pdfOperationsMocks.imagesToPDF.mockReturnValue(
      Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(interrupted)))
    );
    const view = render(() => <Editor />);
    const stagedFile = makeFile("staged.pdf");
    selectFiles("upload", [stagedFile, makeImageFile()]);
    await waitFor(() => expect(pdfOperationsMocks.imagesToPDF).toHaveBeenCalled());

    view.unmount();

    await waitFor(() => expect(interrupted).toHaveBeenCalledOnce());
    expect(pdfServiceMocks.releaseFile).toHaveBeenCalledWith(stagedFile);
    expect(pdfServiceMocks.reset).not.toHaveBeenCalled();
    await Effect.runPromise(Deferred.succeed(release, undefined));
    await waitFor(() => expect(pdfServiceMocks.reset).toHaveBeenCalledOnce());
  });

  it("shows selection actions only while pages are selected and keeps compression for the whole file", async () => {
    const tiles = await openPDF();
    expect(screen.queryByRole("toolbar", { name: "Selected pages" })).not.toBeInTheDocument();
    await openDownloadMenu();
    expect(screen.getByRole("menuitem", { name: "Compress the original PDF" })).toHaveAttribute(
      "aria-disabled",
      "false"
    );
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Compress the original PDF" }), {
      key: "Escape",
    });
    fireEvent.click(tiles[0]);
    const bar = screen.getByRole("toolbar", { name: "Selected pages" });
    expect(bar).toHaveTextContent("1 selected");
    expect(screen.getByTestId("editor-selection-status")).toHaveTextContent("1 page selected.");
    for (const name of [
      "Clear page selection",
      "Rotate selected page left 90 degrees",
      "Rotate selected page right 90 degrees",
      "Duplicate selected page",
      "Mark selected pages for deletion",
      "Extract 1 selected page to a new PDF",
      "Export selected pages as PNG images in a ZIP archive",
    ]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-disabled", "false");
    }
    // Download builds the whole document, so a selection does not block compression.
    await openDownloadMenu();
    expect(screen.getByTestId("editor-compress-button")).toHaveAttribute("aria-disabled", "false");
  });

  it("uses one clear control after every page is selected", async () => {
    const tiles = await openPDF();
    fireEvent.click(tiles[0]);
    expect(screen.getByRole("button", { name: "Select all pages" })).toHaveAttribute(
      "aria-disabled",
      "false"
    );

    fireEvent.click(screen.getByTestId("editor-select-all-button"));
    await waitFor(() => {
      expect(screen.getByTestId("editor-select-all-button")).toHaveAccessibleName(
        "All pages selected"
      );
      expect(screen.getByTestId("editor-select-all-button")).toHaveAttribute(
        "aria-disabled",
        "true"
      );
      expect(screen.getByTestId("editor-selection-title")).toHaveTextContent("3 selected");
    });

    fireEvent.click(screen.getByTestId("editor-clear-selection-button"));
    await waitFor(() =>
      expect(screen.queryByTestId("editor-selection-bar")).not.toBeInTheDocument()
    );
    await waitFor(() => expect(getPages()[0]).toHaveFocus());
  });

  it("prompts for a password and unlocks a protected PDF", async () => {
    pdfServiceMocks.loadPDF.mockReturnValue(
      Effect.fail(new PDFPasswordRequiredError(makeFile(), "needs-password"))
    );
    promptForPassword.mockResolvedValue("623");

    render(() => <Editor />);

    selectFile("upload", makeFile("protected.pdf"));

    await waitFor(() =>
      expect(promptForPassword).toHaveBeenCalledWith(
        "protected.pdf",
        false,
        expect.any(AbortSignal)
      )
    );
    const tiles = await findPages();
    expect(tiles).toHaveLength(3);
    expect(pdfServiceMocks.loadPDFWithPassword).toHaveBeenCalledWith(expect.any(File), "623");
  });

  it("stays on the uploader when the password prompt is cancelled", async () => {
    pdfServiceMocks.loadPDF.mockReturnValue(
      Effect.fail(new PDFPasswordRequiredError(makeFile(), "needs-password"))
    );
    promptForPassword.mockResolvedValue(null);

    render(() => <Editor />);

    selectFile("upload", makeFile("protected.pdf"));

    await waitFor(() => expect(promptForPassword).toHaveBeenCalled());
    expect(pdfServiceMocks.loadPDFWithPassword).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Choose PDF or image files, or drop them here" })
    ).toBeInTheDocument();
  });

  it("re-prompts when the password is wrong", async () => {
    pdfServiceMocks.loadPDF.mockReturnValue(
      Effect.fail(new PDFPasswordRequiredError(makeFile(), "needs-password"))
    );
    pdfServiceMocks.loadPDFWithPassword.mockReturnValueOnce(
      Effect.fail(new PDFPasswordRequiredError(makeFile(), "wrong-password"))
    );
    promptForPassword.mockResolvedValueOnce("bad").mockResolvedValueOnce("good");

    render(() => <Editor />);

    selectFile("upload", makeFile("protected.pdf"));

    await waitFor(() => expect(promptForPassword).toHaveBeenCalledTimes(2));
    expect(promptForPassword).toHaveBeenLastCalledWith(
      "protected.pdf",
      true,
      expect.any(AbortSignal)
    );
    await waitFor(() => expect(screen.getByTestId("editor-page-grid")).toBeInTheDocument());
  });

  it("selects all pages and reports the rotation", async () => {
    const tiles = await openPDF();
    fireEvent.click(tiles[0]);
    fireEvent.click(screen.getByTestId("editor-select-all-button"));

    await waitFor(() =>
      expect(tiles.map((tile) => tile.getAttribute("aria-pressed"))).toEqual([
        "true",
        "true",
        "true",
      ])
    );
    fireEvent.click(screen.getByTestId("editor-rotate-button"));
    const status = await screen.findByTestId("editor-status-message");
    await waitFor(() => expect(status).toHaveTextContent("Rotated 3 selected pages right."));
    await downloadWholePDF();
    await waitFor(() => expect(downloadPDF).toHaveBeenCalledTimes(1));
    expect(
      pdfOperationsMocks.buildPDF.mock.calls[0][0].map(
        (page: { rotation: number }) => page.rotation
      )
    ).toEqual([90, 90, 90]);
  });

  it("marks selected pages for deletion before export", async () => {
    const tiles = await openPDF();
    fireEvent.click(tiles[0]);
    fireEvent.click(screen.getByTestId("editor-select-all-button"));
    await waitFor(() => expect(tiles[0].getAttribute("aria-pressed")).toBe("true"));
    expect(screen.getByTestId("editor-delete-button")).toHaveTextContent("Mark for deletion");
    fireEvent.click(screen.getByTestId("editor-delete-button"));

    await waitFor(() =>
      expect(tiles.map((tile) => tile.dataset.markedForDeletion)).toEqual(["true", "true", "true"])
    );
    expect(screen.getByTestId("editor-status-bar")).toHaveTextContent("0 of 3 pages exportable.");
    expect(screen.getByTestId("editor-page-count")).toHaveTextContent("0 of 3 pages exportable");
    expect(screen.getByTestId("editor-extract-button")).toHaveAttribute("aria-disabled", "true");
    await openDownloadMenu();
    expect(screen.getByTestId("editor-download-button")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("editor-export-images-button")).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    expect(screen.getByTestId("editor-export-images-button")).toHaveTextContent(
      "Export PNG images"
    );
    expect(screen.getByTestId("editor-delete-button")).toHaveTextContent("Restore");
    expect(screen.getByTestId("editor-delete-button")).toHaveAttribute(
      "aria-label",
      "Restore selected pages"
    );

    fireEvent.click(screen.getByTestId("editor-delete-button"));
    await waitFor(() => {
      expect(tiles.map((tile) => tile.dataset.markedForDeletion)).toEqual([
        "false",
        "false",
        "false",
      ]);
      expect(screen.getByTestId("editor-delete-button")).toHaveTextContent("Mark for deletion");
    });
  });

  it("keeps the same unselected page focused through repeated, reverse and boundary keyboard moves", async () => {
    const tiles = await openPDF();
    const moved = tiles[2];
    moved.focus();
    for (const [key, index] of [
      ["ArrowLeft", 1],
      ["ArrowLeft", 0],
      ["ArrowLeft", 0],
      ["ArrowRight", 1],
      ["ArrowRight", 2],
      ["ArrowRight", 2],
      ["ArrowLeft", 1],
    ] as const) {
      fireEvent.keyDown(document.activeElement as HTMLElement, { altKey: true, key });
      await waitFor(() => expect(getPages()[index]).toHaveFocus());
      expect(getPages()[index]).toBe(moved);
      expect(moved).toHaveAttribute("data-source-page", "3");
      expect(moved).toHaveAttribute("aria-pressed", "false");
    }
    expect(screen.getByTestId("editor-status-message")).toHaveTextContent(
      "Moved page 3 to position 2."
    );
    await downloadWholePDF();
    await waitFor(() => expect(downloadPDF).toHaveBeenCalledOnce());
    const [pages, options] = pdfOperationsMocks.buildPDF.mock.calls[0];
    expect(pages.map((page: { sourcePageNumber: number }) => page.sourcePageNumber)).toEqual([
      1, 3, 2,
    ]);
    expect(options.selectedIndices).toBeUndefined();
  });

  it("keeps a selected copy's focus, active ID and export identity separate from its source", async () => {
    const file = makeFile();
    await openPDF(file);
    fireEvent.click(screen.getByRole("button", { name: "Duplicate page 1" }));
    const copy = getPages()[1];
    const original = getPages()[0];
    await waitFor(() => expect(copy).toHaveFocus());
    expect(copy).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(copy);
    for (const [key, index] of [
      ["ArrowLeft", 0],
      ["ArrowRight", 1],
      ["ArrowRight", 2],
      ["ArrowLeft", 1],
    ] as const) {
      fireEvent.keyDown(document.activeElement as HTMLElement, { altKey: true, key });
      await waitFor(() => expect(getPages()[index]).toHaveFocus());
      expect(getPages()[index]).toBe(copy);
      expect(copy).toHaveAttribute("aria-pressed", "true");
      expect(original).toHaveAttribute("aria-pressed", "false");
    }
    fireEvent.click(screen.getByRole("button", { name: "Rotate page 2 90 degrees" }));
    fireEvent.click(screen.getByRole("button", { name: "Document" }));
    expect(screen.getByTestId("editor-viewer-title")).toHaveTextContent("Page 2");
    await exportCurrent();
    await waitFor(() => expect(downloadPDF).toHaveBeenCalledOnce());
    const [pages, options] = pdfOperationsMocks.buildPDF.mock.calls[0];
    expect(pages.map((page: { sourcePageNumber: number }) => page.sourcePageNumber)).toEqual([
      1, 1, 2, 3,
    ]);
    expect(pages[1].id).not.toBe(pages[0].id);
    expect(pages.every((page: { sourceFile: File }) => page.sourceFile === file)).toBe(true);
    expect(pages.map((page: { rotation: number }) => page.rotation)).toEqual([0, 90, 0, 0]);
    expect(options.selectedIndices).toEqual([1]);
    expect(pdfServiceMocks.loadPDF).toHaveBeenCalledExactlyOnceWith(file);
  });

  it("does not reclaim focus from another control or from an unfocused keyboard event", async () => {
    const tiles = await openPDF();
    const download = screen.getByTestId("editor-download-menu-button");
    tiles[2].focus();
    fireEvent.keyDown(tiles[2], { altKey: true, key: "ArrowLeft" });
    download.focus();
    await Promise.resolve();
    expect(download).toHaveFocus();
    fireEvent.keyDown(tiles[2], { altKey: true, key: "ArrowLeft" });
    await Promise.resolve();
    expect(download).toHaveFocus();
    expect(getPages()[0]).toBe(tiles[2]);
  });

  it("resolves queued focus by page identity after another move changes its position", async () => {
    const tiles = await openPDF();
    tiles[2].focus();
    fireEvent.keyDown(tiles[2], { altKey: true, key: "ArrowLeft" });
    fireEvent.keyDown(tiles[2], { altKey: true, key: "ArrowLeft" });
    await waitFor(() => expect(getPages()[0]).toHaveFocus());
    expect(getPages()[0]).toBe(tiles[2]);
  });

  it("does not focus after a boundary, unrelated key or busy keyboard action", async () => {
    const tiles = await openPDF();
    tiles[0].focus();
    const focus = vi.spyOn(tiles[0], "focus");
    fireEvent.keyDown(tiles[0], { altKey: true, key: "ArrowLeft" });
    fireEvent.keyDown(tiles[0], { altKey: true, key: "ArrowUp" });
    fireEvent.keyDown(tiles[0], { key: "x" });
    await Promise.resolve();
    expect(focus).not.toHaveBeenCalled();
    expect(tiles[0]).toHaveFocus();
    pdfOperationsMocks.buildPDF.mockReturnValue(Effect.never);
    await downloadWholePDF();
    await waitFor(() => expect(tiles[0]).toBeDisabled());
    fireEvent.keyDown(tiles[0], { altKey: true, key: "ArrowRight" });
    await Promise.resolve();
    expect(getPages()).toEqual(tiles);
    expect(focus).not.toHaveBeenCalled();
  });

  it("does not focus a queued keyboard move after the editor is disposed", async () => {
    const view = render(() => <Editor />);
    selectFile("upload", makeFile());
    const tiles = await findPages();
    tiles[2].focus();
    const focus = vi.spyOn(tiles[2], "focus");
    fireEvent.keyDown(tiles[2], { altKey: true, key: "ArrowLeft" });
    view.unmount();
    await Promise.resolve();
    expect(focus).not.toHaveBeenCalled();
    expect(document.body).toHaveFocus();
  });

  it("does not reclaim keyboard focus after switching away from the grid", async () => {
    const tiles = await openPDF();
    tiles[2].focus();
    const focus = vi.spyOn(tiles[2], "focus");
    fireEvent.keyDown(tiles[2], { altKey: true, key: "ArrowLeft" });
    fireEvent.click(screen.getByRole("button", { name: "Document" }));
    await Promise.resolve();
    expect(focus).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Document" })).toHaveFocus();
  });

  it("reorders a page with a long-press touch drag and skips the tap selection", async () => {
    await openPDF();

    const hitareas = getPages();
    const dropTile = document.querySelectorAll("li[data-page-index]")[2];
    const documentWithProbe = document as unknown as Record<string, unknown>;
    const hadElementFromPoint = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => dropTile,
    });

    try {
      const scrollContainer = screen.getByTestId("editor-page-grid").parentElement as HTMLElement;
      vi.spyOn(scrollContainer, "getBoundingClientRect").mockReturnValue({
        top: 0,
        bottom: 400,
      } as DOMRect);
      const start = { touches: [{ identifier: 1, clientX: 10, clientY: 390 }] };
      const move = { touches: [{ identifier: 1, clientX: 220, clientY: 220 }] };

      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
      fireEvent.touchStart(hitareas[0], start);
      vi.advanceTimersByTime(200);
      expect(hitareas[0].closest("li")).not.toHaveClass("dragging");
      vi.advanceTimersByTime(100);
      expect(hitareas[0].closest("li")).toHaveClass("dragging");
      vi.advanceTimersByTime(16);
      expect(scrollContainer.scrollTop).toBeGreaterThan(0);
      fireEvent.touchMove(hitareas[0], move);
      fireEvent.touchEnd(hitareas[0], { touches: [], changedTouches: [{ identifier: 1 }] });
      vi.useRealTimers();

      expect(screen.getByTestId("editor-status-message")).toHaveTextContent(
        "Moved page 1 to position 3."
      );
      expect(hitareas[0].closest("li")).not.toHaveClass("dragging");
      expect(dropTile).not.toHaveClass("drag-insert-after");
      expect(screen.queryByTestId("editor-selection-bar")).not.toBeInTheDocument();
      await downloadWholePDF();
      await waitFor(() => expect(downloadPDF).toHaveBeenCalledTimes(1));
      expect(
        pdfOperationsMocks.buildPDF.mock.calls[0][0].map(
          (page: { sourcePageNumber: number }) => page.sourcePageNumber
        )
      ).toEqual([2, 3, 1]);
    } finally {
      vi.useRealTimers();
      if (hadElementFromPoint) {
        Object.defineProperty(document, "elementFromPoint", hadElementFromPoint);
      } else {
        delete documentWithProbe.elementFromPoint;
      }
    }
  });

  it("treats a quick touch tap on a page as selection, not a drag", async () => {
    const tiles = await openPDF();

    const hitarea = tiles[0];
    fireEvent.touchStart(hitarea, { touches: [{ clientX: 10, clientY: 10 }] });
    fireEvent.touchEnd(hitarea, { touches: [] });
    expect(hitarea.closest("li")).not.toHaveClass("dragging");

    fireEvent.click(hitarea);
    await waitFor(() => expect(tiles[0]).toHaveAttribute("aria-pressed", "true"));
  });

  it("rotates and marks a page from its direct controls", async () => {
    const tiles = await openPDF();

    const rotateButtons = await screen.findAllByRole("button", {
      name: /^Rotate page \d+ 90 degrees$/,
    });
    fireEvent.click(rotateButtons[1]);

    await waitFor(() =>
      expect(screen.getByTestId("editor-status-message")).toHaveTextContent("Rotated page 2.")
    );

    const deleteButtons = await screen.findAllByRole("button", {
      name: /^Mark page \d+ for deletion$/,
    });
    fireEvent.click(deleteButtons[1]);

    await waitFor(() => {
      expect(tiles[1]).toHaveAttribute("data-marked-for-deletion", "true");
      expect(tiles[1]).toHaveAttribute("aria-pressed", "false");
      expect(deleteButtons[1]).toHaveAccessibleName("Restore page 2");
      expect(deleteButtons[1]).not.toHaveAttribute("aria-pressed");
    });

    fireEvent.click(deleteButtons[1]);

    await waitFor(() => {
      expect(tiles[1]).toHaveAttribute("data-marked-for-deletion", "false");
    });
  });

  it("labels exports by active selected pages", async () => {
    const tiles = await openPDF();
    const deleteButtons = await screen.findAllByRole("button", {
      name: /^Mark page \d+ for deletion$/,
    });

    fireEvent.click(tiles[0]);
    fireEvent.click(deleteButtons[0]);
    fireEvent.click(tiles[1]);

    await waitFor(() => {
      expect(screen.getByTestId("editor-selection-title")).toHaveTextContent(
        "2 selected · 1 exportable"
      );
      expect(screen.getByTestId("editor-extract-button")).toHaveTextContent("Extract to PDF");
      expect(screen.getByTestId("editor-extract-button")).toHaveAccessibleName(
        "Extract 1 selected page to a new PDF"
      );
    });
    expect(screen.getByTestId("editor-delete-button")).toHaveTextContent("Mark for deletion");
    fireEvent.click(screen.getByTestId("editor-delete-button"));
    await waitFor(() => {
      expect(tiles[0]).toHaveAttribute("data-marked-for-deletion", "true");
      expect(tiles[1]).toHaveAttribute("data-marked-for-deletion", "true");
      expect(screen.getByTestId("editor-selection-title")).toHaveTextContent(
        "2 selected · 0 exportable"
      );
      expect(screen.getByTestId("editor-delete-button")).toHaveTextContent("Restore");
    });
  });

  it("toggles a page selection by clicking its tile", async () => {
    const tiles = await openPDF();

    fireEvent.click(tiles[0]);
    await waitFor(() => expect(tiles[0].getAttribute("aria-pressed")).toBe("true"));

    fireEvent.click(tiles[0]);
    await waitFor(() => expect(tiles[0].getAttribute("aria-pressed")).toBe("false"));
  });

  it("clears selection from the empty grid or with Escape", async () => {
    const tiles = await openPDF();

    fireEvent.click(tiles[0]);
    await waitFor(() => expect(tiles[0].getAttribute("aria-pressed")).toBe("true"));

    fireEvent.click(screen.getByTestId("editor-page-grid"));
    await waitFor(() => expect(tiles[0].getAttribute("aria-pressed")).toBe("false"));

    fireEvent.click(tiles[1]);
    await waitFor(() => expect(tiles[1].getAttribute("aria-pressed")).toBe("true"));
    fireEvent.keyDown(tiles[1], { key: "Escape" });
    await waitFor(() => expect(tiles[1].getAttribute("aria-pressed")).toBe("false"));
  });

  it.each([
    { scope: "the whole document with nothing selected", select: false, extract: false },
    { scope: "the whole document while pages are selected", select: true, extract: false },
    { scope: "only the selection with Extract to PDF", select: true, extract: true },
  ])("builds $scope", async ({ select, extract }) => {
    render(() => <Editor />);
    const file = makeFile();
    selectFile("upload", file);
    const tiles = await findPages();
    if (select) fireEvent.click(tiles[2]);

    if (extract) fireEvent.click(screen.getByTestId("editor-extract-button"));
    else await downloadWholePDF();

    await waitFor(() =>
      expect(downloadPDF).toHaveBeenCalledExactlyOnceWith({
        data: new Uint8Array([1, 2, 3]),
        suggestedFileName: "interleaf-output.pdf",
      })
    );
    expect(pdfOperationsMocks.buildPDF).toHaveBeenCalledExactlyOnceWith(
      [
        expect.objectContaining({ sourceFile: file, sourcePageNumber: 1 }),
        expect.objectContaining({ sourceFile: file, sourcePageNumber: 2 }),
        expect.objectContaining({ sourceFile: file, sourcePageNumber: 3 }),
      ],
      expect.objectContaining({ selectedIndices: extract ? [2] : undefined })
    );
  });

  it("exports PNG images of the selection, the whole document, or the active Document page", async () => {
    const tiles = await openPDF();
    const lastImageScope = () => pdfImageExportMocks.exportImages.mock.calls.at(-1)?.[1];

    fireEvent.click(tiles[1]);
    await waitFor(() => expect(tiles[1].getAttribute("aria-pressed")).toBe("true"));
    fireEvent.click(screen.getByTestId("editor-export-selected-images-button"));
    await waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(1));
    expect(downloadFile).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedFileName: "interleaf-images.zip" }),
      "application/zip"
    );
    expect(pdfImageExportMocks.exportImages.mock.calls[0][0]).toHaveLength(3);
    expect(lastImageScope().selectedIndices).toEqual([1]);

    await openDownloadMenu();
    fireEvent.click(screen.getByTestId("editor-export-images-button"));
    await waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(2));
    expect(lastImageScope().selectedIndices).toBeUndefined();

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByTestId("editor-selection-bar")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("editor-document-view-button"));
    expect(screen.getByTestId("editor-viewer-title")).toHaveTextContent("Page 2");
    fireEvent.click(screen.getByRole("button", { name: "Export page 2 as a PNG image" }));
    await waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(3));
    expect(lastImageScope().selectedIndices).toEqual([1]);
  });

  it("shows every page in Document and acts on the active page from its header", async () => {
    const tiles = await openPDF();
    fireEvent.click(tiles[1]);
    fireEvent.click(screen.getByTestId("editor-document-view-button"));
    // A selection never narrows the Document view.
    expect(screen.getAllByRole("button", { name: /^View page \d/ })).toHaveLength(3);
    expect(screen.getByRole("toolbar", { name: "Selected pages" })).toHaveTextContent("1 selected");
    fireEvent.click(screen.getByRole("button", { name: "Rotate page 2 90 degrees" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark page 2 for deletion" }));
    expect(screen.getByRole("button", { name: "Mark page 2 for deletion" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByLabelText("Document preview")).toHaveTextContent("Marked for deletion");
    fireEvent.click(screen.getByRole("button", { name: "Duplicate page 2" }));
    expect(screen.getByTestId("editor-viewer-title")).toHaveTextContent("Page 3");
    expect(screen.getAllByRole("button", { name: /^View page \d/ })).toHaveLength(4);
    // The selected original keeps its selection; the copy is not selected.
    expect(screen.getByTestId("editor-selection-title")).toHaveTextContent("1 selected");
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByTestId("editor-selection-bar")).not.toBeInTheDocument();
    await exportCurrent();
    await waitFor(() => expect(downloadPDF).toHaveBeenCalledOnce());
    const [pages, options] = pdfOperationsMocks.buildPDF.mock.calls[0];
    expect(pages.map((page: { rotation: number }) => page.rotation)).toEqual([0, 90, 90, 0]);
    // A copy starts unmarked, like a copy made in Pages.
    expect(pages.map((page: { markedForDeletion: boolean }) => page.markedForDeletion)).toEqual([
      false,
      true,
      false,
      false,
    ]);
    expect(options.selectedIndices).toBeUndefined();
  });

  it("compresses the original uploaded PDF before page edits", async () => {
    render(() => <Editor />);

    const file = makeFile("source.pdf");
    selectFile("upload", file);
    await waitFor(() => expect(screen.getByTestId("editor-page-grid")).toBeInTheDocument());
    await openDownloadMenu();
    fireEvent.click(screen.getByTestId("editor-compress-button"));

    await waitFor(() => expect(downloadPDF).toHaveBeenCalledTimes(1));
    expect(pdfCompressionMocks.compressPDF).toHaveBeenCalledTimes(1);
    expect(pdfCompressionMocks.compressPDF.mock.calls[0][0]).toBe(file);
    expect(pdfCompressionMocks.compressPDF.mock.calls[0][1]).toBeUndefined();
    expect(screen.getByTestId("editor-toast")).toHaveTextContent("Saved 80% (10 B → 2 B).");
    expect(screen.getByTestId("editor-status-message")).toHaveTextContent(
      "Export started. Saved 80% (10 B → 2 B)."
    );
  });

  it("reports when compression cannot make the workspace smaller", async () => {
    pdfCompressionMocks.compressPDF.mockReturnValue(
      Effect.succeed({
        data: new Uint8Array([1, 2, 3]),
        inputBytes: 3,
        candidateBytes: 4,
        outputBytes: 3,
        suggestedFileName: "document.pdf",
        reduced: false,
      })
    );

    await openPDF();

    await openDownloadMenu();
    fireEvent.click(screen.getByTestId("editor-compress-button"));

    await waitFor(() =>
      expect(screen.getByTestId("editor-toast")).toHaveTextContent(
        "Already optimal. Exported the original."
      )
    );
    expect(screen.getByTestId("editor-status-message")).toHaveTextContent(
      "Export started. Already optimal. Exported the original."
    );
    expect(downloadPDF).toHaveBeenCalledTimes(1);
  });

  it("shows a failure toast when compression fails", async () => {
    pdfCompressionMocks.compressPDF.mockReturnValue(Effect.fail(new Error("compress failed")));

    await openPDF();

    await openDownloadMenu();
    fireEvent.click(screen.getByTestId("editor-compress-button"));

    await waitFor(() => expectLastToast("Failed to compress the PDF."));
    expect(downloadPDF).not.toHaveBeenCalled();
  });

  it("shows a failure toast when building the output fails", async () => {
    pdfOperationsMocks.buildPDF.mockReturnValue(Effect.fail(new Error("build failed")));

    await openPDF();

    await downloadWholePDF();

    await waitFor(() => expectLastToast("Failed to export the PDF."));
    expect(downloadPDF).not.toHaveBeenCalled();
  });
  it("names the blocked source as escaped text, explains recovery and exports a subsequent safe selection", async () => {
    const safe = makeFile("source.pdf"),
      blocked = makeFile("<img src=x>.pdf");
    pdfServiceMocks.getPageCount.mockReturnValue(2);
    pdfOperationsMocks.buildPDF.mockReturnValueOnce(
      Effect.fail(
        new PDFProcessingError({
          operation: "reconcile-export",
          file: blocked,
          cause: new Error("linked choice"),
          message: "This PDF has linked choice fields that cannot be preserved in this export.",
        })
      )
    );
    const { container } = render(() => <Editor />);
    selectFiles("upload", [safe, blocked]);
    await waitFor(() => expect(getPages()).toHaveLength(4));
    await downloadWholePDF();
    const message =
      "<img src=x>.pdf: This PDF has linked choice fields that cannot be preserved in this export. Extract pages from other files, or remove this file, then try again.";
    await waitFor(() => expectLastToast(message));
    expect(screen.getByTestId("editor-status-message")).toHaveTextContent(message);
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(downloadPDF).not.toHaveBeenCalled();
    fireEvent.click(getPages()[0]);
    fireEvent.click(getPages()[1]);
    fireEvent.click(screen.getByTestId("editor-extract-button"));
    await waitFor(() => expect(downloadPDF).toHaveBeenCalledOnce());
    expect(pdfOperationsMocks.buildPDF.mock.calls[1][1].selectedIndices).toEqual([0, 1]);
    expect(screen.getByTestId("editor-status-message")).toHaveTextContent("Export started.");
  });

  it("clears the file picker lock on window focus when the browser fires no cancel event", async () => {
    await openPDF();
    fireEvent.click(screen.getByRole("button", { name: "Rotate page 1 90 degrees" }));
    const pressUndo = () => {
      const event = new KeyboardEvent("keydown", {
        key: "z",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      document.body.dispatchEvent(event);
      return event.defaultPrevented;
    };
    fireEvent.click(screen.getByTestId("editor-add-pdf-button"));
    expect(pressUndo()).toBe(false);
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(pressUndo()).toBe(true));
  });

  it("keeps remaining page tiles mounted when a source is removed", async () => {
    render(() => <Editor />);
    selectFiles("upload", [makeFile("one.pdf"), makeFile("two.pdf")]);
    await waitFor(() => expect(getPages()).toHaveLength(6));
    const survivor = getPages()[4];
    fireEvent.click(screen.getByTestId("editor-files-button"));
    fireEvent.click(screen.getAllByTestId("editor-file-remove")[0]);
    await waitFor(() => expect(getPages()).toHaveLength(3));
    expect(getPages()[1]).toBe(survivor);
  });

  it("keeps an existing selection when a page is duplicated", async () => {
    await openPDF();
    fireEvent.click(getPages()[0]);
    fireEvent.click(getPages()[2]);
    fireEvent.click(screen.getByRole("button", { name: "Duplicate page 1" }));
    await waitFor(() => expect(getPages()[1]).toHaveFocus());
    expect(getPages().map((page) => page.dataset.selected)).toEqual([
      "true",
      "false",
      "false",
      "true",
    ]);
    fireEvent.click(screen.getByTestId("editor-extract-button"));
    await waitFor(() => expect(downloadPDF).toHaveBeenCalledOnce());
    expect(pdfOperationsMocks.buildPDF.mock.calls[0][1].selectedIndices).toEqual([0, 3]);
  });

  it("makes the page grid one tab stop that follows the focused page", async () => {
    const tiles = await openPDF();
    const tabStops = () =>
      Array.from(
        screen.getByTestId("editor-page-grid").querySelectorAll<HTMLElement>("button")
      ).filter((button) => button.tabIndex === 0);
    expect(tabStops()).toEqual([
      tiles[0],
      screen.getByRole("button", { name: "Duplicate page 1" }),
      screen.getByRole("button", { name: "Mark page 1 for deletion" }),
      screen.getByRole("button", { name: "Rotate page 1 90 degrees" }),
    ]);
    expect(tiles[0]).toHaveAccessibleDescription(/Use the arrow keys to move between pages/);
    tiles[0].focus();
    fireEvent.keyDown(tiles[0], { key: "ArrowRight" });
    expect(tiles[1]).toHaveFocus();
    expect(tabStops()[0]).toBe(tiles[1]);
    expect(tiles[0]).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(tiles[1], { key: "End" });
    expect(tiles[2]).toHaveFocus();
    fireEvent.keyDown(tiles[2], { key: "ArrowRight" });
    expect(tiles[2]).toHaveFocus();
    fireEvent.keyDown(tiles[2], { key: "Home" });
    expect(tiles[0]).toHaveFocus();
    expect(getPages().every((page) => page.dataset.selected === "false")).toBe(true);
  });

  it("rotates and toggles deletion on the focused page from the keyboard", async () => {
    const tiles = await openPDF();
    tiles[1].focus();
    fireEvent.keyDown(tiles[1], { key: "r" });
    const canvas = () =>
      tiles[1].closest("li")?.querySelector<HTMLElement>('[data-testid="editor-page-canvas"]');
    expect(canvas()).toHaveStyle({ "--page-rotation": "90deg" });
    fireEvent.keyDown(tiles[1], { key: "r", ctrlKey: true });
    expect(canvas()).toHaveStyle({ "--page-rotation": "90deg" });
    fireEvent.keyDown(tiles[1], { key: "Delete" });
    expect(tiles[1]).toHaveAttribute("data-marked-for-deletion", "true");
    expect(screen.getByRole("button", { name: "Restore page 2" })).toBeInTheDocument();
    fireEvent.keyDown(tiles[1], { key: "Backspace" });
    expect(tiles[1]).toHaveAttribute("data-marked-for-deletion", "false");
    expect(tiles[1]).toHaveFocus();
    expect(screen.getByTestId("editor-undo-button")).toHaveAttribute(
      "aria-label",
      "Undo page restoration"
    );
  });

  it("undoes a file removal from inside the open Files dialog", async () => {
    render(() => <Editor />);
    selectFiles("upload", [makeFile("first.pdf"), makeFile("second.pdf")]);
    await waitFor(() => expect(getPages()).toHaveLength(6));
    fireEvent.click(screen.getByTestId("editor-files-button"));
    fireEvent.click(screen.getAllByTestId("editor-file-remove")[0]);
    await waitFor(() => expect(getPages()).toHaveLength(3));
    await waitFor(() =>
      expect(screen.getByTestId("editor-root")).toHaveAttribute("aria-busy", "false")
    );
    const close = screen.getByTestId("editor-files-close-button");
    close.focus();
    const undo = new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    close.dispatchEvent(undo);
    expect(undo.defaultPrevented).toBe(true);
    await waitFor(() => expect(getPages()).toHaveLength(6));
    await waitFor(() => expect(screen.getAllByTestId("editor-file-item")).toHaveLength(2));
    expect(screen.getByTestId("editor-files-dialog")).toHaveAttribute("open");
    expect(screen.getByTestId("editor-files-notice")).toHaveTextContent("Undid source removal.");
  });
});
