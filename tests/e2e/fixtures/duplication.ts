import { unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import worker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = worker;

function pixels(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Missing pixel context");
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let hash = 2166136261;
  let ink = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index] < 240 || data[index + 1] < 240 || data[index + 2] < 240) ink++;
    for (let channel = 0; channel < 4; channel++) {
      hash = Math.imul(hash ^ data[index + channel], 16777619);
    }
  }
  return { size: [canvas.width, canvas.height], hash: hash >>> 0, ink };
}

export async function inspectPDF(bytes: number[]) {
  const lib = await PDFDocument.load(new Uint8Array(bytes));
  const task = getDocument({ data: new Uint8Array(bytes) });
  const pdf = await task.promise;
  try {
    const pages = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const canvasContext = canvas.getContext("2d", { willReadFrequently: true });
      if (!canvasContext) throw new Error("Missing PDF context");
      await page.render({ canvas, canvasContext, viewport }).promise;
      const text = (await page.getTextContent()).items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");
      pages.push({
        text,
        rotation: page.rotate,
        libRotation: lib.getPage(number - 1).getRotation().angle,
        libSize: lib.getPage(number - 1).getSize(),
        annotations: (await page.getAnnotations()).map((annotation) => ({
          subtype: annotation.subtype,
          fieldValue: annotation.fieldValue,
        })),
        ...pixels(canvas),
      });
      canvas.width = canvas.height = 0;
      page.cleanup();
    }
    return { count: lib.getPageCount(), pages };
  } finally {
    await task.destroy();
  }
}

export async function inspectZIP(bytes: number[]) {
  const entries = [];
  for (const [name, data] of Object.entries(unzipSync(new Uint8Array(bytes)))) {
    const url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: "image/png" }));
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Missing PNG context");
      context.drawImage(image, 0, 0);
      entries.push({ name, ...pixels(canvas) });
      canvas.width = canvas.height = 0;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return entries;
}
