import { Effect } from "effect";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef } from "pdf-lib";
import { PDFOperationsService } from "../../../src/services/pdf-operations-service";
import { PDFService } from "../../../src/services/pdf-service";
import { pixels, reference } from "./pdfium-core";
import { fieldScenarios, sharedFieldSource } from "./pdfium-fields-source";
import type { FieldRequest, FieldResult, FieldVariant } from "./pdfium-fields-worker";

interface Group {
  readonly id: number;
  readonly fieldType: string | null;
  readonly siblings: number;
  readonly visibleMembers: string[];
  readonly reciprocal: boolean[];
}

// This is an independent pdf-lib dictionary inspection, not a production parser.
// Object numbers vary across writers. Report groups by first visible membership.
function grouping(pdf: PDFDocument) {
  const groups = new Map<string, Group>();
  const widgets = pdf.getPages().map((page, pageIndex) =>
    (page.node.Annots()?.asArray() ?? []).map((ref, index) => {
      const widget = pdf.context.lookup(ref);
      if (!(widget instanceof PDFDict)) throw new Error("Expected widget dictionary.");
      const parentRef = widget.get(PDFName.of("Parent"));
      const parent = parentRef ? pdf.context.lookup(parentRef) : undefined;
      const fieldType = parent instanceof PDFDict ? parent.get(PDFName.of("FT")) : undefined;
      const kids = parent instanceof PDFDict ? parent.get(PDFName.of("Kids")) : undefined;
      const children = kids ? pdf.context.lookup(kids) : undefined;
      if (
        !(parentRef instanceof PDFRef) ||
        !(fieldType instanceof PDFName) ||
        !(children instanceof PDFArray)
      )
        return { group: null, siblings: 0, reciprocal: false };
      const key = parentRef.toString();
      let group = groups.get(key);
      if (!group) {
        group = {
          id: groups.size + 1,
          fieldType: fieldType.toString(),
          siblings: children.size(),
          visibleMembers: [],
          reciprocal: [],
        };
        groups.set(key, group);
      }
      const reciprocal = children.asArray().some((child) => child.toString() === ref.toString());
      group.visibleMembers.push(`${pageIndex + 1}:${index + 1}`);
      group.reciprocal.push(reciprocal);
      return { group: group.id, siblings: group.siblings, reciprocal };
    })
  );
  return { widgets, groups: Array.from(groups.values()) };
}

async function inspect(bytes: Uint8Array<ArrayBuffer>) {
  const oracle = await reference(bytes);
  try {
    const fields = [];
    const bitmaps = [];
    for (let number = 1; number <= oracle.pdf.numPages; number++) {
      const page = await oracle.pdf.getPage(number);
      try {
        fields.push(
          (await page.getAnnotations()).map((annot) => ({
            name: annot.fieldName ?? "",
            value: annot.fieldValue ?? null,
            type: annot.fieldType ?? null,
            hasAppearance: annot.hasAppearance ?? false,
          }))
        );
      } finally {
        page.cleanup();
      }
      bitmaps.push(await pixels(oracle.pdf, number, 0));
    }
    return { fields, grouping: grouping(await PDFDocument.load(bytes)), bitmaps };
  } finally {
    await oracle.dispose();
  }
}
function appearance(
  actual: Awaited<ReturnType<typeof inspect>>,
  expected: Awaited<ReturnType<typeof inspect>>
) {
  if (actual.bitmaps.length !== expected.bitmaps.length) throw new Error("Page count differs.");
  return actual.bitmaps.map((bitmap, index) => {
    const required = expected.bitmaps[index];
    if (bitmap.width !== required.width || bitmap.height !== required.height)
      throw new Error("Page size differs.");
    let differingChannels = 0;
    let inkPixels = 0;
    for (let channel = 0; channel < bitmap.pixels.length; channel++)
      if (bitmap.pixels[channel] !== required.pixels[channel]) differingChannels++;
    for (let offset = 0; offset < bitmap.pixels.length; offset += 4)
      if (Math.min(...bitmap.pixels.subarray(offset, offset + 3)) < 128) inkPixels++;
    return {
      width: bitmap.width,
      height: bitmap.height,
      differingChannels,
      totalChannels: bitmap.pixels.length,
      inkPixels,
    };
  });
}
const summary = (inspection: Awaited<ReturnType<typeof inspect>>) => ({
  fields: inspection.fields,
  grouping: inspection.grouping,
});

async function withFieldWorker<T>(
  use: (request: (input: FieldRequest) => Promise<FieldResult>) => Promise<T>
) {
  const worker = new Worker(new URL("./pdfium-fields-worker.ts", import.meta.url), {
    type: "module",
  });
  let failed = false;
  const request = (input: FieldRequest): Promise<FieldResult> =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        failed = true;
        reject(new Error("Field probe response timed out."));
      }, 30_000);
      worker.onmessage = (event) => {
        clearTimeout(timeout);
        if (event.data.error) reject(new Error(event.data.error));
        else resolve(event.data.result);
      };
      worker.onerror = (event) => {
        failed = true;
        clearTimeout(timeout);
        reject(new Error(event.message));
      };
      worker.onmessageerror = () => {
        failed = true;
        clearTimeout(timeout);
        reject(new Error("Could not read field probe response."));
      };
      worker.postMessage(input);
    });
  const dispose = async () => {
    if ((await request({ command: "dispose" })).kind !== "disposed")
      throw new Error("Thread shutdown not acknowledged.");
  };
  try {
    return await use(request);
  } finally {
    try {
      if (!failed) await dispose();
    } finally {
      worker.terminate();
    }
  }
}

export async function checkFieldImport() {
  const sources = [await sharedFieldSource("First"), await sharedFieldSource("Second")];
  const files = sources.map(
    (bytes, index) => new File([bytes], `fields-${index + 1}.pdf`, { type: "application/pdf" })
  );
  const service = new PDFService();
  const operations = new PDFOperationsService(service);
  const sourceInspections = await Promise.all(sources.map(inspect));
  const baselineByScenario = new Map<string, Uint8Array<ArrayBuffer>>();
  try {
    for (const scenario of fieldScenarios) {
      // Exercise today's actual cache + per-page copyPages + save path, rather
      // than an approximation that could accidentally preserve more than main.
      const output = await Effect.runPromise(
        operations.buildPDF(
          scenario.pages.map((page, index) => ({
            id: String(index),
            sourceFile: files[page.source],
            sourcePageNumber: page.page,
            markedForDeletion: false,
            rotation: 0,
          }))
        )
      );
      baselineByScenario.set(scenario.name, new Uint8Array(output.data));
    }
  } finally {
    await Effect.runPromise(operations.dispose());
    await Effect.runPromise(service.dispose());
  }
  return withFieldWorker(async (request) => {
    const rows = [];
    for (const scenario of fieldScenarios) {
      const variants: FieldVariant[] = ["plain", "repair-0", "repair-1"];
      if (scenario.name !== "merge-two") variants.push("single-call");
      if (scenario.name === "full") variants.push("direct-save", "model-adoption");
      const response = await request({
        command: "probe",
        sources,
        pages: scenario.pages,
        variants,
      });
      if (
        response.kind !== "outputs" ||
        !response.closedBeforeResponse ||
        response.openedDocuments !== response.closedDocuments
      )
        throw new Error("Native document ownership did not finish before independent reopen.");
      // The worker responds only AFTER all source/output handles are closed.
      // All following metadata, grouping and pixel evidence reads saved bytes.
      const baselineBytes = baselineByScenario.get(scenario.name);
      if (!baselineBytes) throw new Error("Missing main baseline.");
      const baseline = await inspect(baselineBytes);
      const expectedFields = scenario.pages.map(
        (page) => sourceInspections[page.source].fields[page.page - 1]
      );
      const outputs = [];
      for (const output of response.outputs) {
        const actual = await inspect(output.bytes);
        outputs.push({
          variant: output.variant,
          ...summary(actual),
          appearance: appearance(actual, baseline),
          diagnostics: output.diagnostics,
          bytes: output.bytes.length,
        });
      }
      const { outputs: _savedBytes, ...lifetime } = response;
      rows.push({
        scenario: scenario.name,
        expectedFields,
        baseline: summary(baseline),
        outputs,
        lifetime,
      });
    }
    return { sourceGroups: sourceInspections.map((source) => source.grouping), rows };
  });
}
