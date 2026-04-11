import type { NoteRecord } from "@/types/note";
import { deriveSlug } from "@/utils/deriveSlug";

export type NoteExportFormat = "txt" | "md";

export function formatDateStamp(timestamp: number) {
  const date = new Date(timestamp);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function getExportFilename(note: NoteRecord, format: NoteExportFormat) {
  return `${formatDateStamp(note.createdAt)}-${deriveSlug(note.body)}.${format}`;
}

export function getDedupedExportFilename(
  note: NoteRecord,
  format: NoteExportFormat,
  usedFilenames: Set<string>
) {
  const baseName = `${formatDateStamp(note.createdAt)}-${deriveSlug(note.body)}`;

  if (!usedFilenames.has(`${baseName}.${format}`)) {
    const filename = `${baseName}.${format}`;
    usedFilenames.add(filename);
    return filename;
  }

  let count = 2;
  let filename = `${baseName}-${count}.${format}`;

  while (usedFilenames.has(filename)) {
    count += 1;
    filename = `${baseName}-${count}.${format}`;
  }

  usedFilenames.add(filename);

  return filename;
}

export function exportNote(note: NoteRecord, format: NoteExportFormat) {
  const blob = new Blob([note.body], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = getExportFilename(note, format);
  document.body.append(link);
  link.click();
  link.remove();

  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
