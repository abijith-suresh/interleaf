import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { Deferred, Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFPasswordRequiredError, PDFProcessingError } from "@/types/interfaces";

const pdfServiceMocks = vi.hoisted(() => ({
  loadPDF: vi.fn(),
  loadPDFWithPassword: vi.fn(),
  getPageCount: vi.fn(),
  getPassword: vi.fn(),
  getPageRotation: vi.fn(),
  getPageSize: vi.fn(),
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

async function openEditMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Edit pages" }));
  expect(await screen.findByRole("menu", { name: "Page editing options" })).toBeVisible();
}

async function openDownloadMenu() {
  fireEvent.click(screen.getByRole("button", { name: "More download options" }));
  expect(await screen.findByRole("menu", { name: "Download options" })).toBeVisible();
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
    fireEvent.click(screen.getByTestId("editor-download-button"));
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
      fireEvent.click(screen.getByTestId("editor-download-button"));
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
    await openEditMenu();
    fireEvent.click(screen.getByTestId("editor-rotate-button"));
    await openEditMenu();
    fireEvent.click(screen.getByTestId("editor-delete-button"));
    await openEditMenu();
    fireEvent.click(screen.getByTestId("editor-delete-button"));
    fireEvent.click(screen.getByRole("button", { name: "Duplicate page 2" }));
    await waitFor(() => expect(getPages()[2]).toHaveFocus());
    fireEvent.keyDown(getPages()[2], { key: "ArrowRight", altKey: true });
    const changed = await state();
    expect(changed.pages.map((page: { rotation: number }) => page.rotation)).toEqual([
      90, 180, 0, 180,
    ]);
    expect(changed.selected).toEqual([3]);
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
    expect(screen.getByTestId("editor-viewer-title")).toHaveTextContent("Page 4");
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
    await openEditMenu();
    ignored(screen.getByTestId("editor-select-all-button"));
    fireEvent.keyDown(screen.getByTestId("editor-select-all-button"), { key: "Escape" });
    fireEvent.click(screen.getByTestId("editor-files-button"));
    ignored(screen.getByTestId("editor-files-close-button"));
    fireEvent.click(screen.getByTestId("editor-files-close-button"));
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
    fireEvent.click(screen.getByTestId("editor-download-button"));
    await waitFor(() => expectLastToast("Failed to export the PDF."));
    expect(screen.getByTestId("editor-redo-button")).toHaveAttribute("aria-disabled", "false");
    const broken = makeFile("broken.pdf");
    pdfServiceMocks.loadPDF
      .mockReturnValueOnce(Effect.void)
      .mockReturnValueOnce(Effect.fail(new Error("invalid PDF")));
    selectFiles("add", [makeFile("staged.pdf"), broken]);
    await waitFor(() =>
      expect(pdfServiceMocks.releaseFile).toHaveBeenCalledWith(
        expect.objectContaining({ name: "staged.pdf" })
      )
    );
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
    expect(screen.getByTestId("editor-undo-button")).toHaveAttribute("aria-disabled", "true");
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
    fireEvent.click(screen.getByRole("button", { name: "Duplicate page 1" }));
    fireEvent.click(screen.getByTestId("editor-document-view-button"));
    await waitFor(() => expect(screen.getByTestId("editor-document-view-button")).toHaveFocus());
    const copy = screen.getByRole("button", { name: "View page 2" });
    copy.focus();
    fireEvent.keyDown(copy, { key: "z", ctrlKey: true });
    await waitFor(() => expect(screen.getByRole("button", { name: "View page 1" })).toHaveFocus());
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Z",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(screen.getByTestId("editor-viewer-title")).toHaveTextContent("Page 2");
    expect(screen.getByRole("button", { name: "View page 2" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    fireEvent.click(screen.getByTestId("editor-undo-button"));
    const next = screen.getByTestId("editor-page-viewer-next");
    next.focus();
    fireEvent.keyDown(next, { key: "y", ctrlKey: true });
    await waitFor(() => expect(screen.getByRole("button", { name: "View page 2" })).toHaveFocus());
    expect(next).toBeDisabled();
  });

  it("keeps marked pages inspectable after history restores their selection in Document", async () => {
    await openPDF();
    fireEvent.click(getPages()[1]);
    fireEvent.click(screen.getByRole("button", { name: "Mark page 2 for deletion" }));
    fireEvent.click(screen.getByRole("button", { name: "Restore page 2 from deletion" }));
    fireEvent.click(screen.getByTestId("editor-document-view-button"));
    fireEvent.click(screen.getByTestId("editor-undo-button"));
    expect(screen.getByTestId("editor-viewer-title")).toHaveTextContent("Page 2");
    expect(screen.getByLabelText("Document preview")).toHaveTextContent("Marked for deletion");
    expect(screen.getByTestId("editor-selection-title")).toHaveTextContent(
      "1 selected · 0 exportable"
    );
    expect(screen.getByTestId("editor-download-button")).toBeDisabled();
    fireEvent.click(screen.getByTestId("editor-redo-button"));
    expect(screen.getByTestId("editor-download-button")).not.toBeDisabled();
    expect(screen.getByTestId("editor-viewer-title")).toHaveTextContent("Page 2");
  });

  it("does not steal focus from another control or restore queued focus after disposal", async () => {
    const view = render(() => <Editor />);
    selectFiles("upload", [makeFile()]);
    await findPages();
    fireEvent.click(screen.getByRole("button", { name: "Duplicate page 1" }));
    await waitFor(() => expect(getPages()[1]).toHaveFocus());
    fireEvent.keyDown(getPages()[1], { key: "z", ctrlKey: true });
    const download = screen.getByTestId("editor-download-button");
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

  it("duplicates rapidly without loading or building sources and navigates to the selected copy", async () => {
    const file = makeFile();
    await openPDF(file);
    fireEvent.click(screen.getByRole("button", { name: "Rotate page 2 90 degrees" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark page 2 for deletion" }));
    for (let repeat = 0; repeat < 5; repeat++) {
      fireEvent.click(screen.getByRole("button", { name: "Duplicate page 2" }));
    }
    expect(getPages()).toHaveLength(8);
    expect(getPages().map((page) => page.dataset.selected)).toEqual([
      "false",
      "false",
      "true",
      "false",
      "false",
      "false",
      "false",
      "false",
    ]);
    await waitFor(() => expect(getPages()[2]).toHaveFocus());
    expect(getPages()[1]).toHaveAttribute("data-marked-for-deletion", "true");
    expect(getPages()[2]).toHaveAttribute("data-marked-for-deletion", "false");
    expect(pdfServiceMocks.loadPDF).toHaveBeenCalledExactlyOnceWith(file);
    expect(pdfOperationsMocks.buildPDF).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Document" }));
    expect(screen.getByTestId("editor-viewer-title")).toHaveTextContent("Page 3");
    expect(screen.queryByRole("button", { name: /Duplicate page/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("editor-download-button"));
    await waitFor(() => expect(downloadPDF).toHaveBeenCalledOnce());
    const [pages, options] = pdfOperationsMocks.buildPDF.mock.calls[0];
    expect(new Set(pages.map((page: { id: string }) => page.id)).size).toBe(8);
    expect(pages.every((page: { sourceFile: File }) => page.sourceFile === file)).toBe(true);
    expect(pages.map((page: { rotation: number }) => page.rotation)).toEqual([
      0, 90, 90, 90, 90, 90, 90, 0,
    ]);
    expect(options.selectedIndices).toEqual([2]);
    fireEvent.click(screen.getByRole("button", { name: "More download options" }));
    fireEvent.click(screen.getByTestId("editor-export-images-button"));
    await waitFor(() => expect(downloadFile).toHaveBeenCalledOnce());
    expect(pdfImageExportMocks.exportImages.mock.calls[0][0][2].id).toBe(pages[2].id);
    expect(pdfImageExportMocks.exportImages.mock.calls[0][1].selectedIndices).toEqual([2]);
  });

  it("keeps copy organization independent and removes all copies with their original source", async () => {
    const first = makeFile("same.pdf");
    const second = makeFile("same.pdf");
    render(() => <Editor />);
    selectFiles("upload", [first, second]);
    await waitFor(() => expect(getPages()).toHaveLength(6));
    fireEvent.click(screen.getByRole("button", { name: "Duplicate page 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Rotate page 2 90 degrees" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark page 2 for deletion" }));
    expect(getPages()[0]).toHaveAttribute("data-marked-for-deletion", "false");
    fireEvent.click(screen.getByRole("button", { name: "Restore page 2 from deletion" }));
    fireEvent.keyDown(getPages()[1], { altKey: true, key: "ArrowRight" });
    expect(getPages()[2]).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTestId("editor-download-button"));
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

  it("rejects unsupported files with an error toast", async () => {
    render(() => <Editor />);

    selectFile("upload", new File(["text"], "notes.txt", { type: "text/plain" }));

    const toast = await screen.findByTestId("editor-toast");
    expect(toast).toHaveTextContent("Choose PDF, PNG, or JPEG files.");
    expect(pdfServiceMocks.loadPDF).not.toHaveBeenCalled();
    expect(pdfOperationsMocks.imagesToPDF).not.toHaveBeenCalled();
    expect(screen.queryByTestId("editor-page-grid")).not.toBeInTheDocument();
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

  it("does not partially commit a batch when a later file fails", async () => {
    const failedFile = makeFile("broken.pdf");
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
    render(() => <Editor />);

    selectFiles("upload", [makeFile("good.pdf"), makeImageFile(), failedFile]);

    expect(await screen.findByTestId("editor-toast")).toHaveTextContent(
      "Failed to load broken.pdf"
    );
    expect(screen.queryByTestId("editor-page-grid")).not.toBeInTheDocument();
    await waitFor(() => expect(pdfServiceMocks.releaseFile).toHaveBeenCalledTimes(2));
    expect(pdfServiceMocks.releaseFile).toHaveBeenCalledWith(
      expect.objectContaining({ name: "good.pdf" })
    );
    expect(pdfServiceMocks.releaseFile).toHaveBeenCalledWith(
      expect.objectContaining({ name: "interleaf-images.pdf" })
    );
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
      selection: "All 3 exportable",
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
      expect(screen.getByTestId("editor-selection-title")).toHaveTextContent(selection);
      expect(getPages().map((tile) => tile.getAttribute("aria-pressed"))).toEqual(pressed);
      expect(pdfServiceMocks.releaseFile).toHaveBeenCalledExactlyOnceWith(removed);
      await waitFor(() =>
        expect(screen.getByTestId("editor-root")).toHaveAttribute("aria-busy", "false")
      );

      fireEvent.click(screen.getByRole("button", { name: /^Download a PDF/ }));
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

  it("does not partially add a batch when a later workspace file fails", async () => {
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

    expect(await screen.findByTestId("editor-toast")).toHaveTextContent(
      "Failed to load broken-add.pdf"
    );
    expect(await findPages()).toHaveLength(3);
    await waitFor(() => expect(pdfServiceMocks.releaseFile).toHaveBeenCalledTimes(1));
    expect(pdfServiceMocks.releaseFile).toHaveBeenCalledWith(
      expect.objectContaining({ name: "good-add.pdf" })
    );
  });

  it("keeps a failed batch busy until staged resources are released", async () => {
    const failedFile = makeFile("protected-add.pdf");
    const release = Deferred.makeUnsafe<void>();
    pdfServiceMocks.releaseFile.mockReturnValueOnce(Deferred.await(release));
    pdfServiceMocks.loadPDF
      .mockReturnValueOnce(Effect.succeed(undefined))
      .mockReturnValueOnce(Effect.succeed(undefined))
      .mockReturnValueOnce(Effect.fail(new PDFPasswordRequiredError(failedFile, "needs-password")));
    promptForPassword.mockResolvedValue(null);

    await openPDF(makeFile("existing.pdf"));

    selectFiles("add", [makeFile("good-add.pdf"), failedFile]);

    await waitFor(() =>
      expect(promptForPassword).toHaveBeenCalledWith(
        "protected-add.pdf",
        false,
        expect.any(AbortSignal)
      )
    );
    expect(screen.getByLabelText("Choose additional PDF or image files")).toBeDisabled();

    await Effect.runPromise(Deferred.succeed(release, undefined));
    await waitFor(() =>
      expect(screen.getByLabelText("Choose additional PDF or image files")).toBeEnabled()
    );
    expect(await findPages()).toHaveLength(3);
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

  it("updates selection actions and compression eligibility when a page is selected", async () => {
    const tiles = await openPDF();
    await openEditMenu();
    for (const name of [
      "No pages selected to clear",
      "Select pages to rotate",
      "Select pages to mark or restore",
    ]) {
      expect(screen.getByRole("menuitem", { name })).toHaveAttribute("aria-disabled", "true");
    }
    await openDownloadMenu();
    expect(screen.getByRole("menuitem", { name: "Compress the original PDF" })).toBeEnabled();
    fireEvent.click(tiles[0]);
    await openEditMenu();
    for (const name of [
      "Clear page selection",
      "Rotate selected pages 90 degrees",
      "Mark selected pages for deletion",
    ]) {
      expect(screen.getByRole("menuitem", { name })).toBeEnabled();
    }
    await openDownloadMenu();
    expect(screen.getByTestId("editor-compress-button")).toHaveAttribute("aria-disabled", "true");
  });

  it("uses one clear control after every page is selected", async () => {
    await openPDF();

    await openEditMenu();
    expect(screen.getByRole("menuitem", { name: "Select all pages" })).toBeEnabled();

    fireEvent.click(screen.getByTestId("editor-select-all-button"));

    await openEditMenu();
    await waitFor(() => {
      expect(screen.getByTestId("editor-select-all-button")).toHaveAccessibleName(
        "All pages selected"
      );
      expect(screen.getByTestId("editor-select-all-button")).toHaveAttribute(
        "aria-disabled",
        "true"
      );
      expect(screen.getByRole("menuitem", { name: "Clear page selection" })).toBeEnabled();
    });

    fireEvent.click(screen.getByTestId("editor-clear-selection-button"));

    await openEditMenu();
    await waitFor(() =>
      expect(screen.getByTestId("editor-select-all-button")).toHaveTextContent("Select all pages")
    );
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

    await openEditMenu();
    fireEvent.click(screen.getByTestId("editor-select-all-button"));

    await waitFor(() =>
      expect(tiles.map((tile) => tile.getAttribute("aria-pressed"))).toEqual([
        "true",
        "true",
        "true",
      ])
    );

    await openEditMenu();
    fireEvent.click(screen.getByTestId("editor-rotate-button"));
    const status = await screen.findByTestId("editor-status-message");
    await waitFor(() => expect(status).toHaveTextContent("Rotated 3 selected pages."));
    fireEvent.click(screen.getByRole("button", { name: /^Download a PDF/ }));
    await waitFor(() => expect(downloadPDF).toHaveBeenCalledTimes(1));
    expect(
      pdfOperationsMocks.buildPDF.mock.calls[0][0].map(
        (page: { rotation: number }) => page.rotation
      )
    ).toEqual([90, 90, 90]);
  });

  it("marks selected pages for deletion before export", async () => {
    const tiles = await openPDF();

    await openEditMenu();
    fireEvent.click(screen.getByTestId("editor-select-all-button"));
    await waitFor(() => expect(tiles[0].getAttribute("aria-pressed")).toBe("true"));

    await openEditMenu();
    expect(screen.getByTestId("editor-delete-button")).toHaveTextContent("Mark for deletion");
    fireEvent.click(screen.getByTestId("editor-delete-button"));

    await waitFor(() =>
      expect(tiles.map((tile) => tile.dataset.markedForDeletion)).toEqual(["true", "true", "true"])
    );
    expect(screen.getByTestId("editor-status-bar")).toHaveTextContent("0 of 3 pages exportable.");
    expect(screen.getByTestId("editor-download-button")).toBeDisabled();
    await openDownloadMenu();
    expect(screen.getByTestId("editor-export-images-button")).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    expect(screen.getByTestId("editor-export-images-button")).toHaveTextContent(
      "Export PNG images"
    );
    await openEditMenu();
    expect(screen.getByTestId("editor-delete-button")).toHaveTextContent("Restore");
    expect(screen.getByTestId("editor-delete-button")).toHaveAttribute(
      "aria-label",
      "Restore selected pages"
    );

    fireEvent.click(screen.getByTestId("editor-delete-button"));

    await openEditMenu();
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
    fireEvent.click(screen.getByTestId("editor-download-button"));
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
    fireEvent.click(screen.getByTestId("editor-download-button"));
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
    const download = screen.getByTestId("editor-download-button");
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
    fireEvent.keyDown(tiles[0], { key: "ArrowRight" });
    await Promise.resolve();
    expect(focus).not.toHaveBeenCalled();
    expect(tiles[0]).toHaveFocus();
    pdfOperationsMocks.buildPDF.mockReturnValue(Effect.never);
    fireEvent.click(screen.getByTestId("editor-download-button"));
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
      expect(screen.queryByTestId("editor-edit-menu")).not.toBeInTheDocument();
      expect(hitareas[0].closest("li")).not.toHaveClass("dragging");
      expect(dropTile).not.toHaveClass("drag-insert-after");
      expect(screen.getByTestId("editor-selection-title")).toHaveTextContent("All 3 exportable");
      fireEvent.click(screen.getByRole("button", { name: /^Download a PDF/ }));
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
      name: /^(Mark page \d+ for deletion|Restore page \d+ from deletion)$/,
    });
    fireEvent.click(deleteButtons[1]);

    await waitFor(() => {
      expect(tiles[1]).toHaveAttribute("data-marked-for-deletion", "true");
      expect(tiles[1]).toHaveAttribute("aria-pressed", "false");
      expect(deleteButtons[1]).toHaveAttribute("aria-label", "Restore page 2 from deletion");
    });

    fireEvent.click(deleteButtons[1]);

    await waitFor(() => {
      expect(tiles[1]).toHaveAttribute("data-marked-for-deletion", "false");
    });
  });

  it("labels exports by active selected pages", async () => {
    const tiles = await openPDF();
    const deleteButtons = await screen.findAllByRole("button", {
      name: /^(Mark page \d+ for deletion|Restore page \d+ from deletion)$/,
    });

    fireEvent.click(tiles[0]);
    fireEvent.click(deleteButtons[0]);
    fireEvent.click(tiles[1]);

    await waitFor(() => {
      expect(screen.getByTestId("editor-selection-title")).toHaveTextContent(
        "2 selected · 1 exportable"
      );
      expect(screen.getByTestId("editor-download-button")).toHaveTextContent("Download PDF");
      expect(screen.getByTestId("editor-download-button")).toHaveAccessibleName(
        "Download a PDF with 1 exportable page"
      );
    });

    await openEditMenu();
    expect(screen.getByTestId("editor-delete-button")).toHaveTextContent("Mark for deletion");
    fireEvent.click(screen.getByTestId("editor-delete-button"));

    await openEditMenu();
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
    { scope: "all exportable pages", selectedIndices: undefined },
    { scope: "selected pages", selectedIndices: [2] },
  ])("downloads the PDF built for $scope", async ({ selectedIndices }) => {
    render(() => <Editor />);
    const file = makeFile();
    selectFile("upload", file);
    const tiles = await findPages();
    if (selectedIndices) fireEvent.click(tiles[2]);

    fireEvent.click(screen.getByRole("button", { name: /^Download a PDF/ }));

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
      expect.objectContaining({ selectedIndices })
    );
  });

  it("exports selected pages as PNG images", async () => {
    const tiles = await openPDF();

    fireEvent.click(tiles[1]);
    await waitFor(() => expect(tiles[1].getAttribute("aria-pressed")).toBe("true"));
    await openDownloadMenu();
    fireEvent.click(screen.getByTestId("editor-export-images-button"));

    await waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(1));
    expect(downloadFile).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedFileName: "interleaf-images.zip" }),
      "application/zip"
    );
    expect(pdfImageExportMocks.exportImages).toHaveBeenCalledTimes(1);
    expect(pdfImageExportMocks.exportImages.mock.calls[0][0]).toHaveLength(3);
    expect(pdfImageExportMocks.exportImages.mock.calls[0][1].selectedIndices).toEqual([1]);
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
    expect(screen.getByTestId("editor-toast")).toHaveTextContent("Compressed 10 B to 2 B.");
  });

  it("reports when compression cannot make the workspace smaller", async () => {
    pdfCompressionMocks.compressPDF.mockReturnValue(
      Effect.succeed({
        data: new Uint8Array([1, 2, 3]),
        inputBytes: 3,
        candidateBytes: 4,
        outputBytes: 3,
        suggestedFileName: "interleaf-output.pdf",
        reduced: false,
      })
    );

    await openPDF();

    await openDownloadMenu();
    fireEvent.click(screen.getByTestId("editor-compress-button"));

    await waitFor(() =>
      expect(screen.getByTestId("editor-toast")).toHaveTextContent(
        "No smaller file was available. The original PDF was exported."
      )
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

    fireEvent.click(screen.getByTestId("editor-download-button"));

    await waitFor(() => expectLastToast("Failed to export the PDF."));
    expect(downloadPDF).not.toHaveBeenCalled();
  });
});
