import {
  PDFAcroText,
  PDFArray,
  PDFDict,
  type PDFDocument,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  type PDFObject,
  PDFRef,
  PDFStream,
  PDFString,
  PDFTextField,
  StandardFonts,
} from "pdf-lib";
import type { FieldAnswer, PDFFields, TextFieldWidget } from "../types/interfaces";

const N = PDFName.of;
const LATIN = /^[\x20-\x7e]*$/;
const ALLOWED_FLAGS = 2 | 4 | 0x400000 | 0x800000;
const UNAVAILABLE = "This field is read-only in the editor.";
const FONT_SIZE = 12;

// Optional resolved null is absence, including indirect null. Never confuse an
// explicit empty string or zero with absence. Walk library objects, not PDF syntax.
function value(dict: PDFDict, key: string): PDFObject | undefined {
  let result = dict.get(N(key), true);
  const seen = new Set<PDFRef>();
  while (result instanceof PDFRef) {
    if (seen.has(result) || seen.size >= 32) throw Error("Cyclic field reference.");
    seen.add(result);
    result = dict.context.lookup(result);
    if (result === undefined) throw Error("Missing field reference.");
  }
  return result === PDFNull ? undefined : result;
}
function dictionary(dict: PDFDict, key: string): PDFDict | undefined {
  const result = value(dict, key);
  if (result !== undefined && !(result instanceof PDFDict)) throw Error(`Invalid field ${key}.`);
  return result;
}
function array(dict: PDFDict, key: string): PDFArray | undefined {
  const result = value(dict, key);
  if (result !== undefined && !(result instanceof PDFArray)) throw Error(`Invalid field ${key}.`);
  return result;
}
function lineage(dict: PDFDict): PDFDict[] {
  const chain: PDFDict[] = [];
  let current: PDFDict | undefined = dict;
  while (current) {
    if (chain.includes(current) || chain.length >= 32) throw Error("Cyclic field parent.");
    chain.push(current);
    const parent = dictionary(current, "Parent");
    if (
      parent &&
      !array(parent, "Kids")
        ?.asArray()
        .some((raw) => parent.context.lookup(raw) === current)
    )
      throw Error("Inconsistent field ownership.");
    current = parent;
  }
  return chain;
}
function inherited(chain: PDFDict[], key: string): PDFObject | undefined {
  for (const node of chain) {
    const result = value(node, key);
    if (result !== undefined) return result;
  }
}
function number(raw: PDFObject | undefined, fallback: number): number;
function number(raw: PDFObject | undefined): number | undefined;
function number(raw: PDFObject | undefined, fallback?: number): number | undefined {
  if (raw === undefined) return fallback;
  if (!(raw instanceof PDFNumber) || !Number.isFinite(raw.asNumber()))
    throw Error("Invalid field number.");
  return raw.asNumber();
}
function string(raw: PDFObject | undefined): string {
  if (raw === undefined) return "";
  if (!(raw instanceof PDFString || raw instanceof PDFHexString))
    throw Error("Invalid field text.");
  return raw.decodeText();
}
interface Widget {
  dict: PDFDict;
  ref: PDFRef;
  page: number;
  rect: [number, number, number, number];
  width: number;
  height: number;
  fontSize: number;
}
interface Field {
  dict: PDFDict;
  ref: PDFRef;
  widgets: Widget[];
  label: string;
  text: string;
  maxLength?: number;
  alignment: number;
  reason?: string;
}

function scan(doc: PDFDocument): { fields: Field[]; reason?: string } {
  if (doc.isEncrypted)
    return {
      fields: [],
      reason: "Embedded filling is unavailable for protected PDFs. Use Add text.",
    };
  const form = dictionary(doc.catalog, "AcroForm");
  if (!form) return { fields: [] };
  if (
    value(form, "XFA") ||
    (array(form, "CO")?.size() ?? 0) > 0 ||
    value(doc.catalog, "AA") ||
    value(doc.catalog, "OpenAction") ||
    value(dictionary(doc.catalog, "Names") ?? doc.catalog, "JavaScript")
  )
    return { fields: [], reason: "Embedded filling is unavailable for this form. Use Add text." };
  const pageWidgets = new Map<
    PDFDict,
    { ref: PDFRef; page: number; unit: number; bounds: readonly number[] }
  >();
  for (const [index, page] of doc.getPages().entries()) {
    if (value(page.node, "AA"))
      return { fields: [], reason: "Embedded filling is unavailable for this form. Use Add text." };
    const unit = number(value(page.node, "UserUnit"), 1);
    const crop = page.getCropBox(),
      media = page.getMediaBox();
    const bounds = [
      Math.max(crop.x, media.x),
      Math.max(crop.y, media.y),
      Math.min(crop.x + crop.width, media.x + media.width),
      Math.min(crop.y + crop.height, media.y + media.height),
    ];
    for (const raw of array(page.node, "Annots")?.asArray() ?? []) {
      const annot = doc.context.lookup(raw);
      if (!(annot instanceof PDFDict)) throw Error("Invalid page annotation.");
      if (value(annot, "Subtype") !== N("Widget")) continue;
      if (!(raw instanceof PDFRef) || pageWidgets.has(annot))
        throw Error("Ambiguous widget ownership.");
      const p = value(annot, "P");
      if (p !== undefined && p !== page.node) throw Error("Inconsistent widget page.");
      pageWidgets.set(annot, { ref: raw, page: index + 1, unit, bounds });
    }
  }
  const seen = new Set<PDFDict>();
  const owned = new Set<PDFDict>();
  const fields: Field[] = [];
  const stack = [...(array(form, "Fields")?.asArray() ?? [])].map((raw) => ({
    raw,
    parent: undefined as PDFDict | undefined,
  }));
  while (stack.length) {
    const entry = stack.pop();
    if (!entry) break;
    const dict = doc.context.lookup(entry.raw);
    if (
      !(entry.raw instanceof PDFRef) ||
      !(dict instanceof PDFDict) ||
      seen.has(dict) ||
      seen.size >= 10000
    )
      throw Error("Invalid field tree.");
    seen.add(dict);
    if (dictionary(dict, "Parent") !== entry.parent) throw Error("Inconsistent field parent.");
    const chain = lineage(dict);
    const kids = array(dict, "Kids")?.asArray() ?? [];
    const isWidget = (raw: PDFObject) => {
      const child = doc.context.lookup(raw);
      if (!(child instanceof PDFDict)) throw Error("Invalid field child.");
      return value(child, "Subtype") === N("Widget") && value(child, "T") === undefined;
    };
    if (kids.length && !kids.every(isWidget)) {
      if (kids.some(isWidget)) throw Error("Mixed field ownership.");
      for (const raw of kids) stack.push({ raw, parent: dict });
      continue;
    }
    const type = inherited(chain, "FT");
    if (!(type instanceof PDFName)) throw Error("Missing field type.");
    if (type === N("Sig") && inherited(chain, "V") !== undefined)
      return {
        fields: [],
        reason: "Embedded filling is unavailable for signed PDFs. Use Add text.",
      };
    const field: Field = {
      dict,
      ref: entry.raw,
      widgets: [],
      alignment: 0,
      label:
        chain
          .toReversed()
          .map((node) => string(value(node, "T")))
          .filter(Boolean)
          .join(".") || "Text field",
      text: "",
    };
    try {
      const flags = number(inherited(chain, "Ff"), 0);
      if (
        !Number.isSafeInteger(flags) ||
        flags < 0 ||
        flags > 0xffffffff ||
        (flags & ~ALLOWED_FLAGS) !== 0 ||
        type !== N("Tx")
      )
        field.reason = UNAVAILABLE;
      if (chain.some((node) => value(node, "A") || value(node, "AA") || value(node, "RV")))
        field.reason = UNAVAILABLE;
      field.text = type === N("Tx") ? string(inherited(chain, "V")) : "";
      if (!LATIN.test(field.text)) field.reason = "This field uses unsupported text.";
      const maximum = number(inherited(chain, "MaxLen"));
      if (maximum !== undefined && (!Number.isSafeInteger(maximum) || maximum <= 0))
        throw Error("Invalid text length limit.");
      field.maxLength = maximum;
      field.alignment = number(inherited(chain, "Q"), 0);
      if (![0, 1, 2].includes(field.alignment)) throw Error("Invalid text alignment.");
      // Check inherited optional text attributes even though the edited appearance
      // deliberately uses the documented Helvetica fallback.
      for (const key of ["DV", "DA"]) {
        const raw = inherited(chain, key) ?? (key === "DA" ? value(form, key) : undefined);
        if (raw !== undefined) string(raw);
      }
    } catch {
      field.reason = UNAVAILABLE;
    }
    for (const raw of kids.length ? kids : [entry.raw]) {
      const widget = doc.context.lookup(raw);
      if (!(widget instanceof PDFDict) || owned.has(widget))
        throw Error("Ambiguous terminal field.");
      owned.add(widget);
      const owner = pageWidgets.get(widget);
      if (!owner || !(raw instanceof PDFRef)) throw Error("Unowned field widget.");
      if (widget !== dict && dictionary(widget, "Parent") !== dict)
        throw Error("Inconsistent terminal ownership.");
      let rect: Widget["rect"] = [0, 0, 0, 0];
      let width = 0,
        height = 0;
      try {
        const coordinates = array(widget, "Rect");
        if (coordinates?.size() !== 4) throw Error("Invalid widget rectangle.");
        rect = coordinates
          .asArray()
          .map((raw) => number(doc.context.lookup(raw)) ?? Number.NaN) as Widget["rect"];
        if (
          owner.bounds.some((n) => !Number.isFinite(n)) ||
          rect[0] < owner.bounds[0] ||
          rect[1] < owner.bounds[1] ||
          rect[2] > owner.bounds[2] ||
          rect[3] > owner.bounds[3] ||
          rect.some((n) => !Number.isFinite(n)) ||
          rect[2] <= rect[0] ||
          rect[3] <= rect[1] ||
          !Number.isFinite(owner.unit) ||
          owner.unit <= 0
        )
          throw Error("Invalid widget bounds.");
        const flags = number(value(widget, "F"), 0);
        if (flags !== 4 || value(widget, "A") || value(widget, "AA")) field.reason = UNAVAILABLE;
        const mk = dictionary(widget, "MK");
        const turn = number(mk ? value(mk, "R") : undefined, 0);
        if (![0, 90, 180, 270].includes(turn)) throw Error("Unsupported widget rotation.");
        for (const key of ["BC", "BG"]) {
          const colors = mk && array(mk, key);
          if (
            colors &&
            (![0, 1, 3, 4].includes(colors.size()) ||
              colors.asArray().some((raw) => {
                const n = number(doc.context.lookup(raw));
                return n === undefined || n < 0 || n > 1;
              }))
          )
            throw Error("Invalid field color.");
        }
        const bs = dictionary(widget, "BS");
        const border = number(bs ? value(bs, "W") : undefined, 0);
        if (border < 0 || border > Math.min(rect[2] - rect[0], rect[3] - rect[1]) / 2)
          throw Error("Invalid field border.");
        const ap = dictionary(widget, "AP");
        const normal = ap && value(ap, "N");
        if (normal !== undefined && !(normal instanceof PDFStream))
          throw Error("Unsupported text appearance.");
        const da = value(widget, "DA");
        if (da !== undefined) string(da);
        width = (turn % 180 ? rect[3] - rect[1] : rect[2] - rect[0]) - 2 * (border + 1);
        height = (turn % 180 ? rect[2] - rect[0] : rect[3] - rect[1]) - 2 * (border + 1);
        if (width <= 0 || height <= 0) throw Error("Empty widget bounds.");
      } catch {
        field.reason = UNAVAILABLE;
      }
      field.widgets.push({
        dict: widget,
        ref: raw,
        page: owner.page,
        rect,
        width,
        height,
        fontSize: FONT_SIZE / owner.unit,
      });
    }
    fields.push(field);
  }
  if ([...pageWidgets.keys()].some((widget) => !owned.has(widget)))
    throw Error("Widget missing from field tree.");
  return { fields };
}

export function inspectPDFFields(doc: PDFDocument): PDFFields {
  const result = scan(doc);
  return {
    reason: result.reason,
    widgets: result.fields.flatMap((field) =>
      field.widgets.map(
        (widget): TextFieldWidget => ({
          widgetRef: widget.ref.toString(),
          fieldRef: field.ref.toString(),
          pageNumber: widget.page,
          label: field.label,
          value: field.text,
          rect: widget.rect,
          maxLength: field.maxLength,
          reason: field.reason,
        })
      )
    ),
  };
}

export async function applyFieldAnswers(
  doc: PDFDocument,
  answers: readonly FieldAnswer[],
  pageNumbers: readonly number[]
) {
  if (!answers.length) return;
  const result = scan(doc);
  if (result.reason) throw Error(result.reason);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pending: Field[] = [];
  const seen = new Set<string>();
  for (const answer of answers) {
    if (seen.has(answer.fieldRef)) throw Error("Duplicate field answer.");
    seen.add(answer.fieldRef);
    const field = result.fields.find((field) => field.ref.toString() === answer.fieldRef);
    if (!field || field.reason) throw Error(field?.reason ?? "This field is unavailable.");
    if (!LATIN.test(answer.value)) throw Error("Use one line of basic Latin text.");
    if (field.maxLength !== undefined && answer.value.length > field.maxLength)
      throw Error(`Use at most ${field.maxLength} characters.`);
    for (const widget of field.widgets.filter((widget) => pageNumbers.includes(widget.page))) {
      if (
        answer.value.length > 0 &&
        (font.widthOfTextAtSize(answer.value, widget.fontSize) > widget.width ||
          font.heightAtSize(widget.fontSize, { descender: true }) > widget.height)
      )
        throw Error("The answer does not fit every linked field. Use shorter text.");
    }
    pending.push(field);
  }
  // Validate the whole transaction first. Explicit empty V shadows inherited V.
  for (const [index, field] of pending.entries()) {
    const text = PDFTextField.of(PDFAcroText.fromDict(field.dict, field.ref), field.ref, doc);
    text.acroField.dict.set(N("FT"), N("Tx"));
    text.acroField.setValue(PDFHexString.fromText(answers[index].value));
    text.acroField.dict.set(N("Q"), PDFNumber.of(field.alignment));
    text.acroField.setDefaultAppearance(`/Helvetica ${FONT_SIZE} Tf 0 g`);
    for (const widget of field.widgets)
      widget.dict.set(N("DA"), PDFString.of(`/Helvetica ${widget.fontSize} Tf 0 g`));
    text.updateAppearances(font);
  }
}
