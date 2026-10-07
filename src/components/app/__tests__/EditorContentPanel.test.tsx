import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import type { PDFRuntime } from "../../../services/pdf-runtime";
import type { PDFPageContent } from "../../../services/pdfium/protocol";
import type { PageState } from "../../../types/interfaces";
import EditorContentPanel from "../EditorContentPanel";

const page: PageState = {
  id: "page",
  sourceFile: new File(["pdf"], "doc.pdf"),
  sourcePageNumber: 1,
  rotation: 0,
  markedForDeletion: false,
};
const content: PDFPageContent = {
  width: 300,
  height: 400,
  fields: [],
  text: [
    { index: 0, text: "Original phrase", fontSize: 12, editable: true },
    {
      index: 1,
      text: "Slanted",
      fontSize: 12,
      editable: false,
      reason: "Slanted text cannot be replaced.",
    },
  ],
};

function setup() {
  const runPromise = vi.fn().mockResolvedValueOnce(content).mockResolvedValue(undefined);
  const changed = vi.fn(),
    busy = vi.fn();
  render(() => (
    <EditorContentPanel
      page={page}
      runtime={{ runPromise } as unknown as PDFRuntime}
      onChange={changed}
      onBusy={busy}
    />
  ));
  return { runPromise, changed, busy };
}

describe("Page content controls", () => {
  it("shows font fallback, applies added text, and marks the source changed", async () => {
    const { changed, busy } = setup();
    await screen.findByLabelText("Text");
    expect(screen.getByText(/Helvetica fallback/)).toBeInTheDocument();
    fireEvent.input(screen.getByLabelText("Text"), { target: { value: "Added" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Add text" }).at(-1) as HTMLElement);
    await waitFor(() => expect(changed).toHaveBeenCalledWith(page.sourceFile));
    expect(busy.mock.calls).toEqual([[true], [false]]);
    expect(screen.getByRole("status")).toHaveTextContent("Change applied");
  });

  it("selects supported runs and disables unsupported text", async () => {
    setup();
    await screen.findByLabelText("Text");
    fireEvent.click(screen.getByRole("button", { name: "Edit text" }));
    expect(screen.getByRole("button", { name: "Slanted" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Original phrase" }));
    expect(screen.getByLabelText("Text")).toHaveValue("Original phrase");
    expect(screen.getByRole("button", { name: "Replace text" })).toBeEnabled();
  });

  it("reports engine errors without marking the file changed", async () => {
    const { runPromise, changed } = setup();
    runPromise.mockRejectedValueOnce(new Error("The text is too wide for this area."));
    await screen.findByLabelText("Text");
    fireEvent.input(screen.getByLabelText("Text"), { target: { value: "Overflow" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Add text" }).at(-1) as HTMLElement);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("too wide"));
    expect(changed).not.toHaveBeenCalled();
  });
});
