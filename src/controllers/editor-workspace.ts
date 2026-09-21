import type { PageState } from "../types/interfaces";

export interface WorkspaceFile {
  readonly file: File;
  readonly pageCount: number;
  readonly pageIndices: readonly number[];
}

/**
 * Build the source-file index used by the workspace file drawer and selection
 * actions. File identity is intentional: two files with the same name remain
 * separate sources.
 */
export function groupWorkspaceFiles(
  pages: readonly Pick<PageState, "sourceFile">[]
): WorkspaceFile[] {
  const groups = new Map<File, { file: File; pageIndices: number[] }>();

  pages.forEach((page, index) => {
    const group = groups.get(page.sourceFile);
    if (group) {
      group.pageIndices.push(index);
      return;
    }

    groups.set(page.sourceFile, {
      file: page.sourceFile,
      pageIndices: [index],
    });
  });

  return Array.from(groups.values(), ({ file, pageIndices }) => ({
    file,
    pageCount: pageIndices.length,
    pageIndices,
  }));
}
