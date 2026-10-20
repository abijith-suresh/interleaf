import type { PageState } from "../types/interfaces";

export function hasPageAdditions(page: Pick<PageState, "addedText" | "addedCheckmarks">): boolean {
  return Boolean(page.addedText?.length || page.addedCheckmarks?.length);
}
