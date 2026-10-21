import type { PageState } from "../types/interfaces";

export interface WorkspaceFile {
  readonly file: File;
  readonly pageCount: number;
  readonly pageIndices: readonly number[];
}

/**
 * Build the source-file index used by the workspace file drawer and selection
 * actions. Derived page files retain their original source group. File identity
 * is intentional: two uploaded files with the same name remain separate sources.
 */
export function groupWorkspaceFiles(
  pages: readonly Pick<PageState, "sourceFile" | "sourceOrigin">[]
): WorkspaceFile[] {
  const groups = new Map<File, { file: File; pageIndices: number[] }>();

  pages.forEach((page, index) => {
    const source = page.sourceOrigin ?? page.sourceFile;
    const group = groups.get(source);
    if (group) {
      group.pageIndices.push(index);
      return;
    }

    groups.set(source, {
      file: source,
      pageIndices: [index],
    });
  });

  return Array.from(groups.values(), ({ file, pageIndices }) => ({
    file,
    pageCount: pageIndices.length,
    pageIndices,
  }));
}
