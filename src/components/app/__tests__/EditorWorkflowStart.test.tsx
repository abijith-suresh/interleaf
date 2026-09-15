import { render } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import EditorWorkflowStart from "../EditorWorkflowStart";

describe("EditorWorkflowStart", () => {
  it("makes the current editor workflows discoverable without advertising future tools", () => {
    const { getByTestId, getByRole } = render(() => (
      <EditorWorkflowStart
        busy={false}
        statusMessage="Drop a PDF to begin"
        onFileSelected={vi.fn()}
      />
    ));

    const shell = getByTestId("editor-workflow-shell");

    expect(getByRole("heading", { name: "Make the pages behave." })).toBeInTheDocument();
    expect(getByRole("heading", { name: "Edit and organize" })).toBeInTheDocument();
    expect(getByTestId("editor-workflow-task-arrange")).toHaveAttribute(
      "href",
      "#editor-upload-dropzone"
    );
    expect(getByTestId("editor-workflow-task-combine")).toHaveTextContent("Combine PDFs");
    expect(getByTestId("editor-workflow-task-extract")).toHaveTextContent("Extract pages");
    expect(getByTestId("editor-workflow-task-unlock")).toHaveTextContent("Unlock a protected PDF");
    expect(getByTestId("editor-upload-dropzone")).toBeInTheDocument();
    expect(shell).not.toHaveTextContent(/convert|compress|coming soon/i);
  });
});
