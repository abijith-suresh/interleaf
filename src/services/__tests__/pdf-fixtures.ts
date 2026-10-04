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

function imageBytes(base64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

// A 2x1 PNG and a 2x3 JPEG distinguish source order and page orientation.
const PNG_BYTES = imageBytes(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGP8z8DAwMAAAAYIAQHLR3Z1AAAAAElFTkSuQmCC"
);
const JPEG_BYTES = imageBytes(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAADAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDxyiiiv3E8w//Z"
);
const EXIF_ORIENTATION_6 = new Uint8Array([
  0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x49, 0x49, 0x2a, 0x00, 0x08, 0x00,
  0x00, 0x00, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
]);

export function createPngFile(name = "image.png"): File {
  return new File([PNG_BYTES], name, { type: "image/png" });
}

export function createJpegFile(name = "image.jpg", rotated = false): File {
  const bytes = rotated
    ? new Uint8Array([
        ...JPEG_BYTES.subarray(0, 2),
        ...EXIF_ORIENTATION_6,
        ...JPEG_BYTES.subarray(2),
      ])
    : JPEG_BYTES;
  return new File([bytes], name, { type: "image/jpeg" });
}
