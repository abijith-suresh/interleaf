import type { PageState } from "../types/interfaces";

export function hasPageAdditions(
  page: Pick<PageState, "addedText" | "addedCheckmarks" | "fieldAnswers">
): boolean {
  return Boolean(
    page.addedText?.length || page.addedCheckmarks?.length || page.fieldAnswers?.length
  );
}

export type PageToolMode = "read" | "place" | "edit" | "fields";
export type PageTool = "read" | "text" | "checkmark" | "fields" | "edit";

/**
 * The one tool that page-tool buttons show as pressed. An open new draft keeps its
 * own kind pressed, an open saved addition keeps editing pressed, and editing with
 * nothing left to edit reads as Read.
 */
export function activePageTool(state: {
  mode: PageToolMode;
  placing: "text" | "checkmark";
  draft?: { kind: "text" | "checkmark"; saved: boolean };
  additions: number;
}): PageTool {
  if (state.mode === "read" || state.mode === "fields") return state.mode;
  if (state.draft) return state.draft.saved ? "edit" : state.draft.kind;
  if (state.mode === "place") return state.placing;
  return state.additions ? "edit" : "read";
}
