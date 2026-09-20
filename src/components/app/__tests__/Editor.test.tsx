import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFPasswordRequiredError } from "@/types/interfaces";

const pdfServiceMocks = vi.hoisted(() => ({
  loadPDF: vi.fn(),
  loadPDFWithPassword: vi.fn(),
  getPageCount: vi.fn(),
  getPassword: vi.fn(),
  getPageRotation: vi.fn(),
  getPageSize: vi.fn(),
  renderPage: vi.fn(),
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

function selectFiles(testid: string, files: File[]) {
  const input = document.querySelector<HTMLInputElement>(`[data-testid="${testid}"]`);
  if (!input) throw new Error(`missing input ${testid}`);
  Object.defineProperty(input, "files", { value: files });
  fireEvent(input, new Event("change", { bubbles: true }));
}

function selectFile(testid: string, file: File) {
  selectFiles(testid, [file]);
}

// Toasts accumulate until their 3s dismissal timer fires, so assert on the newest one.
function expectLastToast(text: string) {
  const toasts = Array.from(document.querySelectorAll('[data-testid="editor-toast"]'));
  expect(toasts.at(-1)).toHaveTextContent(text);
}

type TestIdQuery = (testId: string) => HTMLElement;

async function openEditMenu(getByTestId: TestIdQuery) {
  fireEvent.click(getByTestId("editor-edit-menu-button"));
  await waitFor(() => expect(getByTestId("editor-edit-menu")).toBeVisible());
}

async function openDownloadMenu(getByTestId: TestIdQuery) {
  fireEvent.click(getByTestId("editor-download-options-button"));
  await waitFor(() => expect(getByTestId("editor-download-options-menu")).toBeVisible());
}

describe("Editor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pdfServiceMocks.getPageCount.mockReturnValue(3);
    pdfServiceMocks.getPageRotation.mockReturnValue(Effect.succeed(0));
    pdfServiceMocks.getPageSize.mockReturnValue(Effect.succeed({ width: 100, height: 200 }));
    pdfServiceMocks.loadPDF.mockReturnValue(Effect.succeed(undefined));
    pdfServiceMocks.loadPDFWithPassword.mockReturnValue(Effect.succeed(undefined));
    pdfServiceMocks.renderPage.mockReturnValue(Effect.succeed(undefined));
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
    const { getByTestId, queryByTestId, container } = render(() => <Editor />);

    expect(getByTestId("editor-upload-dropzone")).toBeInTheDocument();
    expect(queryByTestId("editor-page-grid")).not.toBeInTheDocument();
    expect(container.querySelector(".editor-uploader-mark")).not.toBeInTheDocument();
  });

  it("rejects unsupported files with an error toast", async () => {
    const { findByTestId, queryByTestId } = render(() => <Editor />);

    selectFile("editor-upload-input", new File(["text"], "notes.txt", { type: "text/plain" }));

    const toast = await findByTestId("editor-toast");
    expect(toast).toHaveTextContent("Choose PDF files or PNG/JPEG images at a time.");
    expect(pdfServiceMocks.loadPDF).not.toHaveBeenCalled();
    expect(pdfOperationsMocks.imagesToPDF).not.toHaveBeenCalled();
    expect(queryByTestId("editor-page-grid")).not.toBeInTheDocument();
  });

  it("loads a valid PDF into the page grid", async () => {
    const { getByTestId, findAllByTestId } = render(() => <Editor />);

    selectFile("editor-upload-input", makeFile());

    await waitFor(() => expect(getByTestId("editor-page-grid")).toBeInTheDocument());
    const tiles = await findAllByTestId("editor-page-tile");
    expect(tiles).toHaveLength(3);
  });

  it("opens a multi-page review without requiring a single selected page", async () => {
    const { getByTestId, findAllByTestId, queryByTestId } = render(() => <Editor />);

    selectFile("editor-upload-input", makeFile());
    await findAllByTestId("editor-page-tile");

    fireEvent.click(getByTestId("editor-review-button"));

    await waitFor(() => expect(getByTestId("editor-page-viewer")).toBeInTheDocument());
    expect(getByTestId("editor-page-viewer-previous")).toBeDisabled();
    expect(getByTestId("editor-page-viewer-next")).toBeEnabled();

    fireEvent.click(getByTestId("editor-page-viewer-next"));
    await waitFor(() => expect(getByTestId("editor-viewer-title")).toHaveTextContent("Page 2"));

    fireEvent.click(getByTestId("editor-page-viewer-close-button"));
    await waitFor(() => expect(queryByTestId("editor-page-viewer")).not.toBeInTheDocument());
  });

  it("turns selected images into a PDF and opens it in the workspace", async () => {
    const { getByTestId, findAllByTestId } = render(() => <Editor />);
    const images = [makeImageFile("one.png"), makeImageFile("two.jpg", "image/jpeg")];

    selectFiles("editor-upload-input", images);

    await waitFor(() => expect(getByTestId("editor-page-grid")).toBeInTheDocument());
    expect(pdfOperationsMocks.imagesToPDF).toHaveBeenCalledWith(
      images,
      expect.objectContaining({ onProgress: expect.any(Function) })
    );
    expect(pdfServiceMocks.loadPDF).toHaveBeenCalledWith(
      expect.objectContaining({ name: "interleaf-images.pdf", type: "application/pdf" })
    );
    expect(await findAllByTestId("editor-page-tile")).toHaveLength(3);
    expect(getByTestId("editor-status-message")).toHaveTextContent("Created a PDF from 2 images.");
  });

  it("rejects mixed PDF and image selections with a clear next step", async () => {
    const { findByTestId } = render(() => <Editor />);

    selectFiles("editor-upload-input", [makeFile(), makeImageFile()]);

    expect(await findByTestId("editor-toast")).toHaveTextContent(
      "Choose PDF files or PNG/JPEG images at a time."
    );
    expect(pdfServiceMocks.loadPDF).not.toHaveBeenCalled();
    expect(pdfOperationsMocks.imagesToPDF).not.toHaveBeenCalled();
  });

  it("loads multiple selected PDFs into the same workspace", async () => {
    const { getByTestId, findAllByTestId } = render(() => <Editor />);
    const files = [makeFile("one.pdf"), makeFile("two.pdf")];

    selectFiles("editor-upload-input", files);

    await waitFor(async () => expect(await findAllByTestId("editor-page-tile")).toHaveLength(6));
    expect(pdfServiceMocks.loadPDF).toHaveBeenCalledTimes(2);
    expect(getByTestId("editor-status-message")).toHaveTextContent(
      "Loaded 2 PDFs into the workspace."
    );
  });

  it("opens the file drawer and selects pages from one source file", async () => {
    const { findAllByTestId, getByTestId } = render(() => <Editor />);

    selectFile("editor-upload-input", makeFile("brief.pdf"));
    await findAllByTestId("editor-page-tile");
    expect(getByTestId("editor-files-button")).toBeEnabled();
    expect(getByTestId("editor-files-button")).toHaveAttribute("aria-label", "Open 1 file");
    fireEvent.click(getByTestId("editor-files-button"));
    await waitFor(() => expect(getByTestId("editor-files-dialog")).toHaveAttribute("open"));
    expect(await findAllByTestId("editor-file-item")).toHaveLength(1);
    fireEvent.click(getByTestId("editor-files-close-button"));
    await waitFor(() => expect(getByTestId("editor-files-dialog")).not.toHaveAttribute("open"));

    selectFile("editor-add-pdf-input", makeFile("appendix.pdf"));
    await waitFor(async () => expect(await findAllByTestId("editor-page-tile")).toHaveLength(6));

    expect(getByTestId("editor-files-button")).toBeEnabled();
    expect(getByTestId("editor-files-dialog")).not.toHaveAttribute("open");
    fireEvent.click(getByTestId("editor-files-button"));

    await waitFor(() => expect(getByTestId("editor-files-dialog")).toHaveAttribute("open"));
    const fileItems = await findAllByTestId("editor-file-item");
    expect(fileItems).toHaveLength(2);

    fireEvent.click(fileItems[1]);

    await waitFor(async () => {
      const tiles = await findAllByTestId("editor-page-tile");
      expect(tiles.slice(0, 3).every((tile) => tile.dataset.selected === "false")).toBe(true);
      expect(tiles.slice(3).every((tile) => tile.dataset.selected === "true")).toBe(true);
    });
    expect(getByTestId("editor-files-dialog")).not.toHaveAttribute("open");
    expect(getByTestId("editor-status-message")).toHaveTextContent(
      "Selected 3 pages from appendix.pdf."
    );
  });

  it("keeps selection actions disabled until they have usable input", async () => {
    const { getByTestId, findAllByTestId } = render(() => <Editor />);

    selectFile("editor-upload-input", makeFile());
    await findAllByTestId("editor-page-tile");

    const rotateButtons = await findAllByTestId("editor-page-rotate-button");
    expect(rotateButtons.every((button) => (button as HTMLButtonElement).disabled)).toBe(false);
    expect(
      (await findAllByTestId("editor-page-delete-button")).every(
        (button) => !(button as HTMLButtonElement).disabled
      )
    ).toBe(true);
    expect(getByTestId("editor-edit-menu-button")).toBeEnabled();
    expect(getByTestId("editor-download-options-button")).toBeEnabled();

    await openEditMenu(getByTestId);
    expect(getByTestId("editor-clear-selection-button")).toHaveAttribute("aria-disabled", "true");
    expect(getByTestId("editor-rotate-button")).toHaveAttribute("aria-disabled", "true");
    expect(getByTestId("editor-delete-button")).toHaveAttribute("aria-disabled", "true");
    expect(getByTestId("editor-select-all-button")).toBeEnabled();
    expect(getByTestId("editor-download-button")).toBeEnabled();
    expect(getByTestId("editor-edit-menu-button")).toHaveAttribute("aria-expanded", "true");

    await openDownloadMenu(getByTestId);
    expect(getByTestId("editor-export-images-button")).toBeEnabled();
    expect(getByTestId("editor-export-images-button")).toHaveTextContent("Export PNG images");
    expect(getByTestId("editor-export-images-button")).toHaveAccessibleName(
      "Export pages as PNG images in a ZIP archive"
    );
    expect(getByTestId("editor-compress-button")).toBeEnabled();

    fireEvent.click((await findAllByTestId("editor-page-tile"))[0]);
    await waitFor(() => expect(rotateButtons[0]).toBeEnabled());

    await openEditMenu(getByTestId);
    expect(getByTestId("editor-clear-selection-button")).toBeEnabled();
    expect(getByTestId("editor-rotate-button")).toBeEnabled();
    expect(getByTestId("editor-delete-button")).toBeEnabled();
    expect(getByTestId("editor-download-button")).toHaveTextContent("Download PDF");
    await openDownloadMenu(getByTestId);
    expect(getByTestId("editor-export-images-button")).toBeEnabled();
    expect(getByTestId("editor-compress-button")).toHaveAttribute("aria-disabled", "true");
  });

  it("uses one clear control after every page is selected", async () => {
    const { getByTestId, findAllByTestId } = render(() => <Editor />);

    selectFile("editor-upload-input", makeFile());
    await findAllByTestId("editor-page-tile");

    await openEditMenu(getByTestId);
    expect(getByTestId("editor-select-all-button")).toHaveTextContent("Select all pages");
    expect(getByTestId("editor-select-all-button")).toHaveAttribute(
      "aria-label",
      "Select all pages"
    );

    fireEvent.click(getByTestId("editor-select-all-button"));

    await openEditMenu(getByTestId);
    await waitFor(() => {
      expect(getByTestId("editor-select-all-button")).toHaveAccessibleName("All pages selected");
      expect(getByTestId("editor-select-all-button")).toHaveAttribute("aria-disabled", "true");
      expect(getByTestId("editor-clear-selection-button")).toHaveTextContent("Clear selection");
      expect(getByTestId("editor-clear-selection-button")).toHaveAttribute(
        "aria-label",
        "Clear page selection"
      );
    });

    fireEvent.click(getByTestId("editor-clear-selection-button"));

    await openEditMenu(getByTestId);
    await waitFor(() =>
      expect(getByTestId("editor-select-all-button")).toHaveTextContent("Select all pages")
    );
  });

  it("prompts for a password and unlocks a protected PDF", async () => {
    pdfServiceMocks.loadPDF.mockReturnValue(
      Effect.fail(new PDFPasswordRequiredError(makeFile(), "needs-password"))
    );
    promptForPassword.mockResolvedValue("623");

    const { findAllByTestId } = render(() => <Editor />);

    selectFile("editor-upload-input", makeFile("protected.pdf"));

    await waitFor(() => expect(promptForPassword).toHaveBeenCalledWith("protected.pdf", false));
    const tiles = await findAllByTestId("editor-page-tile");
    expect(tiles).toHaveLength(3);
    expect(pdfServiceMocks.loadPDFWithPassword).toHaveBeenCalledWith(expect.any(File), "623");
  });

  it("stays on the uploader when the password prompt is cancelled", async () => {
    pdfServiceMocks.loadPDF.mockReturnValue(
      Effect.fail(new PDFPasswordRequiredError(makeFile(), "needs-password"))
    );
    promptForPassword.mockResolvedValue(null);

    const { getByTestId } = render(() => <Editor />);

    selectFile("editor-upload-input", makeFile("protected.pdf"));

    await waitFor(() => expect(promptForPassword).toHaveBeenCalled());
    expect(pdfServiceMocks.loadPDFWithPassword).not.toHaveBeenCalled();
    expect(getByTestId("editor-upload-dropzone")).toBeInTheDocument();
  });

  it("re-prompts when the password is wrong", async () => {
    pdfServiceMocks.loadPDF.mockReturnValue(
      Effect.fail(new PDFPasswordRequiredError(makeFile(), "needs-password"))
    );
    pdfServiceMocks.loadPDFWithPassword.mockReturnValueOnce(
      Effect.fail(new PDFPasswordRequiredError(makeFile(), "wrong-password"))
    );
    promptForPassword.mockResolvedValueOnce("bad").mockResolvedValueOnce("good");

    const { getByTestId } = render(() => <Editor />);

    selectFile("editor-upload-input", makeFile("protected.pdf"));

    await waitFor(() => expect(promptForPassword).toHaveBeenCalledTimes(2));
    expect(promptForPassword).toHaveBeenLastCalledWith("protected.pdf", true);
    await waitFor(() => expect(getByTestId("editor-page-grid")).toBeInTheDocument());
  });

  it("selects all pages and reports the rotation", async () => {
    const { getByTestId, findAllByTestId, findByTestId } = render(() => <Editor />);

    selectFile("editor-upload-input", makeFile());
    const tiles = await findAllByTestId("editor-page-tile");

    await openEditMenu(getByTestId);
    fireEvent.click(getByTestId("editor-select-all-button"));

    await waitFor(() =>
      expect(tiles.map((tile) => tile.dataset.selected)).toEqual(["true", "true", "true"])
    );

    await openEditMenu(getByTestId);
    fireEvent.click(getByTestId("editor-rotate-button"));
    const status = await findByTestId("editor-status-message");
    await waitFor(() => expect(status).toHaveTextContent("Rotated 3 selected pages."));
  });

  it("marks selected pages for deletion before export", async () => {
    const { getByTestId, findAllByTestId } = render(() => <Editor />);

    selectFile("editor-upload-input", makeFile());
    const tiles = await findAllByTestId("editor-page-tile");

    await openEditMenu(getByTestId);
    fireEvent.click(getByTestId("editor-select-all-button"));
    await waitFor(() => expect(tiles[0].dataset.selected).toBe("true"));

    await openEditMenu(getByTestId);
    expect(getByTestId("editor-delete-button")).toHaveTextContent("Mark for deletion");
    fireEvent.click(getByTestId("editor-delete-button"));

    await waitFor(() =>
      expect(tiles.map((tile) => tile.dataset.markedForDeletion)).toEqual(["true", "true", "true"])
    );
    expect(getByTestId("editor-status-bar")).toHaveTextContent("3 pages (0 active)");
    expect(getByTestId("editor-download-button")).toBeDisabled();
    await openDownloadMenu(getByTestId);
    expect(getByTestId("editor-export-images-button")).toHaveAttribute("aria-disabled", "true");
    expect(getByTestId("editor-export-images-button")).toHaveTextContent("Export PNG images");
    await openEditMenu(getByTestId);
    expect(getByTestId("editor-delete-button")).toHaveTextContent("Restore");
    expect(getByTestId("editor-delete-button")).toHaveAttribute(
      "aria-label",
      "Restore selected pages"
    );

    fireEvent.click(getByTestId("editor-delete-button"));

    await openEditMenu(getByTestId);
    await waitFor(() => {
      expect(tiles.map((tile) => tile.dataset.markedForDeletion)).toEqual([
        "false",
        "false",
        "false",
      ]);
      expect(getByTestId("editor-delete-button")).toHaveTextContent("Mark for deletion");
    });
  });

  it("reorders a page with the keyboard alternative", async () => {
    const { findAllByTestId, getByTestId } = render(() => <Editor />);

    selectFile("editor-upload-input", makeFile());
    const tiles = await findAllByTestId("editor-page-tile");

    fireEvent.keyDown(tiles[2], { altKey: true, key: "ArrowLeft" });

    await waitFor(() => {
      const reorderedTiles = document.querySelectorAll('[data-testid="editor-page-tile"]');
      expect(reorderedTiles[1]).toHaveAttribute("data-source-page", "3");
    });
    expect(getByTestId("editor-status-message")).toHaveTextContent("Moved page 3 to position 2.");
  });

  it("rotates and marks a page from its direct controls", async () => {
    const { getByTestId, findAllByTestId } = render(() => <Editor />);

    selectFile("editor-upload-input", makeFile());
    const tiles = await findAllByTestId("editor-page-tile");

    const rotateButtons = await findAllByTestId("editor-page-rotate-button");
    fireEvent.click(rotateButtons[1]);

    await waitFor(() =>
      expect(getByTestId("editor-status-message")).toHaveTextContent("Rotated page 2.")
    );

    const deleteButtons = await findAllByTestId("editor-page-delete-button");
    fireEvent.click(deleteButtons[1]);

    await waitFor(() => {
      expect(tiles[1]).toHaveAttribute("data-marked-for-deletion", "true");
      expect(tiles[1]).toHaveAttribute("data-selected", "false");
      expect(deleteButtons[1]).toHaveAttribute("aria-label", "Restore page 2 from deletion");
    });

    fireEvent.click(deleteButtons[1]);

    await waitFor(() => {
      expect(tiles[1]).toHaveAttribute("data-marked-for-deletion", "false");
    });
  });

  it("labels exports by active selected pages", async () => {
    const { getByTestId, findAllByTestId } = render(() => <Editor />);

    selectFile("editor-upload-input", makeFile());
    const tiles = await findAllByTestId("editor-page-tile");
    const deleteButtons = await findAllByTestId("editor-page-delete-button");

    fireEvent.click(tiles[0]);
    fireEvent.click(deleteButtons[0]);
    fireEvent.click(tiles[1]);

    await waitFor(() => {
      expect(getByTestId("editor-selection-title")).toHaveTextContent("2 selected · 1 exportable");
      expect(getByTestId("editor-download-button")).toHaveTextContent("Download PDF");
      expect(getByTestId("editor-download-button")).toHaveAccessibleName(
        "Download a PDF with 1 selected active page"
      );
    });

    await openEditMenu(getByTestId);
    expect(getByTestId("editor-delete-button")).toHaveTextContent("Mark for deletion");
    fireEvent.click(getByTestId("editor-delete-button"));

    await openEditMenu(getByTestId);
    await waitFor(() => {
      expect(tiles[0]).toHaveAttribute("data-marked-for-deletion", "true");
      expect(tiles[1]).toHaveAttribute("data-marked-for-deletion", "true");
      expect(getByTestId("editor-selection-title")).toHaveTextContent("2 selected · 0 exportable");
      expect(getByTestId("editor-delete-button")).toHaveTextContent("Restore");
    });
  });

  it("toggles a page selection by clicking its tile", async () => {
    const { findAllByTestId } = render(() => <Editor />);

    selectFile("editor-upload-input", makeFile());
    const tiles = await findAllByTestId("editor-page-tile");

    fireEvent.click(tiles[0]);
    await waitFor(() => expect(tiles[0].dataset.selected).toBe("true"));

    fireEvent.click(tiles[0]);
    await waitFor(() => expect(tiles[0].dataset.selected).toBe("false"));
  });

  it("clears selection from the empty grid or with Escape", async () => {
    const { getByTestId, findAllByTestId } = render(() => <Editor />);

    selectFile("editor-upload-input", makeFile());
    const tiles = await findAllByTestId("editor-page-tile");

    fireEvent.click(tiles[0]);
    await waitFor(() => expect(tiles[0].dataset.selected).toBe("true"));

    fireEvent.click(getByTestId("editor-page-grid"));
    await waitFor(() => expect(tiles[0].dataset.selected).toBe("false"));

    fireEvent.click(tiles[1]);
    await waitFor(() => expect(tiles[1].dataset.selected).toBe("true"));
    fireEvent.keyDown(tiles[1], { key: "Escape" });
    await waitFor(() => expect(tiles[1].dataset.selected).toBe("false"));
  });

  it("exports the selected pages through the operations service", async () => {
    const { getByTestId, findAllByTestId } = render(() => <Editor />);

    selectFile("editor-upload-input", makeFile());
    const tiles = await findAllByTestId("editor-page-tile");

    fireEvent.click(tiles[2]);
    await waitFor(() => expect(tiles[2].dataset.selected).toBe("true"));

    fireEvent.click(getByTestId("editor-download-button"));

    await waitFor(() => expect(downloadPDF).toHaveBeenCalledTimes(1));
    expect(pdfOperationsMocks.buildPDF).toHaveBeenCalledTimes(1);
    expect(pdfOperationsMocks.buildPDF.mock.calls[0][1].selectedIndices).toEqual([2]);
  });

  it("downloads a PDF built from the active pages", async () => {
    const { getByTestId } = render(() => <Editor />);

    selectFile("editor-upload-input", makeFile());
    await waitFor(() => expect(getByTestId("editor-page-grid")).toBeInTheDocument());

    fireEvent.click(getByTestId("editor-download-button"));

    await waitFor(() => expect(downloadPDF).toHaveBeenCalledTimes(1));
    expect(pdfOperationsMocks.buildPDF).toHaveBeenCalledTimes(1);
  });

  it("exports selected pages as PNG images", async () => {
    const { getByTestId, findAllByTestId } = render(() => <Editor />);

    selectFile("editor-upload-input", makeFile());
    const tiles = await findAllByTestId("editor-page-tile");

    fireEvent.click(tiles[1]);
    await waitFor(() => expect(tiles[1].dataset.selected).toBe("true"));
    await openDownloadMenu(getByTestId);
    fireEvent.click(getByTestId("editor-export-images-button"));

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
    const { getByTestId } = render(() => <Editor />);

    const file = makeFile("source.pdf");
    selectFile("editor-upload-input", file);
    await waitFor(() => expect(getByTestId("editor-page-grid")).toBeInTheDocument());
    await openDownloadMenu(getByTestId);
    fireEvent.click(getByTestId("editor-compress-button"));

    await waitFor(() => expect(downloadPDF).toHaveBeenCalledTimes(1));
    expect(pdfCompressionMocks.compressPDF).toHaveBeenCalledTimes(1);
    expect(pdfCompressionMocks.compressPDF.mock.calls[0][0]).toBe(file);
    expect(pdfCompressionMocks.compressPDF.mock.calls[0][1]).toBeUndefined();
    expect(getByTestId("editor-toast")).toHaveTextContent("Compressed 10 B to 2 B.");
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

    const { getByTestId } = render(() => <Editor />);
    selectFile("editor-upload-input", makeFile());
    await waitFor(() => expect(getByTestId("editor-page-grid")).toBeInTheDocument());

    await openDownloadMenu(getByTestId);
    fireEvent.click(getByTestId("editor-compress-button"));

    await waitFor(() =>
      expect(getByTestId("editor-toast")).toHaveTextContent(
        "No smaller file was available. Downloaded the current PDF."
      )
    );
    expect(downloadPDF).toHaveBeenCalledTimes(1);
  });

  it("shows a failure toast when compression fails", async () => {
    pdfCompressionMocks.compressPDF.mockReturnValue(Effect.fail(new Error("compress failed")));

    const { getByTestId } = render(() => <Editor />);
    selectFile("editor-upload-input", makeFile());
    await waitFor(() => expect(getByTestId("editor-page-grid")).toBeInTheDocument());

    await openDownloadMenu(getByTestId);
    fireEvent.click(getByTestId("editor-compress-button"));

    await waitFor(() => expectLastToast("Failed to compress the PDF."));
    expect(downloadPDF).not.toHaveBeenCalled();
  });

  it("shows a failure toast when building the output fails", async () => {
    pdfOperationsMocks.buildPDF.mockReturnValue(Effect.fail(new Error("build failed")));

    const { getByTestId } = render(() => <Editor />);

    selectFile("editor-upload-input", makeFile());
    await waitFor(() => expect(getByTestId("editor-page-grid")).toBeInTheDocument());

    fireEvent.click(getByTestId("editor-download-button"));

    await waitFor(() => expectLastToast("Failed to build the PDF."));
    expect(downloadPDF).not.toHaveBeenCalled();
  });
});
