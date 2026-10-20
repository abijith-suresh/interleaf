import { Effect } from "effect";
import { unzipSync } from "fflate";
import { degrees, PDFDocument, PDFName, PDFNumber, rgb, StandardFonts } from "pdf-lib";
import { getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import { pdfToViewport, viewportToPDF } from "../../../src/controllers/text-geometry";
import { PDFImageExportService } from "../../../src/services/pdf-image-export-service";
import { PDFOperationsService } from "../../../src/services/pdf-operations-service";
import { PDFService } from "../../../src/services/pdf-service";
import type { PageState } from "../../../src/types/interfaces";

function context(canvas: HTMLCanvasElement) {
  const value = canvas.getContext("2d");
  if (!value) throw new Error("Missing canvas context");
  return value;
}

function pixelDifference(left: HTMLCanvasElement, right: HTMLCanvasElement) {
  if (left.width !== right.width || left.height !== right.height) return Infinity;
  const a = context(left).getImageData(0, 0, left.width, left.height).data;
  const b = context(right).getImageData(0, 0, right.width, right.height).data;
  let difference = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) difference++;
  return difference;
}

async function renderReference(
  document: PDFDocumentProxy,
  number: number,
  scale: number,
  rotation?: number
) {
  const page = await document.getPage(number);
  const viewport = page.getViewport({ scale, rotation });
  const canvas = window.document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvas, canvasContext: context(canvas), viewport }).promise;
  page.cleanup();
  return canvas;
}

export async function checkAddedText(encrypted = false, unitIndex = 0, intrinsicIndex = 0) {
  const source = await PDFDocument.create();
  const font = await source.embedFont(StandardFonts.Helvetica);
  for (const unit of [1, 1.5, 2])
    for (const intrinsic of [0, 90, 180, 270]) {
      const page = source.addPage([300, 400]);
      page.setMediaBox(-40, -60, 300, 400);
      page.setCropBox(unit === 1.5 ? 20 : -20, unit === 1.5 ? 40 : -30, 200, 240);
      page.node.set(PDFName.of("UserUnit"), PDFNumber.of(unit));
      page.setRotation(degrees(intrinsic));
      page.drawText("Original", { x: 30, y: 190, size: 12, font });
      page.drawRectangle({ x: 30, y: 50, width: 20, height: 20, color: rgb(0.2, 0.4, 0.7) });
    }
  // The .b64 fixture contains these same 12 pages, encrypted with pypdf 6.21.1
  // PdfWriter.clone_document_from_reader, encrypt("623", algorithm="RC4-128").
  const encryptedData = encrypted
    ? Uint8Array.from(
        atob((await (await fetch("/tests/e2e/fixtures/added-text-encrypted.b64")).text()).trim()),
        (character) => character.charCodeAt(0)
      )
    : undefined;
  const file = new File(
    [encryptedData ?? new Uint8Array(await source.save())],
    "text-geometry.pdf",
    {
      type: "application/pdf",
    }
  );
  const service = new PDFService();
  const operations = new PDFOperationsService(service);
  const images = new PDFImageExportService(service);
  await Effect.runPromise(
    encrypted ? service.loadPDFWithPassword(file, "623") : service.loadPDF(file)
  );
  const sourceTask = getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    password: encrypted ? "623" : undefined,
  });
  const referenceSource = await sourceTask.promise;
  let outputTask: ReturnType<typeof getDocument> | undefined;
  try {
    const pages: PageState[] = [];
    let maxRoundtripError = 0;
    for (const number of [unitIndex * 4 + intrinsicIndex + 1]) {
      const geometry = await Effect.runPromise(service.getPageGeometry(file, number));
      const reference = await referenceSource.getPage(number);
      for (const workspace of [0, 90, 180, 270]) {
        const rotation = (reference.rotate + workspace) % 360;
        const viewport = reference.getViewport({ scale: 1, rotation });
        const x = (geometry.bounds[0] + geometry.bounds[2]) / 2;
        const y = (geometry.bounds[1] + geometry.bounds[3]) / 2;
        const point = pdfToViewport(geometry, rotation, x, y);
        const expected = viewport.convertToViewportPoint(x, y);
        const back = viewportToPDF(geometry, rotation, point.x, point.y);
        maxRoundtripError = Math.max(
          maxRoundtripError,
          Math.abs(point.x - expected[0]),
          Math.abs(point.y - expected[1]),
          Math.abs(back.x - x),
          Math.abs(back.y - y)
        );
        pages.push({
          id: `page-${number}-${workspace}`,
          sourceFile: file,
          sourcePageNumber: number,
          rotation: workspace,
          markedForDeletion: false,
          addedText: [{ id: "text", text: "Added 123", x, y, fontSize: 16, rotation }],
        });
      }
      reference.cleanup();
    }
    const output = await Effect.runPromise(operations.buildPDF(pages));
    outputTask = getDocument({ data: output.data.slice() });
    const document = await outputTask.promise;
    const results = [];
    for (const [index, page] of pages.entries()) {
      const proxy = await document.getPage(index + 1);
      const content = await proxy.getTextContent();
      const added = content.items.find((item) => "str" in item && item.str === "Added 123");
      const unit = proxy.userUnit;
      const physicalSize =
        added && "transform" in added
          ? Math.hypot(added.transform[0], added.transform[1]) * unit
          : 0;
      const geometry = await Effect.runPromise(
        service.getPageGeometry(file, page.sourcePageNumber)
      );
      const rotation =
        ((await Effect.runPromise(service.getPageRotation(file, page.sourcePageNumber))) +
          page.rotation) %
        360;
      const saved = page.addedText?.[0];
      if (!added || !("transform" in added) || !saved) throw new Error("Missing added text");
      const viewport = proxy.getViewport({ scale: 1 });
      const actualPoint = viewport.convertToViewportPoint(added.transform[4], added.transform[5]);
      const expectedPoint = pdfToViewport(geometry, rotation, saved.x, saved.y);
      const placementError = Math.max(
        Math.abs(actualPoint[0] - expectedPoint.x),
        Math.abs(actualPoint[1] - expectedPoint.y)
      );
      const [a, b, c, d] = viewport.transform;
      const directionError = Math.max(
        Math.abs(a * added.transform[0] + c * added.transform[1] - 16),
        Math.abs(b * added.transform[0] + d * added.transform[1])
      );
      const strings = content.items.flatMap((item) => ("str" in item ? [item.str] : []));
      proxy.cleanup();
      const actual = window.document.createElement("canvas");
      await Effect.runPromise(service.renderPageState(page, actual, 1, rotation));
      const expected = await renderReference(document, index + 1, 1);
      const thumbnail = window.document.createElement("canvas");
      await Effect.runPromise(service.renderPageState(page, thumbnail, 0.35, rotation));
      const expectedThumbnail = await renderReference(document, index + 1, 0.35);
      results.push({
        strings,
        physicalSize,
        placementError,
        directionError,
        pixels: pixelDifference(actual, expected),
        thumbnail: pixelDifference(thumbnail, expectedThumbnail),
      });
      for (const canvas of [actual, expected, thumbnail, expectedThumbnail])
        canvas.width = canvas.height = 0;
    }
    // PNG uses the same actual generated-PDF renderer at its export scale.
    const selected = [0, 1, 2, 3];
    const archive = await Effect.runPromise(
      images.exportImages(pages, { selectedIndices: selected })
    );
    const entries = Object.values(unzipSync(new Uint8Array(await archive.data.arrayBuffer())));
    const pngDifferences = [];
    for (const [index, bytes] of entries.entries()) {
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: "image/png" })
      );
      const actual = window.document.createElement("canvas");
      actual.width = bitmap.width;
      actual.height = bitmap.height;
      context(actual).drawImage(bitmap, 0, 0);
      bitmap.close();
      const expected = await renderReference(document, selected[index] + 1, 2);
      pngDifferences.push(pixelDifference(actual, expected));
      actual.width = actual.height = expected.width = expected.height = 0;
    }
    return { maxRoundtripError, results, pngDifferences };
  } finally {
    await outputTask?.destroy();
    await sourceTask.destroy();
    await Effect.runPromise(operations.dispose());
    await Effect.runPromise(service.dispose());
  }
}

export async function checkLargeProtectedPNG() {
  // Same first page as added-text-encrypted.b64, rewritten with pypdf 6.21.1
  // UserUnit 5 and the same RC4-128 password. Its 2x raster exceeds 4M pixels.
  const encoded = (
    await (await fetch("/tests/e2e/fixtures/added-text-large-encrypted.b64")).text()
  ).trim();
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  const file = new File([bytes], "large-protected.pdf", { type: "application/pdf" });
  const service = new PDFService();
  const operations = new PDFOperationsService(service);
  const images = new PDFImageExportService(service);
  let task: ReturnType<typeof getDocument> | undefined;
  let actual: HTMLCanvasElement | undefined;
  let expected: HTMLCanvasElement | undefined;
  try {
    await Effect.runPromise(service.loadPDFWithPassword(file, "623"));
    const page: PageState = {
      id: "large",
      sourceFile: file,
      sourcePageNumber: 1,
      rotation: 90,
      markedForDeletion: false,
      addedText: [{ id: "text", text: "Added 123", x: 80, y: 90, fontSize: 16, rotation: 90 }],
    };
    const output = await Effect.runPromise(operations.buildPDF([page]));
    task = getDocument({ data: output.data.slice() });
    const reference = await task.promise;
    expected = await renderReference(reference, 1, 2);
    const archive = await Effect.runPromise(images.exportImages([page]));
    const png = Object.values(unzipSync(new Uint8Array(await archive.data.arrayBuffer())))[0];
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(png)], { type: "image/png" }));
    actual = document.createElement("canvas");
    actual.width = bitmap.width;
    actual.height = bitmap.height;
    context(actual).drawImage(bitmap, 0, 0);
    bitmap.close();
    return {
      difference: pixelDifference(actual, expected),
      size: [actual.width, actual.height],
      area: actual.width * actual.height,
    };
  } finally {
    if (actual) actual.width = actual.height = 0;
    if (expected) expected.width = expected.height = 0;
    await task?.destroy();
    await Effect.runPromise(operations.dispose());
    await Effect.runPromise(service.dispose());
  }
}
