import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFPasswordRequiredError } from "@/types/interfaces";

const pdfServiceMocks = vi.hoisted(() => ({
  loadPDF: vi.fn(),
  loadPDFWithPassword: vi.fn(),
  getPageCount: vi.fn(),
  renderPage: vi.fn(),
  reset: vi.fn(),
}));

const pdfOperationsMocks = vi.hoisted(() => ({
  buildPDF: vi.fn(),
  buildPDFFromSubset: vi.fn(),
  clearCache: vi.fn(),
}));

const promptForPassword = vi.hoisted(() => vi.fn());
const downloadPDF = vi.hoisted(() => vi.fn());

vi.mock("@/services/pdf-service", () => ({ pdfService: pdfServiceMocks }));
vi.mock("@/services/pdf-operations-service", () => ({
  pdfOperationsService: pdfOperationsMocks,
}));
vi.mock("@/utils/password-prompt", () => ({ promptForPassword }));
vi.mock("@/utils/download", () => ({ downloadPDF }));

import Editor from "../Editor";

const makeFile = (name = "doc.pdf") => new File(["%PDF-1.4"], name, { type: "application/pdf" });

function selectFile(testid: string, file: File) {
  const input = document.querySelector<HTMLInputElement>(`[data-testid="${testid}"]`);
  if (!input) throw new Error(`missing input ${testid}`);
  Object.defineProperty(input, "files", { value: [file] });
  fireEvent(input, new Event("change", { bubbles: true }));
}

// Toasts accumulate until their 3s dismissal timer fires, so assert on the newest one.
function expectLastToast(text: string) {
  const toasts = Array.from(document.querySelectorAll('[data-testid="editor-toast"]'));
  expect(toasts.at(-1)).toHaveTextContent(text);
}

describe("Editor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pdfServiceMocks.getPageCount.mockReturnValue(3);
    pdfServiceMocks.loadPDF.mockResolvedValue(undefined);
    pdfServiceMocks.loadPDFWithPassword.mockResolvedValue(undefined);
    pdfOperationsMocks.buildPDF.mockResolvedValue({
      data: new Uint8Array([1, 2, 3]),
      suggestedFileName: "interleaf-output.pdf",
    });
    pdfOperationsMocks.buildPDFFromSubset.mockResolvedValue({
      data: new Uint8Array([1]),
      suggestedFileName: "interleaf-extract.pdf",
    });
  });

  it("renders the upload dropzone before any file is loaded", () => {
    const { getByTestId, queryByTestId } = render(() => <Editor />);

    expect(getByTestId("editor-upload-dropzone")).toBeInTheDocument();
    expect(queryByTestId("editor-page-grid")).not.toBeInTheDocument();
  });

  it("rejects non-PDF files with an error toast", async () => {
    const { findByTestId, queryByTestId } = render(() => <Editor />);

    selectFile("editor-upload-input", new File(["text"], "notes.txt", { type: "text/plain" }));

    const toast = await findByTestId("editor-toast");
    expect(toast).toHaveTextContent("Please upload a valid PDF file.");
    expect(pdfServiceMocks.loadPDF).not.toHaveBeenCalled();
    expect(queryByTestId("editor-page-grid")).not.toBeInTheDocument();
  });

  it("loads a valid PDF into the page grid", async () => {
    const { getByTestId, findAllByTestId } = render(() => <Editor />);

    selectFile("editor-upload-input", makeFile());

    await waitFor(() => expect(getByTestId("editor-page-grid")).toBeInTheDocument());
    const tiles = await findAllByTestId("editor-page-tile");
    expect(tiles).toHaveLength(3);
    expectLastToast("doc.pdf loaded with 3 pages.");
    expect(pdfServiceMocks.reset).toHaveBeenCalled();
  });

  it("prompts for a password and unlocks a protected PDF", async () => {
    pdfServiceMocks.loadPDF.mockRejectedValue(
      new PDFPasswordRequiredError(makeFile(), "needs-password")
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
    pdfServiceMocks.loadPDF.mockRejectedValue(
      new PDFPasswordRequiredError(makeFile(), "needs-password")
    );
    promptForPassword.mockResolvedValue(null);

    const { getByTestId } = render(() => <Editor />);

    selectFile("editor-upload-input", makeFile("protected.pdf"));

    await waitFor(() => expect(promptForPassword).toHaveBeenCalled());
    expect(pdfServiceMocks.loadPDFWithPassword).not.toHaveBeenCalled();
    expect(getByTestId("editor-upload-dropzone")).toBeInTheDocument();
  });

  it("re-prompts when the password is wrong", async () => {
    pdfServiceMocks.loadPDF.mockRejectedValue(
      new PDFPasswordRequiredError(makeFile(), "needs-password")
    );
    pdfServiceMocks.loadPDFWithPassword.mockRejectedValueOnce(
      new PDFPasswordRequiredError(makeFile(), "wrong-password")
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

    fireEvent.click(getByTestId("editor-select-all-button"));

    await waitFor(() =>
      expect(tiles.map((tile) => tile.dataset.selected)).toEqual(["true", "true", "true"])
    );

    fireEvent.click(getByTestId("editor-rotate-button"));
    const status = await findByTestId("editor-status-message");
    await waitFor(() => expect(status).toHaveTextContent("Rotated 3 selected pages."));
  });

  it("marks selected pages for deletion before export", async () => {
    const { getByTestId, findAllByTestId } = render(() => <Editor />);

    selectFile("editor-upload-input", makeFile());
    const tiles = await findAllByTestId("editor-page-tile");

    fireEvent.click(getByTestId("editor-select-all-button"));
    await waitFor(() => expect(tiles[0].dataset.selected).toBe("true"));

    fireEvent.click(getByTestId("editor-delete-button"));

    await waitFor(() =>
      expect(tiles.map((tile) => tile.dataset.markedForDeletion)).toEqual(["true", "true", "true"])
    );
    expect(getByTestId("editor-status-bar")).toHaveTextContent("3 pages (0 active)");
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

  it("extracts the selected pages through the operations service", async () => {
    const { getByTestId, findAllByTestId } = render(() => <Editor />);

    selectFile("editor-upload-input", makeFile());
    const tiles = await findAllByTestId("editor-page-tile");

    fireEvent.click(tiles[2]);
    await waitFor(() => expect(tiles[2].dataset.selected).toBe("true"));

    fireEvent.click(getByTestId("editor-extract-button"));

    await waitFor(() => expect(downloadPDF).toHaveBeenCalledTimes(1));
    expect(pdfOperationsMocks.buildPDFFromSubset).toHaveBeenCalledTimes(1);
    expect(pdfOperationsMocks.buildPDFFromSubset.mock.calls[0][1]).toEqual([2]);
    expectLastToast("Extracted PDF download started.");
  });

  it("downloads a PDF built from the active pages", async () => {
    const { getByTestId } = render(() => <Editor />);

    selectFile("editor-upload-input", makeFile());
    await waitFor(() => expect(getByTestId("editor-page-grid")).toBeInTheDocument());

    fireEvent.click(getByTestId("editor-download-button"));

    await waitFor(() => expect(downloadPDF).toHaveBeenCalledTimes(1));
    expect(pdfOperationsMocks.buildPDF).toHaveBeenCalledTimes(1);
    expectLastToast("Download started.");
  });

  it("shows a failure toast when building the output fails", async () => {
    pdfOperationsMocks.buildPDF.mockRejectedValue(new Error("build failed"));

    const { getByTestId } = render(() => <Editor />);

    selectFile("editor-upload-input", makeFile());
    await waitFor(() => expect(getByTestId("editor-page-grid")).toBeInTheDocument());

    fireEvent.click(getByTestId("editor-download-button"));

    await waitFor(() => expectLastToast("Failed to build the PDF."));
    expect(downloadPDF).not.toHaveBeenCalled();
  });
});
