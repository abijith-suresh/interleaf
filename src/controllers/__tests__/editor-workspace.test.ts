import { describe, expect, it } from "vitest";
import { groupWorkspaceFiles } from "../editor-workspace";

const page = (sourceFile: File) => ({ sourceFile });

describe("groupWorkspaceFiles", () => {
  it("groups pages by source identity in first-seen order", () => {
    const first = new File(["first"], "report.pdf", { type: "application/pdf" });
    const second = new File(["second"], "appendix.pdf", { type: "application/pdf" });

    expect(groupWorkspaceFiles([page(first), page(second), page(first)])).toEqual([
      { file: first, pageCount: 2, pageIndices: [0, 2] },
      { file: second, pageCount: 1, pageIndices: [1] },
    ]);
  });

  it("keeps distinct File objects separate even when their names match", () => {
    const first = new File(["first"], "report.pdf", { type: "application/pdf" });
    const second = new File(["second"], "report.pdf", { type: "application/pdf" });

    expect(groupWorkspaceFiles([page(first), page(second)])).toEqual([
      { file: first, pageCount: 1, pageIndices: [0] },
      { file: second, pageCount: 1, pageIndices: [1] },
    ]);
  });

  it("returns no sources for an empty workspace", () => {
    expect(groupWorkspaceFiles([])).toEqual([]);
  });
});
