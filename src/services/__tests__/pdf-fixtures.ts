import { degrees, PDFDocument } from "pdf-lib";
import type { PageState } from "../../types/interfaces";

export interface PdfFixturePage {
  width: number;
  height: number;
  rotation?: number;
}

export async function createPdfFile(name: string, pages: readonly PdfFixturePage[]): Promise<File> {
  const document = await PDFDocument.create();

  for (const pageSpec of pages) {
    const page = document.addPage([pageSpec.width, pageSpec.height]);

    if (pageSpec.rotation !== undefined) {
      page.setRotation(degrees(pageSpec.rotation));
    }
  }

  const data = await document.save();
  const fileBytes = new Uint8Array(data.byteLength);
  fileBytes.set(data);

  return new File([fileBytes], name, { type: "application/pdf" });
}

export function createPageState(
  sourceFile: File,
  sourcePageNumber: number,
  overrides: Partial<Omit<PageState, "sourceFile" | "sourcePageNumber">> = {}
): PageState {
  return {
    id: `${sourceFile.name}-${sourcePageNumber}`,
    sourceFile,
    sourcePageNumber,
    rotation: 0,
    markedForDeletion: false,
    ...overrides,
  };
}
