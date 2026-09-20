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
