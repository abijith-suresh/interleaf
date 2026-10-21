import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  type PDFObject,
  PDFRawStream,
  PDFString,
} from "pdf-lib";

const N = PDFName.of;
function appearance(doc: PDFDocument, value: PDFObject | undefined): unknown {
  const object = doc.context.lookup(value);
  if (object instanceof PDFRawStream) return Array.from(decodePDFRawStream(object).decode());
  if (object instanceof PDFDict)
    return Object.fromEntries(
      object.entries().map(([key, item]) => [key.toString(), appearance(doc, item)])
    );
  return object?.toString();
}
export async function inspectExport(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const widgetOwners = new Map<PDFDict, number>();
  const annotations = doc.getPages().map((page, index) =>
    (page.node.Annots()?.asArray() ?? []).map((raw) => {
      const annotation = doc.context.lookup(raw, PDFDict);
      widgetOwners.set(annotation, index);
      return annotation;
    })
  );
  const allAnnotations = annotations.flat();
  const pages = doc.getPages().map((page, index) => ({
    rotation: page.getRotation().angle,
    crop: page.getCropBox(),
    media: page.getMediaBox(),
    unit: page.node.get(N("UserUnit"))?.toString(),
    annotations: annotations[index].map((annotation) => {
      const names: string[] = [];
      let type: string | undefined, value: string | undefined, flags: string | undefined;
      let current: PDFDict | undefined = annotation;
      const seen = new Set<PDFDict>();
      while (current) {
        if (seen.has(current)) throw Error("Cyclic field in inspection");
        seen.add(current);
        const name = current.lookup(N("T"));
        if (name instanceof PDFString || name instanceof PDFHexString)
          names.unshift(name.decodeText());
        type ??= current.get(N("FT"))?.toString();
        const v = current.lookup(N("V"));
        value ??=
          v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : v?.toString();
        flags ??= current.get(N("Ff"))?.toString();
        current = current.lookupMaybe(N("Parent"), PDFDict);
      }
      const parent = annotation.lookupMaybe(N("Parent"), PDFDict);
      return {
        name: names.join("."),
        type,
        value,
        flags,
        annotationFlags: annotation.get(N("F"))?.toString(),
        rect: annotation.get(N("Rect"))?.toString(),
        ap: appearance(doc, annotation.get(N("AP"))),
        ownerCorrect: annotation.get(N("P")) === page.ref,
        siblings: parent
          ?.lookupMaybe(N("Kids"), PDFArray)
          ?.asArray()
          .map((kid) => allAnnotations.indexOf(doc.context.lookup(kid, PDFDict))),
      };
    }),
  }));
  const objects = doc.context.enumerateIndirectObjects();
  const serialized = objects
    .map(([, object]) =>
      object instanceof PDFRawStream
        ? new TextDecoder("latin1").decode(decodePDFRawStream(object).decode())
        : object.toString()
    )
    .join("\n");
  const widgetObjects = objects.filter(
    ([, object]) => object instanceof PDFDict && object.lookup(N("Subtype")) === N("Widget")
  ).length;
  const pageObjects = objects.filter(
    ([, object]) => object instanceof PDFDict && object.lookup(N("Type")) === N("Page")
  ).length;
  const orphanKids = pages.flatMap((p) => p.annotations).some((a) => a.siblings?.includes(-1));
  return {
    pages,
    pageObjects,
    widgetObjects,
    orphanKids,
    serialized,
    hasAcroForm: doc.catalog.has(N("AcroForm")),
  };
}
export function retainedMetadata(result: Awaited<ReturnType<typeof inspectExport>>) {
  return result.pages.map((page) => ({
    ...page,
    annotations: page.annotations.map(({ ownerCorrect, siblings, ...annotation }) => annotation),
  }));
}
