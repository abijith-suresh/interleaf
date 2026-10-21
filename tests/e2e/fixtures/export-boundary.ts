import { Effect } from "effect";
import {
  degrees,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFString,
} from "pdf-lib";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import worker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  COUNT_PAGE_TEXT,
  type DestinationKind,
  exportCrossPageButtonFixture,
  exportFormFixture,
  exportIndirectPageFixture,
  exportIndirectWidgetFixture,
  exportLinkFixture,
  exportOptionalActionFixture,
  exportPageCountFixture,
  exportPageIndexFixture,
  exportResourceNameFixture,
  INDEX_PAGE_TEXT,
  INDIRECT_OMITTED_ANSWER,
  OMITTED_ANSWER,
  OMITTED_CONTENT,
  type OptionalActionContext,
  type OptionalActionKind,
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
interface RenderEvidence {
  images: ImageData[];
  metadata: {
    width: number;
    height: number;
    fontStatus: string;
    userAgent: string;
    devicePixelRatio: number;
  }[];
}
function encodedImages(images: ImageData[]) {
  return images.map((image) => {
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) throw Error("No diagnostic canvas context");
    context.putImageData(image, 0, 0);
    const png = canvas.toDataURL("image/png");
    canvas.width = canvas.height = 0;
    return png;
  });
}
export async function reopenWithPDFjs(bytes: Uint8Array, evidence?: RenderEvidence) {
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
      const context = canvas.getContext("2d", { willReadFrequently: true });
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
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      if (evidence) {
        evidence.images.push(image);
        evidence.metadata.push({
          width: canvas.width,
          height: canvas.height,
          fontStatus: document.fonts.status,
          userAgent: navigator.userAgent,
          devicePixelRatio,
        });
      }
      pages.push({
        annotations,
        text: (await page.getTextContent()).items.map((item) => ("str" in item ? item.str : "")),
        pixels: hash(image.data),
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
    for (const kind of ["direct", "goto", "legacy", "names", "indirect-goto"] as (
      | DestinationKind
      | "indirect-goto"
    )[])
      for (const layout of [[1], [2], [1, 2], [2, 1], [1, 2, 1, 2]]) {
        let input = await exportLinkFixture(kind === "indirect-goto" ? "names" : kind);
        if (kind === "indirect-goto") {
          const doc = await PDFDocument.load(input);
          const link = doc
            .getPage(0)
            .node.lookup(PDFName.of("Annots"), PDFArray)
            .lookup(0, PDFDict);
          link.delete(PDFName.of("Dest"));
          link.set(
            PDFName.of("A"),
            doc.context.obj({
              S: doc.context.register(PDFName.of("GoTo")),
              D: PDFString.of("target"),
            })
          );
          input = await doc.save();
        }
        const source = file(input);
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
    const beforeEvidence: RenderEvidence = { images: [], metadata: [] },
      afterEvidence: RenderEvidence = { images: [], metadata: [] };
    const before = await reopenWithPDFjs(beforeBytes, beforeEvidence),
      after = await reopenWithPDFjs(afterBytes, afterEvidence);
    const nativeBefore = await inspectExport(beforeBytes),
      native = await inspectExport(afterBytes);
    const nativeMatches =
      JSON.stringify(retainedMetadata(nativeBefore)) === JSON.stringify(retainedMetadata(native));
    // Retain the exact buffers already hashed. Encode only after a mismatch, so
    // diagnostic PNG generation cannot change the render being compared.
    const mismatch = JSON.stringify(before) !== JSON.stringify(after) || !nativeMatches;
    return {
      before,
      after,
      native,
      nativeMatches,
      diagnostics: mismatch
        ? {
            sourceBytes: Array.from(new Uint8Array(await f.arrayBuffer())),
            beforeBytes: Array.from(beforeBytes),
            afterBytes: Array.from(afterBytes),
            beforePngs: encodedImages(beforeEvidence.images),
            afterPngs: encodedImages(afterEvidence.images),
            renderMetadata: { before: beforeEvidence.metadata, after: afterEvidence.metadata },
            nativeBefore,
            nativeAfter: native,
          }
        : undefined,
    };
  } finally {
    await Effect.runPromise(operations.dispose());
    await Effect.runPromise(service.dispose());
  }
}

export async function checkIndirectRoles() {
  const operations = new PDFOperationsService({ renderPage: () => Effect.void });
  try {
    const widgets = [];
    for (const indirect of [false, true]) {
      const input = await exportIndirectWidgetFixture(indirect),
        source = file(input);
      const output = (await Effect.runPromise(operations.buildPDF([state(source, 1, 0)]))).data;
      const before = await reopenWithPDFjs(input),
        after = await reopenWithPDFjs(output),
        native = await inspectExport(output);
      widgets.push({
        indirect,
        retainedMatches: JSON.stringify(before[0]) === JSON.stringify(after[0]),
        values: after[0].annotations.map((a) => ({ name: a.name, value: a.value })),
        pages: native.pageObjects,
        widgets: native.widgetObjects,
        orphanKids: native.orphanKids,
        answerRecovered: contains(native.serialized, INDIRECT_OMITTED_ANSWER),
        input: Array.from(input),
        output: Array.from(output),
      });
    }
    const pages = [];
    for (const indirect of [false, true]) {
      const input = await exportIndirectPageFixture(indirect, true),
        source = file(input),
        before = await reopenWithPDFjs(input);
      let error: { operation: string; message: string } | undefined,
        emitted = false;
      try {
        await Effect.runPromise(operations.buildPDF([state(source, 1, 0)]));
        emitted = true;
      } catch (cause) {
        if (!(cause instanceof PDFProcessingError)) throw cause;
        error = { operation: cause.operation, message: cause.message };
      }
      pages.push({
        indirect,
        input: Array.from(input),
        sourcePages: before.length,
        sourceRetainedText: before[0].text.includes("Retained page"),
        emitted,
        error,
      });
    }
    const indexing = [];
    for (const indirect of [false, true]) {
      const input = await exportPageIndexFixture(indirect),
        source = file(input),
        before = await reopenWithPDFjs(input),
        original = Array.from(new Uint8Array(await source.arrayBuffer()));
      for (const layout of [[2], [1], [1, 2, 3]]) {
        let error: { operation: string; message: string; sourceMatches: boolean } | undefined,
          output: number[] | undefined,
          text: string[][] | undefined;
        try {
          const bytes = (
            await Effect.runPromise(operations.buildPDF(layout.map((n, i) => state(source, n, i))))
          ).data;
          output = Array.from(bytes);
          text = (await reopenWithPDFjs(bytes)).map((page) => page.text);
        } catch (cause) {
          if (!(cause instanceof PDFProcessingError)) throw cause;
          error = {
            operation: cause.operation,
            message: cause.message,
            sourceMatches: cause.file === source,
          };
        }
        indexing.push({
          indirect,
          layout,
          input: Array.from(input),
          output,
          text,
          error,
          sourceTextMatches:
            before.length === 3 && before.every((p, i) => p.text.includes(INDEX_PAGE_TEXT[i])),
          unchanged:
            JSON.stringify(original) ===
            JSON.stringify(Array.from(new Uint8Array(await source.arrayBuffer()))),
        });
      }
    }
    return { widgets, pages, indexing };
  } finally {
    await Effect.runPromise(operations.dispose());
  }
}

export async function checkCountsAndResourceNames() {
  const service = new PDFService(),
    operations = new PDFOperationsService(service);
  try {
    const counts = [];
    for (const indirect of [false, true])
      for (const correct of [false, true]) {
        const input = await exportPageCountFixture(indirect, correct),
          source = file(input);
        const sourceOrders = [];
        for (const order of ["p2-only", "sequential", "concurrent"]) {
          const task = getDocument({ data: input.slice() });
          try {
            const doc = await task.promise;
            const text = async (n: number) =>
              (await (await doc.getPage(n)).getTextContent()).items
                .map((i) => ("str" in i ? i.str : ""))
                .join(" ");
            if (order === "sequential") for (let n = 1; n <= 4; n++) await text(n);
            if (order === "concurrent") await Promise.all([1, 2, 3, 4].map(text));
            sourceOrders.push({ order, text: await text(2), pages: doc.numPages });
          } finally {
            await task.destroy();
          }
        }
        for (const layout of [[2], [1], [1, 2, 3, 4], [4, 2, 1]]) {
          let output: number[] | undefined,
            text: string[][] | undefined,
            error: { operation: string; sourceMatches: boolean; message: string } | undefined;
          try {
            const bytes = (
              await Effect.runPromise(
                operations.buildPDF(layout.map((n, i) => state(source, n, i)))
              )
            ).data;
            output = Array.from(bytes);
            text = (await reopenWithPDFjs(bytes)).map((p) => p.text);
          } catch (cause) {
            if (!(cause instanceof PDFProcessingError)) throw cause;
            error = {
              operation: cause.operation,
              sourceMatches: cause.file === source,
              message: cause.message,
            };
          }
          counts.push({ indirect, correct, layout, sourceOrders, output, text, error });
        }
      }
    const resources = [];
    for (const checkbox of [false, true])
      for (const key of ["S", "Type", "Control"]) {
        const input = await exportResourceNameFixture(key, checkbox),
          source = file(input),
          pages = [state(source, 1, 0)];
        const before = await baseline(pages, service),
          after = (await Effect.runPromise(operations.buildPDF(pages))).data;
        const beforeEvidence: RenderEvidence = { images: [], metadata: [] },
          afterEvidence: RenderEvidence = { images: [], metadata: [] };
        const beforeJs = await reopenWithPDFjs(before, beforeEvidence),
          afterJs = await reopenWithPDFjs(after, afterEvidence);
        const pixelsEqual =
          beforeEvidence.images.length === afterEvidence.images.length &&
          beforeEvidence.images.every(
            (image, i) =>
              image.data.length === afterEvidence.images[i].data.length &&
              image.data.every((value, j) => value === afterEvidence.images[i].data[j])
          );
        const nativeBefore = await inspectExport(before),
          nativeAfter = await inspectExport(after);
        resources.push({
          checkbox,
          key,
          input: Array.from(input),
          before: Array.from(before),
          after: Array.from(after),
          metadataEqual:
            JSON.stringify(retainedMetadata(nativeBefore)) ===
            JSON.stringify(retainedMetadata(nativeAfter)),
          jsEqual: JSON.stringify(beforeJs) === JSON.stringify(afterJs),
          pixelsEqual,
          text: afterJs[0].text,
          values: afterJs[0].annotations.map((a) => a.value),
          pages: nativeAfter.pageObjects,
          orphanKids: nativeAfter.orphanKids,
        });
      }
    return { counts, resources, countText: COUNT_PAGE_TEXT };
  } finally {
    await Effect.runPromise(operations.dispose());
    await Effect.runPromise(service.dispose());
  }
}

export async function checkOptionalNullActions() {
  const service = new PDFService(),
    operations = new PDFOperationsService(service);
  const cases: [OptionalActionContext, OptionalActionKind][] = [
    ["page", "null"],
    ["page", "indirect-null"],
    ["annotation", "null"],
    ["field", "indirect-null"],
    ["page", "aa-null"],
    ["field", "aa-indirect-null"],
    ["annotation", "chain-null"],
    ["A", "indirect-null"],
    ["Next", "indirect-null"],
    ["Next", "null"],
    ["page", "absent"],
    ["annotation", "empty"],
    ["Next", "valid"],
  ];
  try {
    const results = [];
    for (const [context, kind] of cases) {
      const input = await exportOptionalActionFixture(context, kind),
        source = file(input),
        pages = [state(source, 1, 0)];
      const before = await baseline(pages, service),
        after = (await Effect.runPromise(operations.buildPDF(pages))).data;
      const beforeEvidence: RenderEvidence = { images: [], metadata: [] },
        afterEvidence: RenderEvidence = { images: [], metadata: [] };
      const beforeJs = await reopenWithPDFjs(before, beforeEvidence),
        afterJs = await reopenWithPDFjs(after, afterEvidence),
        beforeNative = await inspectExport(before),
        afterNative = await inspectExport(after);
      const pixelsEqual =
        beforeEvidence.images.length === afterEvidence.images.length &&
        beforeEvidence.images.every(
          (image, i) =>
            image.data.length === afterEvidence.images[i].data.length &&
            image.data.every((v, j) => v === afterEvidence.images[i].data[j])
        );
      const metadataEqual =
          JSON.stringify(retainedMetadata(beforeNative)) ===
          JSON.stringify(retainedMetadata(afterNative)),
        jsEqual = JSON.stringify(beforeJs) === JSON.stringify(afterJs);
      results.push({
        context,
        kind,
        before: Array.from(before),
        after: Array.from(after),
        input: Array.from(input),
        pixelsEqual,
        metadataEqual,
        jsEqual,
        text: afterJs[0].text,
        values: afterJs[0].annotations.map((a) => a.value),
        pages: afterNative.pageObjects,
        widgets: afterNative.widgetObjects,
        orphanKids: afterNative.orphanKids,
        diagnostics:
          pixelsEqual && metadataEqual && jsEqual
            ? undefined
            : {
                beforePngs: encodedImages(beforeEvidence.images),
                afterPngs: encodedImages(afterEvidence.images),
                before: beforeEvidence.metadata,
                after: afterEvidence.metadata,
              },
      });
    }
    const doc = await PDFDocument.load(await exportLinkFixture("goto")),
      link = doc.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray).lookup(0, PDFDict);
    link.lookup(PDFName.of("A"), PDFDict).set(PDFName.of("Next"), doc.context.register(PDFNull));
    const source = file(await doc.save()),
      output = (await Effect.runPromise(operations.buildPDF([state(source, 1, 0)]))).data,
      saved = await PDFDocument.load(output),
      native = await inspectExport(output),
      js = await reopenWithPDFjs(output);
    return {
      results,
      omitted: {
        pages: native.pageObjects,
        leaked: contains(native.serialized, OMITTED_CONTENT),
        inactive: !saved
          .getPage(0)
          .node.lookup(PDFName.of("Annots"), PDFArray)
          .lookup(0, PDFDict)
          .has(PDFName.of("A")),
        visiblePages: js.length,
        output: Array.from(output),
      },
    };
  } finally {
    await Effect.runPromise(operations.dispose());
    await Effect.runPromise(service.dispose());
  }
}
