import { Effect } from "effect";
import { unzipSync } from "fflate";
import { degrees, PDFDocument, PDFName, PDFNumber, rgb } from "pdf-lib";
import { getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import { PDFImageExportService } from "../../../src/services/pdf-image-export-service";
import { PDFOperationsService } from "../../../src/services/pdf-operations-service";
import { PDFService } from "../../../src/services/pdf-service";

export async function checkPageMetadata() {
  const source = await PDFDocument.create();
  for (const [index, rotation] of [90, 270, 0].entries()) {
    const page = source.addPage([400, 600]);
    page.setMediaBox(-40, -60, 400, 600);
    page.setCropBox(index === 1 ? -20 : 20, index === 1 ? -30 : 40, 100 + index * 20, 200);
    page.node.set(PDFName.of("UserUnit"), PDFNumber.of(index === 1 ? 2 : 1.5));
    page.setRotation(degrees(rotation));
    page.drawRectangle({ x: 30, y: 50, width: 50, height: 70, color: rgb(0.2, 0.4, 0.7) });
  }
  const bytes = await source.save();
  const file = new File([new Uint8Array(bytes)], "geometry.pdf", { type: "application/pdf" });
  const service = new PDFService();
  const operations = new PDFOperationsService(service);
  const images = new PDFImageExportService(service);
  // Loading the service sets the same worker URL used by the independent reference document.
  await Effect.runPromise(service.loadPDF(file));
  const referenceTask = getDocument({ data: bytes.slice() });
  const reference = await referenceTask.promise;
  const rotations = [0, 90, 180, 270, -90, 450, -450, 720];
  const expected = [];
  for (let number = 1; number <= 3; number++) {
    const page = await reference.getPage(number);
    expected.push({
      rotation: page.rotate,
      sizes: rotations.map((rotation) => {
        const viewport = page.getViewport({ scale: 1, rotation });
        return { width: viewport.width, height: viewport.height };
      }),
    });
    page.cleanup();
  }

  let acquisitions = 0;
  const prototype: PDFDocumentProxy = Object.getPrototypeOf(reference);
  const getPage = prototype.getPage;
  prototype.getPage = function (number) {
    acquisitions++;
    return getPage.call(this, number);
  };
  try {
    const actual = await Promise.all(
      [1, 2, 3].map(async (number) => {
        const [rotation, ...sizes] = await Promise.all([
          Effect.runPromise(service.getPageRotation(file, number)),
          ...rotations.map((rotation) =>
            Effect.runPromise(service.getPageSize(file, number, rotation))
          ),
        ]);
        return { rotation, sizes };
      })
    );
    // A second pass must also reuse the completed scalar values.
    for (let number = 1; number <= 3; number++) {
      await Effect.runPromise(service.getPageRotation(file, number));
      await Effect.runPromise(service.getPageSize(file, number));
    }
    const metadataAcquisitions = acquisitions;
    const metadataReads = 3 * (1 + rotations.length + 2);
    const invalidRotations = [];
    const referencePage = await reference.getPage(1);
    for (const rotation of [45, -45, 90.5, NaN, Infinity, -Infinity]) {
      let expectedError: string | undefined;
      let actualError: string | undefined;
      try {
        referencePage.getViewport({ scale: 1, rotation });
      } catch (error) {
        expectedError = (error as Error).message;
      }
      try {
        await Effect.runPromise(service.getPageSize(file, 1, rotation));
      } catch (error) {
        actualError = (error as Error).message;
      }
      invalidRotations.push({ actual: actualError, expected: expectedError });
    }
    referencePage.cleanup();
    const rendered = [];
    const pages = [1, 2, 3].map((number, index) => ({
      id: `page-${number}`,
      sourceFile: file,
      sourcePageNumber: number,
      rotation: [90, 180, 270][index],
      markedForDeletion: false,
    }));
    for (const page of pages) {
      const rotation = (expected[page.sourcePageNumber - 1].rotation + page.rotation) % 360;
      const canvas = document.createElement("canvas");
      await Effect.runPromise(service.renderPage(file, page.sourcePageNumber, canvas, 2, rotation));
      const referencePage = await reference.getPage(page.sourcePageNumber);
      const viewport = referencePage.getViewport({ scale: 2, rotation });
      rendered.push({
        actual: [canvas.width, canvas.height],
        expected: [viewport.width, viewport.height],
      });
      referencePage.cleanup();
      canvas.width = canvas.height = 0;
    }
    const exported = await Effect.runPromise(operations.buildPDF(pages));
    const pdf = await PDFDocument.load(exported.data);
    const pdfPages = pdf.getPages().map((page) => ({
      rotation: page.getRotation().angle,
      crop: page.getCropBox(),
      userUnit: page.node.get(PDFName.of("UserUnit"))?.toString(),
    }));
    const expectedPdfPages = source.getPages().map((page, index) => ({
      rotation: (page.getRotation().angle + pages[index].rotation) % 360,
      crop: page.getCropBox(),
      userUnit: page.node.get(PDFName.of("UserUnit"))?.toString(),
    }));
    const archive = await Effect.runPromise(images.exportImages(pages));
    const pngs = Object.entries(unzipSync(new Uint8Array(await archive.data.arrayBuffer())))
      .filter(([name]) => name.endsWith(".png"))
      .map(([name, data]) => {
        const header = new DataView(data.buffer, data.byteOffset, data.byteLength);
        return { name, size: [header.getUint32(16), header.getUint32(20)] };
      });
    return {
      actual,
      expected,
      metadataAcquisitions,
      metadataReads,
      invalidRotations,
      rendered,
      pdfPages,
      expectedPdfPages,
      pngs,
    };
  } finally {
    prototype.getPage = getPage;
    await Effect.runPromise(service.dispose());
    await Effect.runPromise(operations.dispose());
    await referenceTask.destroy();
  }
}
