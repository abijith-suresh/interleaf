import type { PageState } from "../../types/interfaces";

export interface PdfFixturePage {
  width: number;
  height: number;
  rotation?: number;
}

export async function createPdfFile(name: string, pages: readonly PdfFixturePage[]): Promise<File> {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${i + 3} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    ...pages.map(
      (page) =>
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Rotate ${page.rotation ?? 0} /Resources << >> >>`
    ),
  ];
  return new File([createPdfBytes(objects)], name, { type: "application/pdf" });
}

/** Independent, uncompressed fixture writer. Deliberately does not use the engine under test. */
export function createPdfBytes(objects: string[]): Uint8Array<ArrayBuffer> {
  let pdf = "%PDF-1.7\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
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

export function formBytes(
  paired = false,
  pageOptions: { rotation?: number; crop?: readonly number[] } = {}
) {
  const text = "BT /F1 16 Tf 20 260 Td (Original phrase) Tj ET";
  return createPdfBytes([
    "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [6 0 R 7 0 R 10 0 R 11 0 R] /DR << /Font << /Helv 4 0 R >> >> /DA (/Helv 12 Tf 0 g) >> >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Rotate ${pageOptions.rotation ?? 0} ${pageOptions.crop ? `/CropBox [${pageOptions.crop.join(" ")}]` : ""} /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R /Annots [6 0 R 7 0 R 10 0 R 11 0 R] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    "<< /Type /Annot /Subtype /Widget /FT /Tx /T (Name) /V (Before) /Rect [20 200 220 225] /P 3 0 R /F 4 /DA (/Helv 12 Tf 0 g) >>",
    "<< /Type /Annot /Subtype /Widget /FT /Btn /T (Agree) /V /Off /AS /Off /Rect [20 150 40 170] /P 3 0 R /F 4 /AP << /N << /Off 8 0 R /Accepted 9 0 R >> >> >>",
    "<< /Type /XObject /Subtype /Form /BBox [0 0 20 20] /Length 0 >>\nstream\n\nendstream",
    "<< /Type /XObject /Subtype /Form /BBox [0 0 20 20] /Length 22 >>\nstream\n0 0 20 20 re 0.2 g f\nendstream",
    `<< /Type /Annot /Subtype /Widget /FT /Ch /Ff 131072 /T (Color) /Opt ${paired ? "[[(r) (Red)] [(b) (Blue)]]" : "[(Red) (Blue)]"} /V (${paired ? "r" : "Red"}) /Rect [20 100 220 125] /P 3 0 R /F 4 /DA (/Helv 12 Tf 0 g) >>`,
    "<< /Type /Annot /Subtype /Widget /FT /Tx /Ff 1 /T (ReadOnly) /V (Fixed) /Rect [20 50 220 75] /P 3 0 R /F 4 /DA (/Helv 12 Tf 0 g) >>",
  ]);
}

export function sharedFormBytes(): Uint8Array<ArrayBuffer> {
  return createPdfBytes([
    "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [6 0 R 7 0 R] /DR << /Font << /Helv 5 0 R >> >> /DA (/Helv 12 Tf 0 g) >> >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << >> /Annots [8 0 R 10 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << >> /Annots [9 0 R 11 0 R] >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /FT /Tx /T (Shared) /V (Before) /Kids [8 0 R 9 0 R] /DA (/Helv 12 Tf 0 g) >>",
    "<< /FT /Btn /Ff 32768 /T (Choice) /V /A /Kids [10 0 R 11 0 R] >>",
    "<< /Type /Annot /Subtype /Widget /Parent 6 0 R /Rect [20 200 220 225] /P 3 0 R /F 4 >>",
    "<< /Type /Annot /Subtype /Widget /Parent 6 0 R /Rect [20 200 220 225] /P 4 0 R /F 4 >>",
    "<< /Type /Annot /Subtype /Widget /Parent 7 0 R /Rect [20 150 40 170] /P 3 0 R /F 4 /AS /A /AP << /N << /Off 12 0 R /A 13 0 R >> >> >>",
    "<< /Type /Annot /Subtype /Widget /Parent 7 0 R /Rect [20 150 40 170] /P 4 0 R /F 4 /AS /Off /AP << /N << /Off 12 0 R /B 13 0 R >> >> >>",
    "<< /Type /XObject /Subtype /Form /BBox [0 0 20 20] /Length 0 >>\nstream\n\nendstream",
    "<< /Type /XObject /Subtype /Form /BBox [0 0 20 20] /Length 20 >>\nstream\n0 0 20 20 re 0 g f\nendstream",
  ]);
}
