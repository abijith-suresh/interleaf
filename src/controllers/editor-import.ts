import { IMAGES_TO_PDF_FILENAME } from "../constants";
import { getSupportedFileKind } from "../utils/file-types";

export type UploadGroup =
  | {
      readonly kind: "pdf";
      readonly files: File[];
    }
  | {
      readonly kind: "images";
      readonly files: File[];
      readonly outputFileName: string;
    };

interface MutableUploadGroup {
  kind: UploadGroup["kind"];
  files: File[];
}

/**
 * Turn the user's ordered file selection into the PDF inputs the workspace
 * loader needs. Adjacent images stay together; PDFs remain individual inputs.
 */
export function planUploadGroups(files: readonly File[]): UploadGroup[] {
  const groups: MutableUploadGroup[] = [];

  for (const file of files) {
    const kind = getSupportedFileKind(file);
    const groupKind = kind === "pdf" ? "pdf" : kind === "png" || kind === "jpeg" ? "images" : null;
    if (!groupKind) continue;

    const previousGroup = groups.at(-1);
    if (previousGroup?.kind === "images" && groupKind === "images") {
      previousGroup.files.push(file);
    } else {
      groups.push({ kind: groupKind, files: [file] });
    }
  }

  const imageGroupCount = groups.filter((group) => group.kind === "images").length;
  let imageGroupIndex = 0;

  return groups.map((group) => {
    if (group.kind === "pdf") {
      return { kind: "pdf", files: group.files };
    }

    imageGroupIndex += 1;
    return {
      kind: "images",
      files: group.files,
      outputFileName:
        imageGroupCount > 1
          ? `${IMAGES_TO_PDF_FILENAME.replace(/\.pdf$/i, "")}-${imageGroupIndex}.pdf`
          : IMAGES_TO_PDF_FILENAME,
    };
  });
}

/** A selected file that did not open, with the reason shown to the user. */
export type SkippedFile =
  | { readonly kind: "invalid-pdf" | "locked" | "unsupported"; readonly name: string }
  | { readonly kind: "load-error"; readonly name: string; readonly message: string }
  | { readonly kind: "image-error"; readonly count: number; readonly message: string };

const LISTED_SKIPS = 2;

function sentence(text: string): string {
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

export function describeSkippedFile(skipped: SkippedFile): string {
  switch (skipped.kind) {
    case "invalid-pdf":
      return `${skipped.name} isn't a valid PDF.`;
    case "locked":
      return `${skipped.name} is still locked.`;
    case "unsupported":
      return `${skipped.name} isn't a PDF, PNG, or JPEG file.`;
    case "load-error":
      return skipped.message
        ? sentence(`Failed to load ${skipped.name}: ${skipped.message}`)
        : `Failed to load ${skipped.name}.`;
    case "image-error":
      return sentence(skipped.message);
  }
}

function skippedCount(skipped: SkippedFile): number {
  return skipped.kind === "image-error" ? skipped.count : 1;
}

/**
 * Summarize a selection where some files did not open. Returns null when
 * nothing needs reporting: every file opened, or the only skips were password
 * prompts the user canceled with nothing else opened.
 */
export function describeImportOutcome(
  mode: "upload" | "add",
  total: number,
  opened: number,
  skipped: readonly SkippedFile[]
): string | null {
  if (skipped.length === 0) return null;
  if (opened === 0 && skipped.every((entry) => entry.kind === "locked")) return null;

  const listed = skipped.slice(0, LISTED_SKIPS);
  const unlisted = skipped
    .slice(LISTED_SKIPS)
    .reduce((count, entry) => count + skippedCount(entry), 0);
  const reasons = listed.map(describeSkippedFile);
  if (unlisted > 0)
    reasons.push(`${unlisted} more file${unlisted === 1 ? "" : "s"} could not be opened.`);

  if (opened === 0) {
    return total === 1
      ? reasons.join(" ")
      : [`Could not open ${total} files.`, ...reasons].join(" ");
  }
  const verb = mode === "upload" ? "Opened" : "Added";
  return [`${verb} ${opened} of ${total} files.`, ...reasons].join(" ");
}
