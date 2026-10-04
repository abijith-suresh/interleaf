import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { Effect } from "effect";
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
}));

const pdfOperationsMocks = vi.hoisted(() => ({
  buildPDF: vi.fn(),
  imagesToPDF: vi.fn(),
  clearCache: vi.fn(),
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
  },
}));
vi.mock("@/services/pdf-operations-service", () => ({
  PDFOperationsService: class {
    buildPDF = pdfOperationsMocks.buildPDF;
    imagesToPDF = pdfOperationsMocks.imagesToPDF;
    clearCache = pdfOperationsMocks.clearCache;
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

  it("renders the upload dropzone before any file is loaded", () => {
    render(() => <Editor />);

    expect(
      screen.getByRole("button", { name: "Choose PDF or image files, or drop them here" })
    ).toBeInTheDocument();
    expect(screen.queryByTestId("editor-page-grid")).not.toBeInTheDocument();
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

  it("opens a multi-page review without requiring a single selected page", async () => {
    await openPDF();

    fireEvent.click(screen.getByRole("button", { name: /Review/ }));

    await waitFor(() => expect(screen.getByTestId("editor-page-viewer")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next page" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() =>
      expect(screen.getByTestId("editor-viewer-title")).toHaveTextContent("Page 2")
    );

    fireEvent.click(screen.getByRole("button", { name: "Close page review" }));
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
    expect(screen.getByTestId("editor-files-button")).toHaveAttribute("aria-label", "Open 1 file");
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
      selection: "No pages selected",
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

      fireEvent.click(screen.getByRole("button", { name: "Open 2 files" }));
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Remove brief.pdf and its 3 pages from the workspace",
        })
      );

      await waitFor(() => expect(getPages()).toHaveLength(3));
      expect(screen.getByTestId("editor-selection-title")).toHaveTextContent(selection);
      expect(getPages().map((tile) => tile.getAttribute("aria-pressed"))).toEqual(pressed);
      expect(pdfServiceMocks.releaseFile).toHaveBeenCalledExactlyOnceWith(removed);

      fireEvent.click(screen.getByRole("button", { name: /^Download a PDF/ }));
      await waitFor(() => expect(downloadPDF).toHaveBeenCalledTimes(1));
      const [pages, options] = pdfOperationsMocks.buildPDF.mock.calls[0];
      expect(pages.map((page: { sourceFile: File }) => page.sourceFile)).toEqual([
        remaining,
        remaining,
        remaining,
      ]);
      expect(options.selectedIndices).toEqual(selectedIndices);
      expect(screen.getByRole("button", { name: "Open 1 file" })).toBeEnabled();
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
    const release = Promise.withResolvers<void>();
    pdfServiceMocks.releaseFile.mockReturnValueOnce(Effect.promise(() => release.promise));
    pdfServiceMocks.loadPDF
      .mockReturnValueOnce(Effect.succeed(undefined))
      .mockReturnValueOnce(Effect.succeed(undefined))
      .mockReturnValueOnce(Effect.fail(new PDFPasswordRequiredError(failedFile, "needs-password")));
    promptForPassword.mockResolvedValue(null);

    await openPDF(makeFile("existing.pdf"));

    selectFiles("add", [makeFile("good-add.pdf"), failedFile]);

    await waitFor(() => expect(promptForPassword).toHaveBeenCalledWith("protected-add.pdf", false));
    expect(screen.getByLabelText("Choose additional PDF or image files")).toBeDisabled();

    release.resolve();
    await waitFor(() =>
      expect(screen.getByLabelText("Choose additional PDF or image files")).toBeEnabled()
    );
    expect(await findPages()).toHaveLength(3);
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

    await waitFor(() => expect(promptForPassword).toHaveBeenCalledWith("protected.pdf", false));
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
    expect(promptForPassword).toHaveBeenLastCalledWith("protected.pdf", true);
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
    expect(screen.getByTestId("editor-status-bar")).toHaveTextContent("3 pages (0 active)");
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

  it("reorders a page with the keyboard alternative", async () => {
    const tiles = await openPDF();

    fireEvent.keyDown(tiles[2], { altKey: true, key: "ArrowLeft" });

    expect(screen.getByTestId("editor-status-message")).toHaveTextContent(
      "Moved page 3 to position 2."
    );
    fireEvent.click(screen.getByRole("button", { name: /^Download a PDF/ }));
    await waitFor(() => expect(downloadPDF).toHaveBeenCalledTimes(1));
    expect(
      pdfOperationsMocks.buildPDF.mock.calls[0][0].map(
        (page: { sourcePageNumber: number }) => page.sourcePageNumber
      )
    ).toEqual([1, 3, 2]);
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
      const start = { touches: [{ identifier: 1, clientX: 10, clientY: 10 }] };
      const move = { touches: [{ identifier: 1, clientX: 220, clientY: 220 }] };

      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      fireEvent.touchStart(hitareas[0], start);
      vi.advanceTimersByTime(200);
      expect(hitareas[0].closest("li")).not.toHaveClass("dragging");
      vi.advanceTimersByTime(100);
      expect(hitareas[0].closest("li")).toHaveClass("dragging");
      vi.useRealTimers();

      fireEvent.touchMove(hitareas[0], move);
      await waitFor(() => expect(dropTile).toHaveClass("drag-insert-after"));

      fireEvent.touchEnd(hitareas[0], { touches: [], changedTouches: [{ identifier: 1 }] });

      expect(screen.getByTestId("editor-status-message")).toHaveTextContent(
        "Moved page 1 to position 3."
      );
      expect(screen.queryByTestId("editor-edit-menu")).not.toBeInTheDocument();
      expect(hitareas[0].closest("li")).not.toHaveClass("dragging");
      expect(dropTile).not.toHaveClass("drag-insert-after");
      expect(screen.getByTestId("editor-selection-title")).toHaveTextContent("No pages selected");
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
        "Download a PDF with 1 selected active page"
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
    { scope: "all active pages", selectedIndices: undefined },
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
        "No smaller file was available. Downloaded the current PDF."
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

    await waitFor(() => expectLastToast("Failed to build the PDF."));
    expect(downloadPDF).not.toHaveBeenCalled();
  });
});
