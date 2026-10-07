import { Effect } from "effect";
import { IMAGES_TO_PDF_FILENAME, OUTPUT_FILENAME } from "../constants";
import type {
  PageState,
  PDFBuildProgress,
  PDFError,
  PDFOperationResult,
} from "../types/interfaces";
import { PDFNoPagesError, PDFProcessingError } from "../types/interfaces";
import { getSupportedFileKind } from "../utils/file-types";
import { processingError } from "./pdf-errors";
import type { PDFService } from "./pdf-service";
import type { PDFiumImage } from "./pdfium/protocol";

export interface PDFBuildOptions {
  readonly selectedIndices?: readonly number[];
  readonly onProgress?: (progress: PDFBuildProgress) => void;
}
export interface PDFImagesToPDFOptions {
  readonly onProgress?: (progress: PDFBuildProgress) => void;
}
type JPEGOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

function readJpegOrientation(data: ArrayBuffer): JPEGOrientation {
  const view = new DataView(data);
  if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) return 1;

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) return 1;

    const marker = view.getUint8(offset + 1);
    offset += 2;
    if (marker === 0xda || marker === 0xd9) break;

    const segmentLength = view.getUint16(offset, false);
    if (segmentLength < 2 || offset + segmentLength > view.byteLength) return 1;

    const segmentStart = offset + 2;
    const segmentEnd = offset + segmentLength;
    if (
      marker === 0xe1 &&
      segmentLength >= 16 &&
      view.getUint8(segmentStart) === 0x45 &&
      view.getUint8(segmentStart + 1) === 0x78 &&
      view.getUint8(segmentStart + 2) === 0x69 &&
      view.getUint8(segmentStart + 3) === 0x66 &&
      view.getUint8(segmentStart + 4) === 0x00 &&
      view.getUint8(segmentStart + 5) === 0x00
    ) {
      const tiffStart = segmentStart + 6;
      if (tiffStart + 8 > segmentEnd) return 1;
      const littleEndian = view.getUint16(tiffStart, false) === 0x4949;
      const readUint16 = (position: number) => view.getUint16(position, littleEndian);
      const readUint32 = (position: number) => view.getUint32(position, littleEndian);

      if (readUint16(tiffStart + 2) !== 42) return 1;
      const firstIfdOffset = readUint32(tiffStart + 4);
      const firstIfd = tiffStart + firstIfdOffset;
      if (firstIfd + 2 > segmentEnd) return 1;

      const entryCount = readUint16(firstIfd);
      for (let index = 0; index < entryCount; index += 1) {
        const entry = firstIfd + 2 + index * 12;
        if (entry + 12 > segmentEnd) return 1;
        if (readUint16(entry) !== 0x0112) continue;
        if (readUint16(entry + 2) !== 3 || readUint32(entry + 4) < 1) return 1;

        const orientation = readUint16(entry + 8);
        return orientation >= 1 && orientation <= 8 ? (orientation as JPEGOrientation) : 1;
      }
    }

    offset += segmentLength;
  }

  return 1;
}

export class PDFOperationsService {
  constructor(private readonly pdfService: PDFService) {}
  clearCache(): Effect.Effect<void> {
    return Effect.void;
  }
  releaseFile(_file: File): Effect.Effect<void> {
    return Effect.void;
  }
  dispose(): Effect.Effect<void> {
    return Effect.void;
  }

  imagesToPDF(
    files: readonly File[],
    options: PDFImagesToPDFOptions = {}
  ): Effect.Effect<PDFOperationResult, PDFProcessingError> {
    if (
      !files.length ||
      files.some((file) => !["png", "jpeg"].includes(getSupportedFileKind(file) ?? ""))
    )
      return Effect.fail(
        new PDFProcessingError({
          operation: "images-to-pdf",
          cause: new Error("Unsupported image type"),
          message: "Choose at least one PNG or JPEG image.",
        })
      );
    return Effect.gen({ self: this }, function* () {
      const images: PDFiumImage[] = [];
      for (const file of files) {
        const buffer = yield* Effect.tryPromise({
          try: () => file.arrayBuffer(),
          catch: (cause) => processingError("read-image", file, cause),
        });
        const kind = getSupportedFileKind(file) === "png" ? "png" : "jpeg";
        images.push({
          bytes: new Uint8Array(buffer),
          kind,
          orientation: kind === "jpeg" ? readJpegOrientation(buffer) : 1,
        });
      }
      const data = yield* this.pdfService.imagesToPDF(images, files[0]);
      options.onProgress?.({ completed: files.length, total: files.length });
      return { data, suggestedFileName: IMAGES_TO_PDF_FILENAME };
    });
  }

  buildPDF(
    pages: readonly PageState[],
    options: PDFBuildOptions = {}
  ): Effect.Effect<PDFOperationResult, PDFError> {
    const selected = options.selectedIndices
      ? options.selectedIndices
          .map((index) => pages[index])
          .filter((page): page is PageState => Boolean(page) && !page.markedForDeletion)
      : pages.filter((page) => !page.markedForDeletion);
    if (!selected.length)
      return Effect.fail(new PDFNoPagesError({ message: "No pages to include in the PDF" }));
    return this.pdfService.buildPages(selected).pipe(
      Effect.map((data) => {
        options.onProgress?.({ completed: selected.length, total: selected.length });
        return { data, suggestedFileName: OUTPUT_FILENAME };
      })
    );
  }
}
