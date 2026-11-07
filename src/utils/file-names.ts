/** A file name without its .pdf extension, or "interleaf" when nothing is left. */
export function fileStem(fileName: string): string {
  return fileName.replace(/\.pdf$/i, "").trim() || "interleaf";
}
