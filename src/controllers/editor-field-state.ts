import type { FieldAnswer, PageGeometry, PageState, TextFieldWidget } from "../types/interfaces";
import { pdfToViewport } from "./text-geometry";

export function copyFieldAnswers(answers: readonly FieldAnswer[] | undefined) {
  return answers?.map(({ fieldRef, value }) => ({ fieldRef, value }));
}

export function equalFieldAnswers(a: readonly FieldAnswer[] = [], b: readonly FieldAnswer[] = []) {
  return (
    a.length === b.length &&
    a.every(
      (answer, index) => answer.fieldRef === b[index].fieldRef && answer.value === b[index].value
    )
  );
}

// All original logical pages, including marked pages, participate in one transaction.
export function answerField(
  pages: readonly PageState[],
  pageId: string,
  fieldRef: string,
  value: string,
  originalValue?: string
): PageState[] {
  const page = pages.find((candidate) => candidate.id === pageId);
  if (!page) return [...pages];
  return pages.map((candidate) => {
    if (candidate.sourceFile !== page.sourceFile || candidate.fieldGroupId !== page.fieldGroupId)
      return candidate;
    const answers = copyFieldAnswers(candidate.fieldAnswers) ?? [];
    const index = answers.findIndex((answer) => answer.fieldRef === fieldRef);
    // Re-entering the PDF's own value with no stored answer changes nothing visible.
    if (index < 0 && value === originalValue) return candidate;
    if (index < 0) answers.push({ fieldRef, value });
    else answers[index] = { fieldRef, value };
    return { ...candidate, fieldAnswers: answers };
  });
}

/**
 * Orders widgets for field navigation: by page, then by visual rows from top to
 * bottom, then left to right. Positions are taken in the rotated page view, and
 * widgets whose tops differ by less than half the shorter height share a row.
 */
export function orderFieldWidgets<T extends TextFieldWidget>(
  widgets: readonly T[],
  geometry: PageGeometry,
  rotation: number
): T[] {
  const boxes = widgets.map((widget) => {
    const a = pdfToViewport(geometry, rotation, widget.rect[0], widget.rect[1]);
    const b = pdfToViewport(geometry, rotation, widget.rect[2], widget.rect[3]);
    return {
      widget,
      top: Math.min(a.y, b.y),
      left: Math.min(a.x, b.x),
      height: Math.abs(b.y - a.y),
    };
  });
  boxes.sort(
    (a, b) => a.widget.pageNumber - b.widget.pageNumber || a.top - b.top || a.left - b.left
  );
  const rows: (typeof boxes)[] = [];
  for (const box of boxes) {
    const row = rows.at(-1);
    const first = row?.[0];
    if (
      row &&
      first &&
      first.widget.pageNumber === box.widget.pageNumber &&
      box.top - first.top < Math.min(first.height, box.height) / 2
    )
      row.push(box);
    else rows.push([box]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.left - b.left).map((box) => box.widget));
}
