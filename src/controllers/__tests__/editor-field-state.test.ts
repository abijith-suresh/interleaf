import { describe, expect, it } from "vitest";
import { hasPageAdditions } from "../editor-additions-state";
import { answerField } from "../editor-field-state";
import {
  emptyOrganizationHistory,
  recordOrganization,
  snapshotOrganization,
} from "../editor-history";
import { createPageStates } from "../editor-page-state";

describe("answerField", () => {
  const file = new File(["pdf"], "form.pdf", { type: "application/pdf" });

  it("stores nothing when the answer equals the PDF value and none is stored", () => {
    const pages = createPageStates(file, 2);
    const next = answerField(pages, pages[0].id, "name", "Ada", "Ada");
    expect(next).toEqual(pages);
    expect(next.some(hasPageAdditions)).toBe(false);

    const before = snapshotOrganization(pages, new Set(), pages[0].id);
    const after = snapshotOrganization(next, new Set(), pages[0].id);
    const history = recordOrganization(
      emptyOrganizationHistory(),
      "Fill text field",
      before,
      after
    );
    expect(history.undo).toHaveLength(0);
  });

  it("still records changed, cleared and restored answers", () => {
    let pages = createPageStates(file, 1);
    pages = answerField(pages, pages[0].id, "name", "Grace", "Ada");
    expect(pages[0].fieldAnswers).toEqual([{ fieldRef: "name", value: "Grace" }]);
    // Restoring the PDF value over a stored answer must overwrite it, not leave "Grace".
    pages = answerField(pages, pages[0].id, "name", "Ada", "Ada");
    expect(pages[0].fieldAnswers).toEqual([{ fieldRef: "name", value: "Ada" }]);
    // Clearing a field the PDF filled is a real answer.
    const fresh = createPageStates(file, 1);
    const cleared = answerField(fresh, fresh[0].id, "name", "", "Ada");
    expect(cleared[0].fieldAnswers).toEqual([{ fieldRef: "name", value: "" }]);
  });

  it("keeps recording when no original value is supplied", () => {
    const pages = createPageStates(file, 1);
    expect(answerField(pages, pages[0].id, "name", "", undefined)[0].fieldAnswers).toEqual([
      { fieldRef: "name", value: "" },
    ]);
  });
});
