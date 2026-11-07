import { describe, expect, it } from "vitest";
import type { PageGeometry, TextFieldWidget } from "../../types/interfaces";
import { activePageTool } from "../editor-additions-state";
import { orderFieldWidgets } from "../editor-field-state";

const geometry: PageGeometry = {
  bounds: [0, 0, 400, 600],
  userUnit: 1,
  transform: [1, 0, 0, -1, 0, 600],
  width: 400,
  height: 600,
};
function widget(name: string, rect: TextFieldWidget["rect"], pageNumber = 1): TextFieldWidget {
  return { widgetRef: name, fieldRef: name, pageNumber, label: name, value: "", rect };
}
const names = (widgets: readonly TextFieldWidget[]) => widgets.map((w) => w.widgetRef);

describe("orderFieldWidgets", () => {
  // Document order runs bottom to top, as many authoring tools write it.
  const phone = widget("phone", [50, 400, 350, 420]);
  const email = widget("email", [50, 450, 350, 470]);
  const name = widget("name", [50, 500, 350, 520]);

  it("orders an unrotated page from top to bottom", () => {
    expect(names(orderFieldWidgets([phone, email, name], geometry, 0))).toEqual([
      "name",
      "email",
      "phone",
    ]);
  });

  it("orders a row left to right even when the tops differ slightly", () => {
    const city = widget("city", [50, 300, 190, 320]);
    const zip = widget("zip", [210, 302, 350, 322]);
    const below = widget("below", [50, 270, 350, 290]);
    expect(names(orderFieldWidgets([below, zip, city], geometry, 0))).toEqual([
      "city",
      "zip",
      "below",
    ]);
  });

  it("orders in the rotated view", () => {
    // Turned 90 degrees clockwise, the field nearest the PDF's left edge is on top,
    // and the lowest PDF field is on the left.
    const top = widget("top", [20, 100, 40, 300]);
    const lowerLeft = widget("lower-left", [200, 50, 220, 150]);
    const lowerRight = widget("lower-right", [202, 400, 222, 500]);
    expect(names(orderFieldWidgets([lowerRight, lowerLeft, top], geometry, 90))).toEqual([
      "top",
      "lower-left",
      "lower-right",
    ]);
    expect(names(orderFieldWidgets([top, lowerLeft, lowerRight], geometry, 270))).toEqual([
      "lower-right",
      "lower-left",
      "top",
    ]);
  });

  it("orders by page before position", () => {
    const later = widget("later", [50, 550, 350, 570], 2);
    expect(names(orderFieldWidgets([later, phone], geometry, 0))).toEqual(["phone", "later"]);
  });
});

describe("activePageTool", () => {
  const base = { mode: "read", placing: "text", additions: 0 } as const;

  it("presses the draft's own tool while a new addition is open", () => {
    for (const kind of ["text", "checkmark"] as const)
      expect(
        activePageTool({ ...base, mode: "edit", draft: { kind, saved: false }, additions: 2 })
      ).toBe(kind);
  });

  it("presses editing while a saved addition is open", () => {
    expect(
      activePageTool({
        ...base,
        mode: "edit",
        draft: { kind: "checkmark", saved: true },
        additions: 1,
      })
    ).toBe("edit");
  });

  it("presses Read when editing has nothing left to edit", () => {
    expect(activePageTool({ ...base, mode: "edit" })).toBe("read");
    expect(activePageTool({ ...base, mode: "edit", additions: 1 })).toBe("edit");
  });

  it("presses the armed placement tool and the other modes", () => {
    expect(activePageTool({ ...base, mode: "place", placing: "checkmark" })).toBe("checkmark");
    expect(activePageTool({ ...base, mode: "fields" })).toBe("fields");
    expect(activePageTool(base)).toBe("read");
  });
});
