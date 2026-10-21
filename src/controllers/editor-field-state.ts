import type { FieldAnswer, PageState } from "../types/interfaces";

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
  value: string
): PageState[] {
  const page = pages.find((candidate) => candidate.id === pageId);
  if (!page) return [...pages];
  return pages.map((candidate) => {
    if (candidate.sourceFile !== page.sourceFile || candidate.fieldGroupId !== page.fieldGroupId)
      return candidate;
    const answers = copyFieldAnswers(candidate.fieldAnswers) ?? [];
    const index = answers.findIndex((answer) => answer.fieldRef === fieldRef);
    if (index < 0) answers.push({ fieldRef, value });
    else answers[index] = { fieldRef, value };
    return { ...candidate, fieldAnswers: answers };
  });
}
