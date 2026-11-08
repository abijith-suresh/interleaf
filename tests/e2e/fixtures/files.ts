import { readFile } from "node:fs/promises";
import { createPdfFile, type PdfFixturePage } from "../../../src/services/__tests__/pdf-fixtures";

export interface FilePayload {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

export async function filePayload(file: File): Promise<FilePayload> {
  return { name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) };
}

export async function blankPdf(name: string, pages: readonly PdfFixturePage[]) {
  return filePayload(await createPdfFile(name, pages));
}

export async function encryptedFixture(name = "encrypted-40-bit-r3") {
  return {
    name: `${name}.pdf`,
    mimeType: "application/pdf",
    buffer: Buffer.from(await readFile(`tools/qpdf-wasm/fixtures/${name}.b64`, "utf8"), "base64"),
  };
}
