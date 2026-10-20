import { Effect } from "effect";
import { degrees, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName } from "pdf-lib";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import worker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  type DestinationKind,
  exportCrossPageButtonFixture,
  exportFormFixture,
  exportLinkFixture,
  OMITTED_ANSWER,
  OMITTED_CONTENT,
} from "../../../src/services/__tests__/pdf-export-fixtures";
import {
  inspectExport,
  retainedMetadata,
} from "../../../src/services/__tests__/pdf-export-inspection";
import { drawPageAdditions } from "../../../src/services/pdf-additions";
import { PDFOperationsService } from "../../../src/services/pdf-operations-service";
import { PDFService } from "../../../src/services/pdf-service";
import { type PageState, PDFProcessingError } from "../../../src/types/interfaces";

GlobalWorkerOptions.workerSrc = worker;
function file(bytes: Uint8Array) {
  return new File([new Uint8Array(bytes)], "same.pdf", { type: "application/pdf" });
}
function state(sourceFile: File, sourcePageNumber: number, id: number): PageState {
  return { id: String(id), sourceFile, sourcePageNumber, rotation: 0, markedForDeletion: false };
}
function hash(bytes: Uint8ClampedArray) {
  let value = 2166136261;
  for (const byte of bytes) value = Math.imul(value ^ byte, 16777619);
  return value >>> 0;
}
function contains(serialized: string, text: string) {
  return (
    serialized.includes(text) ||
    serialized.includes(PDFHexString.fromText(text).toString().slice(1, -1)) ||
    serialized.includes(
      Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase()
    )
  );
}
export async function reopenWithPDFjs(bytes: Uint8Array) {
  const task = getDocument({ data: bytes.slice() });
  try {
    const doc = await task.promise;
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n),
        viewport = page.getViewport({ scale: 1 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const context = canvas.getContext("2d");
      if (!context) throw Error("No canvas context");
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const annotations = (await page.getAnnotations()).map((a) => ({
        name: a.fieldName,
        type: a.fieldType,
        value: a.fieldValue,
        readOnly: a.readOnly,
        flags: a.annotationFlags,
        rect: a.rect,
        button: a.buttonValue,
        options: a.options,
      }));
      pages.push({
        annotations,
        text: (await page.getTextContent()).items.map((item) => ("str" in item ? item.str : "")),
        pixels: hash(context.getImageData(0, 0, canvas.width, canvas.height).data),
      });
      canvas.width = canvas.height = 0;
      page.cleanup();
    }
    return pages;
  } finally {
    await task.destroy();
  }
}
async function baseline(pages: PageState[], service: PDFService) {
  const doc = await PDFDocument.create();
  for (const page of pages) {
    const source = await PDFDocument.load(await page.sourceFile.arrayBuffer());
    const [copy] = await doc.copyPages(source, [page.sourcePageNumber - 1]);
    if (page.addedText?.length || page.addedCheckmarks?.length)
      await drawPageAdditions(
        doc,
        copy,
        page,
        await Effect.runPromise(service.getPageGeometry(page.sourceFile, page.sourcePageNumber))
      );
    copy.setRotation(degrees((copy.getRotation().angle + page.rotation) % 360));
    doc.addPage(copy);
  }
  return doc.save();
}
export async function checkFormExports() {
  const files = [
    file(await exportFormFixture()),
    file(await exportFormFixture("Bob")),
    file(await exportFormFixture("Detached")),
  ];
  const service = new PDFService(),
    operations = new PDFOperationsService(service);
  const layouts: Record<string, [number, number][]> = {
    p1: [[0, 1]],
    p2: [[0, 2]],
    all: [
      [0, 1],
      [0, 2],
    ],
    reorder: [
      [0, 2],
      [0, 1],
    ],
    repeated: [
      [0, 1],
      [0, 1],
      [0, 2],
      [0, 2],
    ],
    detached: [
      [0, 1],
      [2, 1],
      [0, 2],
    ],
    merge: [
      [0, 1],
      [1, 1],
    ],
  };
  try {
    const results = [];
    for (const [name, layout] of Object.entries(layouts)) {
      const pages = layout.map(([file, n], index) => state(files[file], n, index));
      const beforeBytes = await baseline(pages, service),
        afterBytes = (await Effect.runPromise(operations.buildPDF(pages))).data;
      const before = await inspectExport(beforeBytes),
        after = await inspectExport(afterBytes);
      const beforeJs = await reopenWithPDFjs(beforeBytes),
        afterJs = await reopenWithPDFjs(afterBytes);
      results.push({
        name,
        nativeMatches:
          JSON.stringify(retainedMetadata(before)) === JSON.stringify(retainedMetadata(after)),
        jsMatches: JSON.stringify(beforeJs) === JSON.stringify(afterJs),
        pages: after.pageObjects,
        expectedPages: pages.length,
        orphanKids: after.orphanKids,
        leakedAnswer: contains(after.serialized, OMITTED_ANSWER),
        leakedContent: contains(after.serialized, OMITTED_CONTENT),
        provenance: /InterleafExportPage|10000000000\d\d/.test(after.serialized),
        grouping: after.pages.map((p) => p.annotations.map((a) => a.siblings)),
        values: afterJs.map((p) =>
          p.annotations.filter((a) => a.name === "person.name").map((a) => a.value)
        ),
        before: Array.from(beforeBytes),
        after: Array.from(afterBytes),
      });
    }
    const workspace = [
      state(files[0], 1, 0),
      { ...state(files[0], 2, 1), markedForDeletion: true },
    ];
    const marked = await inspectExport(
      (await Effect.runPromise(operations.buildPDF(workspace))).data
    );
    workspace[1].markedForDeletion = false;
    const selected = await inspectExport(
      (await Effect.runPromise(operations.buildPDF(workspace, { selectedIndices: [0] }))).data
    );
    const restored = await inspectExport(
      (await Effect.runPromise(operations.buildPDF(workspace))).data
    );
    return {
      results,
      scopes: {
        markedLeaks: contains(marked.serialized, OMITTED_ANSWER),
        selectedLeaks: contains(selected.serialized, OMITTED_ANSWER),
        restoredAnswer: contains(restored.serialized, OMITTED_ANSWER),
        restoredPages: restored.pageObjects,
      },
    };
  } finally {
    await Effect.runPromise(operations.dispose());
    await Effect.runPromise(service.dispose());
  }
}
export async function checkDestinations() {
  const service = new PDFService(),
    operations = new PDFOperationsService(service);
  try {
    const results = [];
    for (const kind of ["direct", "goto", "legacy", "names"] as DestinationKind[])
      for (const layout of [[1], [2], [1, 2], [2, 1], [1, 2, 1, 2]]) {
        const source = file(await exportLinkFixture(kind));
        const bytes = (
          await Effect.runPromise(operations.buildPDF(layout.map((n, i) => state(source, n, i))))
        ).data;
        const native = await inspectExport(bytes);
        const task = getDocument({ data: bytes.slice() });
        const destinations = [],
          external = [],
          remote = [];
        try {
          const doc = await task.promise;
          for (const [index, n] of layout.entries())
            if (n === 1) {
              const page = await doc.getPage(index + 1),
                annotations = await page.getAnnotations();
              const dest = annotations[0].dest;
              destinations.push(dest ? await doc.getPageIndex(dest[0]) : -1);
              external.push(annotations[1].url);
              remote.push(annotations[2].unsafeUrl);
              page.cleanup();
            }
        } finally {
          await task.destroy();
        }
        results.push({
          kind,
          layout,
          destinations,
          external,
          remote,
          pages: native.pageObjects,
          orphanKids: native.orphanKids,
          leakedContent: contains(native.serialized, OMITTED_CONTENT),
          provenance: /InterleafExportPage|10000000000\d\d/.test(native.serialized),
        });
      }
    return results;
  } finally {
    await Effect.runPromise(operations.dispose());
    await Effect.runPromise(service.dispose());
  }
}
export async function checkButtonFailure() {
  const bytes = await exportCrossPageButtonFixture(),
    source = file(bytes),
    service = new PDFService(),
    operations = new PDFOperationsService(service);
  try {
    const before = await baseline([state(source, 2, 0)], service);
    const unsafe = await PDFDocument.load(before);
    const widget = unsafe.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray).lookup(0, PDFDict);
    widget
      .lookup(PDFName.of("Parent"), PDFDict)
      .set(
        PDFName.of("Kids"),
        unsafe.context.obj([unsafe.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray).get(0)])
      );
    const unsafeBytes = await unsafe.save();
    const beforeJs = await reopenWithPDFjs(before),
      unsafeJs = await reopenWithPDFjs(unsafeBytes);
    let error: { operation: string; message: string } | undefined;
    try {
      await Effect.runPromise(operations.buildPDF([state(source, 2, 0)]));
    } catch (cause) {
      if (!(cause instanceof PDFProcessingError)) throw cause;
      error = { operation: cause.operation, message: cause.message };
    }
    return {
      before: beforeJs[0].annotations[0].value,
      unsafe: unsafeJs[0].annotations[0].value,
      error,
      sourceBytes: Array.from(bytes),
      beforeBytes: Array.from(before),
      unsafeBytes: Array.from(unsafeBytes),
    };
  } finally {
    await Effect.runPromise(operations.dispose());
    await Effect.runPromise(service.dispose());
  }
}
export async function checkAdditions() {
  const f = file(await exportFormFixture()),
    service = new PDFService(),
    operations = new PDFOperationsService(service);
  try {
    await Effect.runPromise(service.loadPDF(f));
    const page: PageState = {
      ...state(f, 1, 0),
      rotation: 90,
      addedText: [{ id: "t", text: "Saved text", x: 30, y: 100, fontSize: 14, rotation: 0 }],
      addedCheckmarks: [{ id: "c", x: 30, y: 150, size: 20, rotation: 90 }],
    };
    const pages = [state(f, 1, 1), page, state(f, 2, 2)];
    const beforeBytes = await baseline(pages, service),
      afterBytes = (await Effect.runPromise(operations.buildPDF(pages))).data;
    return {
      before: await reopenWithPDFjs(beforeBytes),
      after: await reopenWithPDFjs(afterBytes),
      native: await inspectExport(afterBytes),
    };
  } finally {
    await Effect.runPromise(operations.dispose());
    await Effect.runPromise(service.dispose());
  }
}
