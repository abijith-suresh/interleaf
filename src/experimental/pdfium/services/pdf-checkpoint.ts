/** Serialized in-memory document state. Bytes are decrypted; the source password is retained for compression. */
export interface PDFDocumentCheckpoint {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly password?: string;
}
