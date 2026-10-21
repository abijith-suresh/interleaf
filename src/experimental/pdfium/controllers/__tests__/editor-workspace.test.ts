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

  it("groups independent page copies with their origin in first-seen order", () => {
    const source = new File(["original"], "report.pdf", { type: "application/pdf" });
    const other = new File(["other"], "appendix.pdf", { type: "application/pdf" });
    const copy = new File(["copy"], "report-copy.pdf", { type: "application/pdf" });
    const secondCopy = new File(["copy two"], "report-copy-2.pdf", { type: "application/pdf" });

    expect(
      groupWorkspaceFiles([
        { sourceFile: copy, sourceOrigin: source },
        page(other),
        page(source),
        { sourceFile: secondCopy, sourceOrigin: source },
      ])
    ).toEqual([
      { file: source, pageCount: 3, pageIndices: [0, 2, 3] },
      { file: other, pageCount: 1, pageIndices: [1] },
    ]);
  });

  it("keeps origins separate by identity even when only their copies remain", () => {
    const first = new File(["first"], "report.pdf", { type: "application/pdf" });
    const second = new File(["second"], "report.pdf", { type: "application/pdf" });
    const firstCopy = new File(["copy one"], "report-copy.pdf", { type: "application/pdf" });
    const secondCopy = new File(["copy two"], "report-copy.pdf", { type: "application/pdf" });

    expect(
      groupWorkspaceFiles([
        { sourceFile: firstCopy, sourceOrigin: first },
        { sourceFile: secondCopy, sourceOrigin: second },
      ])
    ).toEqual([
      { file: first, pageCount: 1, pageIndices: [0] },
      { file: second, pageCount: 1, pageIndices: [1] },
    ]);
  });

  it("returns no sources for an empty workspace", () => {
    expect(groupWorkspaceFiles([])).toEqual([]);
  });
});
