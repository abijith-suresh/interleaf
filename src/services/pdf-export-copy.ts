import {
  PDFArray,
  PDFDict,
  type PDFDocument,
  PDFHexString,
  PDFInvalidObject,
  PDFName,
  PDFNull,
  PDFNumber,
  type PDFObject,
  type PDFPage,
  PDFPageLeaf,
  PDFRef,
  PDFStream,
  PDFString,
} from "pdf-lib";

import { PDFProcessingError } from "../types/interfaces";
import { processingError } from "./pdf-errors";

const N = PDFName.of;
// Walk native objects only. Identity sets bound cycles without interpreting PDF syntax.
function objects(doc: PDFDocument, roots: PDFObject[]): Set<PDFObject> {
  const seen = new Set<PDFObject>();
  const stack = [...roots];
  while (stack.length) {
    const o = stack.pop();
    if (!o) break;
    if (seen.has(o)) continue;
    seen.add(o);
    if (o instanceof PDFRef) {
      const target = doc.context.lookup(o);
      if (target) stack.push(target);
      else throw Error(`Missing PDF reference ${o}`);
    } else if (o instanceof PDFDict) stack.push(...o.values());
    else if (o instanceof PDFArray) stack.push(...o.asArray());
    else if (o instanceof PDFStream) stack.push(o.dict);
    else if (o instanceof PDFInvalidObject)
      throw Error("Opaque invalid PDF object cannot be reconciled");
  }
  return seen;
}
function resolvedValue(dict: PDFDict, key: PDFName, required = false): PDFObject | undefined {
  let value = dict.get(key, true);
  if (value === undefined && !required) return undefined;
  const seen = new Set<PDFRef>();
  while (value instanceof PDFRef) {
    if (seen.has(value) || seen.size >= 32)
      throw Error(`Cyclic or excessive PDF name references at ${key}`);
    seen.add(value);
    value = dict.context.lookup(value);
  }
  if (value === undefined) throw Error(`Missing PDF name ${key}`);
  return value;
}
function resolvedName(dict: PDFDict, key: PDFName, required = false): PDFName | undefined {
  const value = resolvedValue(dict, key, required);
  if (value !== undefined && !(value instanceof PDFName)) throw Error(`Invalid PDF name ${key}`);
  return value;
}

// PDF.js can recognize page roles that pdf-lib's parser omits. Never index a
// filtered library page list until its refs match the actual source page tree.
export function validatePDFSourcePages(doc: PDFDocument, file: File): void {
  try {
    type Branch = { declared: number; total: number; parent?: Branch };
    const branches: Branch[] = [];
    const stack: { raw: PDFObject | undefined; depth: number; parent?: Branch }[] = [
      { raw: doc.catalog.get(N("Pages")), depth: 0 },
    ];
    const seen = new Set<PDFDict>(),
      refs: PDFRef[] = [];
    while (stack.length) {
      const entry = stack.pop();
      if (!entry) break;
      if (entry.depth > 32) throw Error("Excessive source page-tree depth");
      const node = doc.context.lookup(entry.raw);
      if (!(node instanceof PDFDict)) throw Error("Invalid source page-tree node");
      if (seen.has(node)) throw Error("Repeated or cyclic source page-tree node");
      seen.add(node);
      const role = resolvedName(node, N("Type"), true);
      if (role === N("Page")) {
        if (!(entry.raw instanceof PDFRef))
          throw Error("Unsupported direct source Page dictionary");
        refs.push(entry.raw);
        if (entry.parent) entry.parent.total++;
      } else if (role === N("Pages")) {
        const count = resolvedValue(node, N("Count"), true);
        if (
          !(count instanceof PDFNumber) ||
          !Number.isSafeInteger(count.asNumber()) ||
          count.asNumber() < 0
        )
          throw Error("Invalid source Pages Count");
        const branch: Branch = { declared: count.asNumber(), total: 0, parent: entry.parent };
        branches.push(branch);
        const kids = node.lookup(N("Kids"), PDFArray);
        for (let index = kids.size() - 1; index >= 0; index--)
          stack.push({ raw: kids.get(index), depth: entry.depth + 1, parent: branch });
      } else throw Error("Invalid source page-tree role");
    }
    // Count must agree at every subtree: PDF.js uses it to skip branches.
    // Compute totals from actual leaves only, never from declared counts.
    for (let index = branches.length - 1; index >= 0; index--) {
      const branch = branches[index];
      if (!Number.isSafeInteger(branch.total) || branch.total !== branch.declared)
        throw Error("Source Pages Count differs from actual descendant pages");
      if (branch.parent) branch.parent.total += branch.total;
    }
    const indexed = doc.getPages();
    if (refs.length !== indexed.length || refs.some((ref, index) => ref !== indexed[index].ref))
      throw Error("Source page-tree refs differ from pdf-lib indexed page order");
  } catch (cause) {
    throw new PDFProcessingError({
      operation: "reconcile-export",
      file,
      cause,
      message: "This PDF's page order cannot be safely copied.",
    });
  }
}

export interface PDFExportSource {
  file: File;
  doc: PDFDocument;
  scope?: string;
}
// One instance owns one output. Each copyPages call keeps a separate copier namespace.
// Only fresh private source documents may be passed in: tagging must never touch the cache.
export class PDFExportCopy {
  private readonly sources = new Map<File, Map<string, PDFExportSource>>();
  private readonly first = new Map<number, PDFPage>();
  private readonly owner = new Map<PDFDict, PDFExportSource>();
  private readonly identities = new Map<number, { file: File; ref: PDFRef }>();
  private readonly key: PDFName;
  constructor(
    private readonly output: PDFDocument,
    sources: PDFExportSource[]
  ) {
    for (const source of sources) validatePDFSourcePages(source.doc, source.file);
    const dicts = sources.flatMap((s) =>
      [
        ...objects(
          s.doc,
          s.doc.context.enumerateIndirectObjects().map(([, o]) => o)
        ),
      ].filter((o): o is PDFDict => o instanceof PDFDict)
    );
    let suffix = 0;
    while (dicts.some((d) => d.get(N(`InterleafExportPage${suffix}`), true) !== undefined))
      suffix++;
    this.key = N(`InterleafExportPage${suffix}`);
    let id = 1_000_000_000_000;
    for (const source of sources) {
      const scopes = this.sources.get(source.file) ?? new Map<string, PDFExportSource>();
      scopes.set(source.scope ?? "", source);
      this.sources.set(source.file, scopes);
      for (const page of source.doc.getPages()) {
        page.node.set(this.key, PDFNumber.of(id));
        this.identities.set(id++, { file: source.file, ref: page.ref });
      }
    }
  }
  async copy(file: File, pageNumber: number, scope = "") {
    const source = this.sources.get(file)?.get(scope);
    if (!source) throw Error("The export source is unavailable.");
    const [page] = await this.output.copyPages(source.doc, [pageNumber - 1]);
    for (const o of objects(this.output, [page.node]))
      if (o instanceof PDFDict) this.owner.set(o, source);
    const id = page.node.lookup(this.key, PDFNumber).asNumber();
    // Answers have separate source scopes; simple navigation still targets the
    // first retained logical occurrence of the original File/page reference.
    const identity = this.identities.get(id);
    if (!identity) throw Error("Missing export page identity.");
    for (const [candidate, target] of this.identities)
      if (target.file === file && target.ref === identity.ref && !this.first.has(candidate))
        this.first.set(candidate, page);
    return page;
  }
  private reject(file: File | undefined, message: string): never {
    const cause = new Error(message);
    throw file ? processingError("reconcile-export", file, cause) : cause;
  }
  private name(dict: PDFDict, key: PDFName, required = false): PDFName | undefined {
    try {
      return resolvedName(dict, key, required);
    } catch (cause) {
      const file = this.owner.get(dict)?.file;
      throw file ? processingError("reconcile-export", file, cause) : cause;
    }
  }
  private isPage(dict: PDFDict): boolean {
    if (dict instanceof PDFPageLeaf || dict.has(this.key))
      return this.name(dict, N("Type"), true) === N("Page");
    // A resource/state lookup map may itself have a key named Type. Only a
    // resolved Page name identifies an otherwise unknown dictionary as a Page.
    return resolvedValue(dict, N("Type")) === N("Page");
  }
  // Optional action slots treat resolved null as absent. Keep this separate
  // from required role/count resolution and field inheritance.
  private actionValue(raw: PDFObject | undefined): PDFObject | undefined {
    let value = raw;
    const seen = new Set<PDFRef>();
    while (value instanceof PDFRef) {
      if (seen.has(value) || seen.size >= 32)
        throw Error("Cyclic or excessive PDF action references");
      seen.add(value);
      value = this.output.context.lookup(value);
      if (value === undefined) throw Error("Missing PDF action reference");
    }
    return value === PDFNull ? undefined : value;
  }
  private named(source: PDFExportSource, name: string): PDFObject | undefined {
    const legacy = source.doc.catalog.lookupMaybe(N("Dests"), PDFDict)?.get(N(name));
    if (legacy) return legacy;
    const root = source.doc.catalog.lookupMaybe(N("Names"), PDFDict)?.get(N("Dests"));
    if (!root) return undefined;
    const seen = new Set<PDFDict>();
    const stack = [root];
    while (stack.length) {
      const node = source.doc.context.lookup(stack.pop());
      if (!(node instanceof PDFDict)) this.reject(source.file, "Invalid destination name tree");
      if (seen.has(node)) this.reject(source.file, "Cyclic destination name tree");
      seen.add(node);
      const names = node.lookupMaybe(N("Names"), PDFArray);
      if (names) {
        if (names.size() % 2) this.reject(source.file, "Invalid destination names");
        for (let i = 0; i < names.size(); i += 2) {
          const key = names.lookup(i);
          if (!(key instanceof PDFString || key instanceof PDFHexString))
            this.reject(source.file, "Invalid destination name");
          if (key.decodeText() === name) return names.get(i + 1);
        }
      }
      const kids = node.lookupMaybe(N("Kids"), PDFArray);
      if (kids) stack.push(...kids.asArray());
    }
    return undefined;
  }
  private destination(dict: PDFDict, raw: PDFObject | undefined): PDFArray | undefined {
    const source = this.owner.get(dict);
    if (!source) throw Error("The internal destination has no source identity.");
    let value = this.output.context.lookup(raw);
    const seen = new Set<PDFObject>();
    const names = new Set<string>();
    let foreign = false;
    for (;;) {
      if (!value) this.reject(source.file, "Missing internal destination");
      if (seen.has(value)) this.reject(source.file, "Cyclic internal destination");
      seen.add(value);
      if (value instanceof PDFName || value instanceof PDFString || value instanceof PDFHexString) {
        const name = value.decodeText();
        if (names.has(name)) this.reject(source.file, "Cyclic named destination");
        names.add(name);
        const named = this.named(source, name);
        if (!named) this.reject(source.file, `Unresolved named destination ${name}`);
        value = source.doc.context.lookup(named);
        foreign = true;
        continue;
      }
      if (value instanceof PDFDict) {
        value = (foreign ? source.doc.context : this.output.context).lookup(value.get(N("D")));
        continue;
      }
      if (!(value instanceof PDFArray) || value.size() < 2)
        this.reject(source.file, "Unsupported internal destination");
      const target = (foreign ? source.doc.context : this.output.context).lookup(value.get(0));
      if (!(target instanceof PDFDict))
        this.reject(source.file, "Internal destination has no source Page");
      const id = target.lookupMaybe(this.key, PDFNumber)?.asNumber();
      if (id === undefined || !this.identities.has(id))
        this.reject(source.file, "Unrecognized internal destination Page");
      const page = this.first.get(id);
      if (!page) return undefined;
      const context = foreign ? source.doc.context : this.output.context;
      const tail = value
        .asArray()
        .slice(1)
        .map((item) => context.lookup(item));
      if (
        tail.some(
          (v) => !(v instanceof PDFName || v instanceof PDFNumber || v?.toString() === "null")
        )
      )
        this.reject(source.file, "Unsupported internal destination operands");
      return this.output.context.obj([
        page.ref,
        ...tail.map((o) => {
          if (!o) this.reject(source.file, "Missing internal destination operand");
          return o.clone();
        }),
      ]);
    }
  }
  async finish() {
    // Embedded fonts/images may reserve references until flush completes.
    await this.output.flush();
    const actualPages = this.output.getPages();
    const actualSet = new Set<PDFDict>(actualPages.map((p) => p.node));
    // Build one ownership union before modifying any shared field dictionary.
    const keep = new Set<PDFDict>();
    const fields = new Set<PDFDict>();
    const annotationOwners = new Map<PDFDict, PDFPage>();
    for (const page of actualPages) {
      for (const raw of page.node.Annots()?.asArray() ?? []) {
        const annot = this.output.context.lookup(raw, PDFDict);
        const previous = annotationOwners.get(annot);
        if (previous && previous !== page)
          throw Error("One annotation belongs to multiple output pages");
        annotationOwners.set(annot, page);
        annot.set(N("P"), page.ref);
        if (this.name(annot, N("Subtype"), true) !== N("Widget")) continue;
        const seen = new Set<PDFDict>();
        let field: PDFDict | undefined = annot;
        while (field) {
          if (seen.has(field)) this.reject(this.owner.get(annot)?.file, "Cyclic PDF field parent");
          seen.add(field);
          keep.add(field);
          if (field.has(N("Kids"))) fields.add(field);
          const parent: PDFDict | undefined = field.lookupMaybe(N("Parent"), PDFDict);
          if (parent) {
            const siblings = parent.lookupMaybe(N("Kids"), PDFArray);
            if (!siblings?.asArray().some((kid) => this.output.context.lookup(kid) === field))
              throw Error("This PDF has inconsistent linked fields that cannot be preserved.");
          }
          field = parent;
        }
      }
    }
    for (const field of fields) {
      const kids = field.lookup(N("Kids"), PDFArray);
      const retained = kids
        .asArray()
        .filter((kid) => keep.has(this.output.context.lookup(kid, PDFDict)));
      for (const kid of retained) {
        if (this.output.context.lookup(kid, PDFDict).lookupMaybe(N("Parent"), PDFDict) !== field)
          throw Error("This PDF has inconsistent linked fields that cannot be preserved.");
      }
      if (retained.length !== kids.size()) {
        let type: PDFName | undefined;
        let opt: PDFObject | undefined;
        let ancestor: PDFDict | undefined = field;
        while (ancestor) {
          // Optional inherited null is absent; required page roles remain strict.
          const fieldType = resolvedValue(ancestor, N("FT"));
          if (fieldType !== undefined && fieldType !== PDFNull)
            type ??= this.name(ancestor, N("FT"));
          const options = resolvedValue(ancestor, N("Opt"));
          if (options !== PDFNull) opt ??= options;
          ancestor = ancestor.lookupMaybe(N("Parent"), PDFDict);
        }
        // Button /Opt entries correspond positionally to Kids. Pruning alone can
        // change a retained answer while leaving V, AS and AP bytes unchanged.
        if (type === N("Btn") && opt)
          this.reject(
            this.owner.get(field)?.file,
            "This PDF has linked choice fields that cannot be preserved in this export."
          );
        field.set(N("Kids"), this.output.context.obj(retained));
      }
    }
    let reachable = objects(
      this.output,
      Object.values(this.output.context.trailerInfo).filter((v): v is PDFObject => !!v)
    );
    // Actions start at known page/annotation/field entries. Resource and AP
    // lookup maps can have arbitrary keys, including S, A, Type and Next.
    const pendingActions: PDFObject[] = [];
    for (const semantic of new Set([...actualSet, ...annotationOwners.keys(), ...keep])) {
      const action = annotationOwners.has(semantic) ? semantic.get(N("A")) : undefined;
      if (action) pendingActions.push(action);
      const additional = this.actionValue(semantic.get(N("AA"), true));
      if (additional !== undefined && !(additional instanceof PDFDict))
        throw Error("Invalid PDF additional actions dictionary");
      if (additional) pendingActions.push(...additional.values());
    }
    const actions = new Set<PDFDict>();
    while (pendingActions.length) {
      const action = this.actionValue(pendingActions.pop());
      if (action === undefined) continue;
      if (!(action instanceof PDFDict)) throw Error("Invalid PDF action dictionary");
      if (actions.has(action)) continue;
      actions.add(action);
      this.name(action, N("S"), true);
      const next = this.actionValue(action.get(N("Next"), true));
      if (next instanceof PDFArray) pendingActions.push(...next.asArray());
      else if (next) pendingActions.push(next);
    }
    const removeActions = new Set<PDFDict>();
    for (const o of reachable) {
      if (!(o instanceof PDFDict)) continue;
      if (annotationOwners.has(o) && o.has(N("Dest"))) {
        const d = this.destination(o, o.get(N("Dest")));
        if (d) o.set(N("Dest"), d);
        else o.delete(N("Dest"));
      }
      if (actions.has(o) && this.name(o, N("S"), true) === N("GoTo")) {
        const d = this.destination(o, o.get(N("D")));
        if (d) o.set(N("D"), d);
        else {
          if (this.actionValue(o.get(N("Next"), true)) !== undefined)
            throw Error("Omitted-target GoTo with Next actions is unsupported");
          removeActions.add(o);
        }
      }
    }
    for (const o of reachable) {
      if (o instanceof PDFDict) {
        for (const [k, v] of o.entries())
          if (removeActions.has(this.output.context.lookup(v) as PDFDict)) o.delete(k);
      } else if (o instanceof PDFArray) {
        for (let i = o.size() - 1; i >= 0; i--)
          if (removeActions.has(this.output.context.lookup(o.get(i)) as PDFDict)) o.remove(i);
      }
    }
    reachable = objects(
      this.output,
      Object.values(this.output.context.trailerInfo).filter((v): v is PDFObject => !!v)
    );
    const replacement = (value: PDFObject, key: string): PDFObject => {
      const target = this.output.context.lookup(value);
      if (!(target instanceof PDFDict) || !this.isPage(target) || actualSet.has(target))
        return value;
      const id = target.lookupMaybe(this.key, PDFNumber)?.asNumber();
      const page = id === undefined ? undefined : this.first.get(id);
      if (!page)
        this.reject(this.owner.get(target)?.file, `Unsupported omitted Page reference at ${key}`);
      return page.ref;
    };
    for (const o of reachable) {
      if (o instanceof PDFDict) {
        for (const [k, v] of o.entries()) o.set(k, replacement(v, k.toString()));
      } else if (o instanceof PDFArray) {
        for (let i = 0; i < o.size(); i++) o.set(i, replacement(o.get(i), `array[${i}]`));
      }
    }
    // Remove provenance even from dictionaries that are about to become unreachable.
    const all = objects(
      this.output,
      this.output.context.enumerateIndirectObjects().map(([, o]) => o)
    );
    for (const o of all) if (o instanceof PDFDict) o.delete(this.key);
    await this.output.flush();
    reachable = objects(
      this.output,
      Object.values(this.output.context.trailerInfo).filter((v): v is PDFObject => !!v)
    );
    for (const o of reachable)
      if (o instanceof PDFDict && this.isPage(o) && !actualSet.has(o))
        throw Error("Unreconciled orphan Page");
    // pdf-lib serializes every registered object, including unreachable ones.
    for (const [ref] of this.output.context.enumerateIndirectObjects())
      if (!reachable.has(ref)) this.output.context.delete(ref);
  }
}
