export interface PDFBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PDFTextRun {
  index: number;
  text: string;
  editable: boolean;
  reason?: string;
  fontSize: number;
  bounds?: PDFBounds;
}

export interface PDFFormField {
  index: number;
  fieldId: number;
  name: string;
  type: number;
  value: string;
  checked: boolean;
  exportValue: string;
  options: string[];
  selectedOption: number;
  flags: number;
  readOnly: boolean;
  bounds?: PDFBounds;
}

export interface PDFPageContent {
  text: PDFTextRun[];
  fields: PDFFormField[];
  width: number;
  height: number;
}

export type PDFContentEdit =
  | { kind: "replace"; index: number; text: string; expectedText: string }
  | { kind: "add"; text: string; x: number; y: number; width: number; fontSize: number }
  | { kind: "form"; index: number; value: string };

export interface PDFiumPageRef {
  document: number;
  page: number;
  rotation: number;
}

export interface PDFiumImage {
  bytes: Uint8Array<ArrayBuffer>;
  kind: "png" | "jpeg";
  orientation: number;
}

export interface PDFiumCommands {
  open: {
    input: { bytes: Uint8Array<ArrayBuffer>; password?: string };
    output: { id: number; count: number };
  };
  close: { input: { id: number }; output: void };
  info: {
    input: { id: number; page: number; rotation: number };
    output: { width: number; height: number; rotation: number };
  };
  render: {
    input: { id: number; page: number; rotation: number; scale: number };
    output: { width: number; height: number; pixels: Uint8ClampedArray<ArrayBuffer> };
  };
  content: { input: { id: number; page: number }; output: PDFPageContent };
  edit: { input: { id: number; page: number; edit: PDFContentEdit }; output: void };
  build: { input: { pages: PDFiumPageRef[] }; output: Uint8Array };
  images: { input: { images: PDFiumImage[] }; output: Uint8Array };
}

export type PDFiumCommand = keyof PDFiumCommands;
export type PDFiumRequest = {
  [K in PDFiumCommand]: { sequence: number; command: K; input: PDFiumCommands[K]["input"] };
}[PDFiumCommand];
export type PDFiumResponse = { sequence: number } & (
  | { ok: true; value: unknown }
  | { ok: false; message: string; password: boolean }
);
